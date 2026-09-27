/**
 * Direct test of requireOrgAdmin/requireOrgMember against a REAL Fastify
 * reply object (via a tiny throwaway route + .inject()), not a mocked one —
 * the bug this covers (missing `if (reply.sent) return` inside
 * requireOrgAdmin, causing "Cannot read properties of undefined" then
 * "Reply was already sent" when a non-member/non-admin hits it) only shows
 * up with Fastify's real reply.sent semantics. Every other test in this repo
 * that touches these routes mocks rbac.js entirely, so this file is the only
 * place the actual guard logic runs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../../../config/index.js', () => ({
  config: { PLATFORM_ADMIN_SECRET: undefined },
}))

let mockMemberSnap: { exists: boolean; data: () => Record<string, unknown> | undefined }
let mockOrgSnap: { exists: boolean; data: () => Record<string, unknown> | undefined }
let mockUserOrgSnap: { exists: boolean; data: () => Record<string, unknown> | undefined }
let mockSpecialistSnap: { exists: boolean; data: () => Record<string, unknown> | undefined }

vi.mock('../../database/firebase.js', () => ({
  getFirestore: vi.fn(() => ({
    doc: vi.fn((path: string) => ({
      get: vi.fn(async () => {
        if (path.includes('/members/')) return mockMemberSnap
        if (path.startsWith('organizations/')) return mockOrgSnap
        if (path.includes('/organizations/')) return mockUserOrgSnap
        if (path.startsWith('specialists/')) return mockSpecialistSnap
        return { exists: false, data: () => undefined }
      }),
      set: vi.fn().mockResolvedValue(undefined),
    })),
  })),
}))

import { requireOrgAdmin } from '../rbac.js'

async function buildApp(user: { uid: string; email?: string } | null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    ;(request as unknown as { user: typeof user }).user = user
  })
  app.get('/test/:orgId', async (request, reply) => {
    const member = await requireOrgAdmin(
      request as never,
      reply,
      (request.params as { orgId: string }).orgId
    )
    if (reply.sent) return // exactly the pattern every real caller uses
    return { ok: true, role: member.role }
  })
  await app.ready()
  return app
}

const NOT_FOUND_SNAP = { exists: false, data: () => undefined }

describe('requireOrgAdmin — real Fastify reply, not mocked', () => {
  let app: FastifyInstance

  beforeEach(() => {
    mockMemberSnap = NOT_FOUND_SNAP
    mockOrgSnap = NOT_FOUND_SNAP
    mockUserOrgSnap = NOT_FOUND_SNAP
    mockSpecialistSnap = NOT_FOUND_SNAP
  })

  afterEach(async () => {
    await app?.close()
  })

  it('sends exactly one 401 when there is no authenticated user — no double-send crash', async () => {
    app = await buildApp(null)
    const res = await app.inject({ method: 'GET', url: '/test/org1' })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toMatchObject({ error: 'Unauthorized' })
  })

  it('sends exactly one 403 when the user is not an org member — no double-send crash', async () => {
    // Every recovery path in recoverIndexedMembership also misses, so
    // requireOrgMember falls through to its own 403.
    app = await buildApp({ uid: 'uid_stranger' })
    const res = await app.inject({ method: 'GET', url: '/test/org1' })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ error: 'Not a member of this organization' })
  })

  it("sends requireOrgAdmin's own 403 when the member exists but is a specialist, not admin", async () => {
    mockMemberSnap = {
      exists: true,
      data: () => ({ role: 'specialist', status: 'active', addedAt: { toDate: () => new Date() } }),
    }
    app = await buildApp({ uid: 'uid_specialist' })
    const res = await app.inject({ method: 'GET', url: '/test/org1' })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ error: 'Only organization admins can perform this action' })
  })

  it('resolves normally and lets the caller proceed when the member is an org_admin', async () => {
    mockMemberSnap = {
      exists: true,
      data: () => ({ role: 'org_admin', status: 'active', addedAt: { toDate: () => new Date() } }),
    }
    app = await buildApp({ uid: 'uid_admin' })
    const res = await app.inject({ method: 'GET', url: '/test/org1' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, role: 'org_admin' })
  })
})

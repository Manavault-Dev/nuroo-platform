/**
 * Route-level tests for POST /admin/orgs/import — platform-admin-only
 * creation of an unclaimed marketplace listing. Covers: the
 * requirePlatformAdmin gate, schema validation, that no owner/member is
 * ever written for an imported listing, and the audit log entry.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

// ─── Mocks (hoisted before real imports) ─────────────────────────────────────

let requirePlatformAdminImpl: (...args: unknown[]) => Promise<unknown> = vi
  .fn()
  .mockResolvedValue(undefined)

vi.mock('../../../infrastructure/auth/rbac.js', () => ({
  requirePlatformAdmin: (...args: unknown[]) => requirePlatformAdminImpl(...args),
  requireOrgMember: vi.fn().mockResolvedValue(undefined),
}))

const mockWriteAudit = vi.fn()
vi.mock('../../../infrastructure/audit/audit.js', () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}))

vi.mock('firebase-admin', () => ({
  default: {
    firestore: {
      Timestamp: {
        now: () => ({ __type: 'timestamp', value: 'now' }),
        fromDate: (d: Date) => ({ __type: 'timestamp', value: d.toISOString() }),
      },
    },
  },
}))

const mockOrgSet = vi.fn().mockResolvedValue(undefined)
const mockMembersDocSet = vi.fn().mockResolvedValue(undefined)
let capturedOrgId = ''

vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn((path: string) => {
      if (path === 'organizations') {
        return {
          doc: vi.fn(() => {
            capturedOrgId = `org_${Math.random().toString(36).slice(2, 8)}`
            return { id: capturedOrgId, set: mockOrgSet }
          }),
        }
      }
      return { doc: vi.fn(() => ({ set: mockMembersDocSet, collection: vi.fn() })) }
    }),
    doc: vi.fn(() => ({ set: mockMembersDocSet, collection: vi.fn(() => ({ doc: vi.fn() })) })),
  })),
  getStorageBucket: vi.fn(),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    ;(request as unknown as { user: { uid: string } }).user = { uid: 'platform_admin_1' }
  })
  const { orgsRoute } = await import('../orgs.routes.js')
  await app.register(orgsRoute)
  await app.ready()
  return app
}

describe('POST /admin/orgs/import', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    requirePlatformAdminImpl = vi.fn().mockResolvedValue(undefined)
    app = await buildApp()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 403 when the caller is not a platform admin, and writes nothing', async () => {
    requirePlatformAdminImpl = vi.fn(
      async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
        reply
          .code(403)
          .send({ error: 'Platform admin access required', code: 'PLATFORM_ADMIN_REQUIRED' })
      }
    )

    const res = await app.inject({
      method: 'POST',
      url: '/admin/orgs/import',
      payload: { name: 'Речь и Я' },
    })

    expect(res.statusCode).toBe(403)
    expect(mockOrgSet).not.toHaveBeenCalled()
    expect(mockWriteAudit).not.toHaveBeenCalled()
  })

  it('rejects a request with no name (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/orgs/import',
      payload: { country: 'Kyrgyzstan' },
    })

    expect(res.statusCode).toBe(400)
    expect(mockOrgSet).not.toHaveBeenCalled()
  })

  it('creates the org with status unclaimed, no owner, and no members doc', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/orgs/import',
      payload: {
        name: 'Речь и Я',
        country: 'Kyrgyzstan',
        city: 'Bishkek',
        sourceUrl: 'https://2gis.kg/bishkek/firm/123',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, name: 'Речь и Я', status: 'unclaimed' })
    expect(res.json().orgId).toBeTruthy()

    expect(mockOrgSet).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Речь и Я',
        createdBy: null,
        claimedBy: null,
        claimedAt: null,
        status: 'unclaimed',
        importedBy: 'platform_admin_1',
        sourceUrl: 'https://2gis.kg/bishkek/firm/123',
        isPublicMarketplaceEnabled: true,
      })
    )
    // No members subcollection write for an imported listing — nobody should
    // ever silently own it.
    expect(mockMembersDocSet).not.toHaveBeenCalled()
  })

  it('still creates the listing as publicly visible immediately', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/orgs/import',
      payload: { name: 'Академик KG' },
    })

    expect(res.statusCode).toBe(200)
    expect(mockOrgSet).toHaveBeenCalledWith(
      expect.objectContaining({ isPublicMarketplaceEnabled: true })
    )
  })

  it('writes an organization.imported audit event scoped to the new org', async () => {
    await app.inject({
      method: 'POST',
      url: '/admin/orgs/import',
      payload: { name: 'Академик KG' },
    })

    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'organization',
        action: 'organization.imported',
        actorRole: 'platform_admin',
        actorId: 'platform_admin_1',
      })
    )
  })
})

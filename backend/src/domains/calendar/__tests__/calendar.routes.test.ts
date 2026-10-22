/**
 * Integration tests for the role-aware Google Calendar OAuth routes
 * (/calendar/connect, /calendar/callback, /calendar/status,
 * /calendar/disconnect). Verifies parents and specialists write/read
 * separate Firestore doc paths, old in-flight states without a `role`
 * field still default to specialist (backward compatibility), and the
 * callback redirects to the right surface for each role.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

// ─── In-memory Firestore fake ──────────────────────────────────────────────

const store = new Map<string, Record<string, unknown> | undefined>()

vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(() => ({
    doc: vi.fn((path: string) => ({
      get: vi.fn(async () => {
        const data = store.get(path)
        return { exists: data !== undefined, data: () => data }
      }),
      set: vi.fn(async (data: Record<string, unknown>) => {
        store.set(path, data)
      }),
    })),
  })),
}))

const mockExchangeCodeForTokens = vi.fn()
vi.mock('../../../infrastructure/meetings/google-meet.js', () => ({
  getOAuthConsentUrl: vi.fn(
    (state: string) => `https://accounts.google.com/o/oauth2/auth?state=${state}`
  ),
  exchangeCodeForTokens: (...args: unknown[]) => mockExchangeCodeForTokens(...args),
}))

// ─── Helpers ────────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    ;(request as unknown as { user: { uid: string } }).user = { uid: 'test_uid' }
  })
  const { calendarRoutes } = await import('../calendar.routes.js')
  await app.register(calendarRoutes)
  await app.ready()
  return app
}

function decodeState(url: string): { uid: string; role?: string } {
  const state = new URL(url).searchParams.get('state')!
  return JSON.parse(Buffer.from(state, 'base64url').toString())
}

function encodeState(data: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url')
}

describe('GET /calendar/connect', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    store.clear()
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('defaults role to specialist when none is given', async () => {
    const res = await app.inject({ method: 'GET', url: '/calendar/connect' })
    const { url } = res.json()
    expect(decodeState(url).role).toBe('specialist')
  })

  it('embeds role=parent in state when requested', async () => {
    const res = await app.inject({ method: 'GET', url: '/calendar/connect?role=parent' })
    const { url } = res.json()
    expect(decodeState(url).role).toBe('parent')
  })
})

describe('GET /calendar/callback', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    store.clear()
    vi.clearAllMocks()
    app = await buildApp()
  })

  it('writes to specialists/{uid}/... and redirects to the B2B surface for specialists', async () => {
    mockExchangeCodeForTokens.mockResolvedValue({ refreshToken: 'rt', email: 'spec@example.com' })
    const state = encodeState({ uid: 'spec_uid', role: 'specialist', ts: Date.now() })

    const res = await app.inject({
      method: 'GET',
      url: `/calendar/callback?code=abc&state=${state}`,
    })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('/b2b/integrations?success=1')
    expect(store.get('specialists/spec_uid/integrations/google_calendar')).toMatchObject({
      connected: true,
      googleEmail: 'spec@example.com',
    })
    expect(store.get('users/spec_uid/integrations/google_calendar')).toBeUndefined()
  })

  it('writes to users/{uid}/... and redirects to the parent confirmation page for parents', async () => {
    mockExchangeCodeForTokens.mockResolvedValue({ refreshToken: 'rt', email: 'parent@example.com' })
    const state = encodeState({ uid: 'parent_uid', role: 'parent', ts: Date.now() })

    const res = await app.inject({
      method: 'GET',
      url: `/calendar/callback?code=abc&state=${state}`,
    })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('/calendar-connected?success=1')
    expect(store.get('users/parent_uid/integrations/google_calendar')).toMatchObject({
      connected: true,
      googleEmail: 'parent@example.com',
    })
    expect(store.get('specialists/parent_uid/integrations/google_calendar')).toBeUndefined()
  })

  it('defaults to specialist when state has no role field (old in-flight link)', async () => {
    mockExchangeCodeForTokens.mockResolvedValue({ refreshToken: 'rt', email: 'legacy@example.com' })
    const state = encodeState({ uid: 'legacy_uid', ts: Date.now() })

    const res = await app.inject({
      method: 'GET',
      url: `/calendar/callback?code=abc&state=${state}`,
    })

    expect(res.headers.location).toContain('/b2b/integrations?success=1')
    expect(store.get('specialists/legacy_uid/integrations/google_calendar')).toMatchObject({
      connected: true,
    })
  })

  it('redirects to the parent confirmation page with an error when access is denied', async () => {
    const state = encodeState({ uid: 'parent_uid', role: 'parent', ts: Date.now() })
    const res = await app.inject({
      method: 'GET',
      url: `/calendar/callback?error=access_denied&state=${state}`,
    })

    expect(res.headers.location).toContain('/calendar-connected?error=access_denied')
  })
})

describe('GET /calendar/status + DELETE /calendar/disconnect', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    store.clear()
    vi.clearAllMocks()
    app = await buildApp()
    store.set('users/test_uid/integrations/google_calendar', {
      connected: true,
      googleEmail: 'parent@example.com',
    })
    store.set('specialists/test_uid/integrations/google_calendar', {
      connected: true,
      googleEmail: 'spec@example.com',
    })
  })

  it('reads the parent path when role=parent, independent of the specialist doc', async () => {
    const res = await app.inject({ method: 'GET', url: '/calendar/status?role=parent' })
    expect(res.json()).toMatchObject({ connected: true, googleEmail: 'parent@example.com' })
  })

  it('reads the specialist path by default', async () => {
    const res = await app.inject({ method: 'GET', url: '/calendar/status' })
    expect(res.json()).toMatchObject({ connected: true, googleEmail: 'spec@example.com' })
  })

  it('disconnecting as a parent does not touch the specialist doc for the same uid', async () => {
    await app.inject({ method: 'DELETE', url: '/calendar/disconnect?role=parent' })

    expect(store.get('users/test_uid/integrations/google_calendar')).toMatchObject({
      connected: false,
    })
    expect(store.get('specialists/test_uid/integrations/google_calendar')).toMatchObject({
      connected: true,
    })
  })
})

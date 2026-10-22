/**
 * Route-level tests for providerConfig.routes.ts — org-admin-gated write of
 * the org's Finik provider config, and org-member-gated read of its
 * (secret-free) status.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

// ─── Mocks (hoisted before real imports) ─────────────────────────────────────

let requireOrgAdminImpl: (...args: unknown[]) => Promise<unknown> = vi
  .fn()
  .mockResolvedValue({ uid: 'admin1', role: 'org_admin' })
let requireOrgMemberImpl: (...args: unknown[]) => Promise<unknown> = vi
  .fn()
  .mockResolvedValue({ uid: 'admin1', role: 'org_admin' })

vi.mock('../../../infrastructure/auth/rbac.js', () => ({
  requireOrgAdmin: (...args: unknown[]) => requireOrgAdminImpl(...args),
  requireOrgMember: (...args: unknown[]) => requireOrgMemberImpl(...args),
}))

let validateConfigResult: { valid: boolean; error?: string } = { valid: true }
const mockValidateConfig = vi.fn((_cfg: Record<string, string>) =>
  Promise.resolve(validateConfigResult)
)

vi.mock('../providers/FinikPaymentProvider.js', () => ({
  FinikPaymentProvider: class {
    validateConfig(cfg: Record<string, string>) {
      return mockValidateConfig(cfg)
    }
  },
}))

vi.mock('firebase-admin', () => ({
  default: {
    firestore: {
      FieldValue: { serverTimestamp: () => ({ __type: 'timestamp' }) },
    },
  },
}))

let providerDocData: Record<string, unknown> | undefined
const mockProviderDocSet = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(() => ({
    doc: vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: providerDocData !== undefined,
        data: () => providerDocData,
      }),
      set: mockProviderDocSet,
    }),
  })),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    ;(request as unknown as { user: { uid: string } }).user = { uid: 'admin1' }
  })
  const { providerConfigRoutes } = await import('../providerConfig.routes.js')
  await app.register(providerConfigRoutes)
  await app.ready()
  return app
}

describe('providerConfigRoutes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    requireOrgAdminImpl = vi.fn().mockResolvedValue({ uid: 'admin1', role: 'org_admin' })
    requireOrgMemberImpl = vi.fn().mockResolvedValue({ uid: 'admin1', role: 'org_admin' })
    validateConfigResult = { valid: true }
    providerDocData = undefined
    app = await buildApp()
  })

  afterEach(async () => {
    await app.close()
  })

  // ── POST /orgs/:orgId/payment-providers/finik ───────────────────────────

  describe('POST /orgs/:orgId/payment-providers/finik', () => {
    it('returns 403 when caller is not an org admin', async () => {
      requireOrgAdminImpl = vi.fn(
        async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
          reply.code(403).send({ error: 'forbidden' })
        }
      )

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/payment-providers/finik',
        payload: { merchantId: 'merchant_1' },
      })

      expect(res.statusCode).toBe(403)
      expect(mockProviderDocSet).not.toHaveBeenCalled()
    })

    it('rejects a body missing merchantId via schema validation (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/payment-providers/finik',
        payload: {},
      })

      expect(res.statusCode).toBe(400)
      expect(mockProviderDocSet).not.toHaveBeenCalled()
    })

    it('rejects an empty-string merchantId via schema validation (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/payment-providers/finik',
        payload: { merchantId: '' },
      })

      expect(res.statusCode).toBe(400)
    })

    it('returns 400 INVALID_CONFIG when the provider rejects the config', async () => {
      validateConfigResult = { valid: false, error: 'merchantId looks malformed' }

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/payment-providers/finik',
        payload: { merchantId: 'bad_merchant' },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({
        code: 'INVALID_CONFIG',
        error: 'merchantId looks malformed',
      })
      expect(mockProviderDocSet).not.toHaveBeenCalled()
    })

    it('persists the config and returns 200 on success', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/payment-providers/finik',
        payload: { merchantId: 'merchant_001' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({
        ok: true,
        provider: { name: 'finik', enabled: true, merchantId: 'merchant_001' },
      })
      expect(mockProviderDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          merchantId: 'merchant_001',
          createdBy: 'admin1',
        })
      )
    })
  })

  // ── GET /orgs/:orgId/payment-providers ───────────────────────────────────

  describe('GET /orgs/:orgId/payment-providers', () => {
    it('returns 403 when caller is not an org member', async () => {
      requireOrgMemberImpl = vi.fn(
        async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
          reply.code(403).send({ error: 'Not a member' })
        }
      )

      const res = await app.inject({ method: 'GET', url: '/orgs/org1/payment-providers' })

      expect(res.statusCode).toBe(403)
    })

    it('returns enabled:false when no provider config document exists', async () => {
      providerDocData = undefined

      const res = await app.inject({ method: 'GET', url: '/orgs/org1/payment-providers' })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ ok: true, providers: { finik: { enabled: false } } })
    })

    it('maps an existing config document without ever exposing a secret key value', async () => {
      providerDocData = {
        enabled: true,
        merchantId: 'merchant_001',
        secretKeySet: true,
        secretKey: 'super-secret-should-not-leak',
        updatedAt: { toDate: () => new Date('2025-01-15T00:00:00Z') },
      }

      const res = await app.inject({ method: 'GET', url: '/orgs/org1/payment-providers' })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.providers.finik).toMatchObject({
        enabled: true,
        merchantId: 'merchant_001',
        secretKeySet: true,
        configuredAt: '2025-01-15T00:00:00.000Z',
      })
      expect(JSON.stringify(body)).not.toContain('super-secret-should-not-leak')
    })

    it('treats enabled !== true as disabled even when a document exists', async () => {
      providerDocData = { enabled: false, merchantId: 'merchant_001' }

      const res = await app.inject({ method: 'GET', url: '/orgs/org1/payment-providers' })

      expect(res.statusCode).toBe(200)
      expect(res.json().providers.finik.enabled).toBe(false)
    })

    it('returns null configuredAt when updatedAt is missing', async () => {
      providerDocData = { enabled: true, merchantId: 'merchant_001' }

      const res = await app.inject({ method: 'GET', url: '/orgs/org1/payment-providers' })

      expect(res.json().providers.finik.configuredAt).toBeNull()
    })
  })
})

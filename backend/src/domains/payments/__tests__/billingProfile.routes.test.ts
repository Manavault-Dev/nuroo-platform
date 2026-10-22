/**
 * Route-level tests for billingProfile.routes.ts — the HTTP layer sitting on
 * top of billingProfile.service.ts (already covered at the service level in
 * billingProfile.test.ts). These tests focus on auth gating, status codes,
 * query/body handling, and error-to-status-code mapping — not the service's
 * internal persistence logic, which is mocked out here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

// ─── Mocks (hoisted before real imports) ─────────────────────────────────────

let requireOrgAdminImpl: (...args: unknown[]) => Promise<unknown> = vi
  .fn()
  .mockResolvedValue({ uid: 'admin1', role: 'org_admin' })

vi.mock('../../../infrastructure/auth/rbac.js', () => ({
  requireOrgAdmin: (...args: unknown[]) => requireOrgAdminImpl(...args),
}))

const mockCreateBillingProfile = vi.fn()
const mockGetBillingProfile = vi.fn()
const mockListBillingProfiles = vi.fn()
const mockUpdateBillingProfile = vi.fn()

vi.mock('../billingProfile.service.js', () => ({
  createBillingProfile: (...args: unknown[]) => mockCreateBillingProfile(...args),
  getBillingProfile: (...args: unknown[]) => mockGetBillingProfile(...args),
  listBillingProfiles: (...args: unknown[]) => mockListBillingProfiles(...args),
  updateBillingProfile: (...args: unknown[]) => mockUpdateBillingProfile(...args),
}))

const mockGenerateMonthlyInvoicesForOrg = vi.fn()
const mockMarkOverdueInvoicesForOrg = vi.fn()

vi.mock('../invoiceGeneration.service.js', () => ({
  generateMonthlyInvoicesForOrg: (...args: unknown[]) => mockGenerateMonthlyInvoicesForOrg(...args),
  markOverdueInvoicesForOrg: (...args: unknown[]) => mockMarkOverdueInvoicesForOrg(...args),
}))

let featureCheckResult: { ok: boolean; error?: string } = { ok: true }

vi.mock('../planLimits.js', () => ({
  checkOrgHasFeature: vi.fn(() => Promise.resolve(featureCheckResult)),
}))

const mockInvoiceDocSet = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn().mockReturnValue({
      doc: vi.fn().mockReturnValue({ set: mockInvoiceDocSet }),
    }),
  })),
}))

vi.mock('firebase-admin', () => ({
  default: {
    firestore: {
      FieldValue: { serverTimestamp: () => new Date() },
    },
  },
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    ;(request as unknown as { user: { uid: string } }).user = { uid: 'admin1' }
  })
  const { billingProfileRoutes } = await import('../billingProfile.routes.js')
  await app.register(billingProfileRoutes)
  await app.ready()
  return app
}

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'profile1',
    orgId: 'org1',
    childId: 'child1',
    parentId: 'parent1',
    amount: 4000,
    currency: 'KGS',
    billingCycle: 'monthly',
    dueDayOfMonth: 5,
    status: 'active',
    provider: 'finik',
    nextInvoiceDate: new Date(2025, 5, 5),
    createdBy: 'admin1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('billingProfileRoutes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    requireOrgAdminImpl = vi.fn().mockResolvedValue({ uid: 'admin1', role: 'org_admin' })
    featureCheckResult = { ok: true }
    app = await buildApp()
  })

  afterEach(async () => {
    await app.close()
  })

  // ── GET /orgs/:orgId/billing/profiles ───────────────────────────────────

  describe('GET /orgs/:orgId/billing/profiles', () => {
    it('returns 403 when caller is not an org admin', async () => {
      requireOrgAdminImpl = vi.fn(
        async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
          reply.code(403).send({ error: 'Only organization admins can perform this action' })
        }
      )

      const res = await app.inject({ method: 'GET', url: '/orgs/org1/billing/profiles' })

      expect(res.statusCode).toBe(403)
      expect(mockListBillingProfiles).not.toHaveBeenCalled()
    })

    it('lists profiles and forwards childId/status query filters', async () => {
      mockListBillingProfiles.mockResolvedValue([makeProfile()])

      const res = await app.inject({
        method: 'GET',
        url: '/orgs/org1/billing/profiles?childId=child1&status=active',
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().profiles).toHaveLength(1)
      expect(mockListBillingProfiles).toHaveBeenCalledWith(expect.anything(), 'org1', {
        childId: 'child1',
        status: 'active',
      })
    })
  })

  // ── POST /orgs/:orgId/billing/profiles ──────────────────────────────────

  describe('POST /orgs/:orgId/billing/profiles', () => {
    const VALID_BODY = {
      childId: 'child1',
      parentId: 'parent1',
      amount: 4000,
      currency: 'KGS',
      billingCycle: 'monthly',
      dueDayOfMonth: 5,
    }

    it('returns 403 when caller is not an org admin', async () => {
      requireOrgAdminImpl = vi.fn(
        async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
          reply.code(403).send({ error: 'forbidden' })
        }
      )

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/profiles',
        payload: VALID_BODY,
      })

      expect(res.statusCode).toBe(403)
      expect(mockCreateBillingProfile).not.toHaveBeenCalled()
    })

    it('rejects a body missing required fields with a schema validation error (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/profiles',
        payload: { childId: 'child1' },
      })

      expect(res.statusCode).toBe(400)
      expect(mockCreateBillingProfile).not.toHaveBeenCalled()
    })

    it('rejects a non-positive amount (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/profiles',
        payload: { ...VALID_BODY, amount: 0 },
      })

      expect(res.statusCode).toBe(400)
    })

    it('rejects dueDayOfMonth outside 1-28 (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/profiles',
        payload: { ...VALID_BODY, dueDayOfMonth: 29 },
      })

      expect(res.statusCode).toBe(400)
    })

    it('creates a profile, auto-creates an upcoming invoice, and returns 201', async () => {
      const profile = makeProfile()
      mockCreateBillingProfile.mockResolvedValue(profile)

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/profiles',
        payload: VALID_BODY,
      })

      expect(res.statusCode).toBe(201)
      expect(res.json().profile.id).toBe('profile1')
      expect(mockCreateBillingProfile).toHaveBeenCalledWith(
        expect.anything(),
        'org1',
        VALID_BODY,
        'admin1'
      )
      expect(mockInvoiceDocSet).toHaveBeenCalledOnce()
    })

    it('still returns 201 even when the best-effort auto-invoice creation fails', async () => {
      mockCreateBillingProfile.mockResolvedValue(makeProfile())
      mockInvoiceDocSet.mockRejectedValueOnce(new Error('firestore write failed'))

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/profiles',
        payload: VALID_BODY,
      })

      expect(res.statusCode).toBe(201)
    })

    it('returns 409 DUPLICATE_BILLING_PROFILE when the service rejects a duplicate', async () => {
      mockCreateBillingProfile.mockRejectedValue(new Error('DUPLICATE_BILLING_PROFILE'))

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/profiles',
        payload: VALID_BODY,
      })

      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ code: 'DUPLICATE_BILLING_PROFILE' })
    })

    it('returns 500 INTERNAL_ERROR for unexpected service errors', async () => {
      mockCreateBillingProfile.mockRejectedValue(new Error('boom'))

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/profiles',
        payload: VALID_BODY,
      })

      expect(res.statusCode).toBe(500)
      expect(res.json()).toMatchObject({ code: 'INTERNAL_ERROR', error: 'boom' })
    })
  })

  // ── GET /orgs/:orgId/billing/profiles/:profileId ────────────────────────

  describe('GET /orgs/:orgId/billing/profiles/:profileId', () => {
    it('returns 404 PROFILE_NOT_FOUND when the profile does not exist', async () => {
      mockGetBillingProfile.mockResolvedValue(null)

      const res = await app.inject({ method: 'GET', url: '/orgs/org1/billing/profiles/missing' })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ code: 'PROFILE_NOT_FOUND' })
    })

    it('returns 200 with the profile when found', async () => {
      mockGetBillingProfile.mockResolvedValue(makeProfile())

      const res = await app.inject({ method: 'GET', url: '/orgs/org1/billing/profiles/profile1' })

      expect(res.statusCode).toBe(200)
      expect(res.json().profile.id).toBe('profile1')
    })
  })

  // ── PATCH /orgs/:orgId/billing/profiles/:profileId ──────────────────────

  describe('PATCH /orgs/:orgId/billing/profiles/:profileId', () => {
    it('rejects an invalid status enum value (400)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/orgs/org1/billing/profiles/profile1',
        payload: { status: 'bogus' },
      })

      expect(res.statusCode).toBe(400)
      expect(mockUpdateBillingProfile).not.toHaveBeenCalled()
    })

    it('updates and returns 200 on success', async () => {
      mockUpdateBillingProfile.mockResolvedValue(makeProfile({ amount: 5000 }))

      const res = await app.inject({
        method: 'PATCH',
        url: '/orgs/org1/billing/profiles/profile1',
        payload: { amount: 5000 },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().profile.amount).toBe(5000)
    })

    it('returns 404 PROFILE_NOT_FOUND when the service reports missing profile', async () => {
      mockUpdateBillingProfile.mockRejectedValue(new Error('Billing profile not found'))

      const res = await app.inject({
        method: 'PATCH',
        url: '/orgs/org1/billing/profiles/missing',
        payload: { amount: 5000 },
      })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ code: 'PROFILE_NOT_FOUND' })
    })

    it('returns 500 INTERNAL_ERROR for unexpected service errors', async () => {
      mockUpdateBillingProfile.mockRejectedValue(new Error('db unavailable'))

      const res = await app.inject({
        method: 'PATCH',
        url: '/orgs/org1/billing/profiles/profile1',
        payload: { amount: 5000 },
      })

      expect(res.statusCode).toBe(500)
      expect(res.json()).toMatchObject({ code: 'INTERNAL_ERROR' })
    })
  })

  // ── POST /orgs/:orgId/billing/generate-monthly-invoices ─────────────────

  describe('POST /orgs/:orgId/billing/generate-monthly-invoices', () => {
    it('returns 403 when caller is not an org admin', async () => {
      requireOrgAdminImpl = vi.fn(
        async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
          reply.code(403).send({ error: 'forbidden' })
        }
      )

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/generate-monthly-invoices',
      })

      expect(res.statusCode).toBe(403)
      expect(mockGenerateMonthlyInvoicesForOrg).not.toHaveBeenCalled()
    })

    it('returns 403 PLAN_UPGRADE_REQUIRED when the org plan lacks the finance feature', async () => {
      featureCheckResult = { ok: false, error: 'Finance module is not included in your plan' }

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/generate-monthly-invoices',
      })

      expect(res.statusCode).toBe(403)
      expect(res.json()).toMatchObject({ code: 'PLAN_UPGRADE_REQUIRED' })
      expect(mockGenerateMonthlyInvoicesForOrg).not.toHaveBeenCalled()
    })

    it('returns 200 with the generation result on success', async () => {
      mockGenerateMonthlyInvoicesForOrg.mockResolvedValue({ created: 3, skipped: 1 })

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/generate-monthly-invoices',
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ ok: true, result: { created: 3, skipped: 1 } })
    })

    it('returns 500 INTERNAL_ERROR when the service throws', async () => {
      mockGenerateMonthlyInvoicesForOrg.mockRejectedValue(new Error('generation failed'))

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/generate-monthly-invoices',
      })

      expect(res.statusCode).toBe(500)
      expect(res.json()).toMatchObject({ code: 'INTERNAL_ERROR' })
    })
  })

  // ── POST /orgs/:orgId/billing/mark-overdue ──────────────────────────────

  describe('POST /orgs/:orgId/billing/mark-overdue', () => {
    it('returns 403 PLAN_UPGRADE_REQUIRED when the org plan lacks the finance feature', async () => {
      featureCheckResult = { ok: false, error: 'Finance module required' }

      const res = await app.inject({ method: 'POST', url: '/orgs/org1/billing/mark-overdue' })

      expect(res.statusCode).toBe(403)
      expect(res.json()).toMatchObject({ code: 'PLAN_UPGRADE_REQUIRED' })
      expect(mockMarkOverdueInvoicesForOrg).not.toHaveBeenCalled()
    })

    it('returns 200 with the result on success', async () => {
      mockMarkOverdueInvoicesForOrg.mockResolvedValue({ marked: 2 })

      const res = await app.inject({ method: 'POST', url: '/orgs/org1/billing/mark-overdue' })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ ok: true, result: { marked: 2 } })
    })

    it('returns 500 INTERNAL_ERROR when the service throws', async () => {
      mockMarkOverdueInvoicesForOrg.mockRejectedValue(new Error('mark failed'))

      const res = await app.inject({ method: 'POST', url: '/orgs/org1/billing/mark-overdue' })

      expect(res.statusCode).toBe(500)
      expect(res.json()).toMatchObject({ code: 'INTERNAL_ERROR' })
    })
  })
})

/**
 * Route-level tests for payments.routes.ts — auth/validation at the HTTP
 * layer. payments.service.ts is mocked out here (its own edge cases, where
 * they don't require live Finik signing, are covered separately in
 * payments.service.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

// ─── Mocks (hoisted before real imports) ─────────────────────────────────────

type Member = { uid: string; role: 'org_admin' | 'specialist' }

let currentMember: Member = { uid: 'user1', role: 'org_admin' }
let requireOrgMemberImpl: (...args: unknown[]) => Promise<unknown> = vi.fn(
  async () => currentMember
)

vi.mock('../../../infrastructure/auth/rbac.js', () => ({
  requireOrgMember: (...args: unknown[]) => requireOrgMemberImpl(...args),
}))

const mockCreatePayment = vi.fn()
const mockVerifyPayment = vi.fn()
const mockGetPlanPrices = vi.fn()
const mockGetPlanNames = vi.fn()

vi.mock('../payments.service.js', () => ({
  createPayment: (...args: unknown[]) => mockCreatePayment(...args),
  verifyPayment: (...args: unknown[]) => mockVerifyPayment(...args),
  getPlanPrices: (...args: unknown[]) => mockGetPlanPrices(...args),
  getPlanNames: (...args: unknown[]) => mockGetPlanNames(...args),
}))

// payments.routes.ts imports PLAN_LIMITS from planLimits.js, which imports
// payments.repository.js, which calls getFirestore() at module load time
// (not lazily). Without Firebase Admin configured (e.g. in CI, with no
// service-account credentials), that throws before any test runs — mock it
// out the same way planLimits.test.ts does, even though this file never
// exercises Firestore itself (payments.service.js above is fully mocked).
vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(() => ({})),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildApp(withUser = true): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  if (withUser) {
    app.addHook('onRequest', async (request) => {
      ;(request as unknown as { user: { uid: string } }).user = { uid: 'user1' }
    })
  }
  const { paymentsRoutes } = await import('../payments.routes.js')
  await app.register(paymentsRoutes)
  await app.ready()
  return app
}

describe('paymentsRoutes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    currentMember = { uid: 'user1', role: 'org_admin' }
    requireOrgMemberImpl = vi.fn(async () => currentMember)
    mockGetPlanPrices.mockReturnValue({ starter: 4900, growth: 9900, enterprise: 19900 })
    mockGetPlanNames.mockReturnValue({
      starter: 'Starter',
      growth: 'Growth',
      enterprise: 'Enterprise',
    })
    app = await buildApp()
  })

  afterEach(async () => {
    await app.close()
  })

  // ── GET /plans ───────────────────────────────────────────────────────────

  describe('GET /plans', () => {
    it('returns plans with prices, names, and limits merged from planLimits.ts (starter — the one plan with fully finite limits)', async () => {
      mockGetPlanPrices.mockReturnValue({ starter: 4900 })
      mockGetPlanNames.mockReturnValue({ starter: 'Starter' })

      const res = await app.inject({ method: 'GET', url: '/plans' })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.ok).toBe(true)
      expect(body.plans).toHaveLength(1)
      expect(body.plans[0]).toMatchObject({
        id: 'starter',
        name: 'Starter',
        price: 4900,
        currency: 'KGS',
        limits: { children: 30, specialists: 3 },
      })
    })

    // PLAN_LIMITS.growth is `{ children: 80, specialists: null }` and
    // PLAN_LIMITS.enterprise is `{ children: null, specialists: null }` —
    // "unlimited" is modeled as a null *field* inside the limits object, not
    // the whole `limits` value being null. The response schema's children/
    // specialists fields allow `['number', 'null']` specifically so this
    // doesn't trip fast-json-stringify (previously it only allowed `number`,
    // which 500'd on every real request — fixed).
    it('returns null for an unlimited (growth specialists) field instead of 500ing', async () => {
      mockGetPlanPrices.mockReturnValue({ growth: 9900 })
      mockGetPlanNames.mockReturnValue({ growth: 'Growth' })

      const res = await app.inject({ method: 'GET', url: '/plans' })

      expect(res.statusCode).toBe(200)
      expect(res.json().plans[0]).toMatchObject({
        id: 'growth',
        limits: { children: 80, specialists: null },
      })
    })

    it('succeeds for the real, unmocked production plan set (starter + growth + enterprise)', async () => {
      mockGetPlanPrices.mockReturnValue({ starter: 4900, growth: 9900, enterprise: 19900 })
      mockGetPlanNames.mockReturnValue({
        starter: 'Starter',
        growth: 'Growth',
        enterprise: 'Enterprise',
      })

      const res = await app.inject({ method: 'GET', url: '/plans' })

      expect(res.statusCode).toBe(200)
      const limitsByPlan = Object.fromEntries(
        res.json().plans.map((p: { id: string; limits: unknown }) => [p.id, p.limits])
      )
      expect(limitsByPlan).toEqual({
        starter: { children: 30, specialists: 3 },
        growth: { children: 80, specialists: null },
        enterprise: { children: null, specialists: null },
      })
    })

    it('returns 500 when getPlanPrices throws', async () => {
      mockGetPlanPrices.mockImplementation(() => {
        throw new Error('pricing unavailable')
      })

      const res = await app.inject({ method: 'GET', url: '/plans' })

      expect(res.statusCode).toBe(500)
      expect(res.json()).toMatchObject({ ok: false, error: 'pricing unavailable' })
    })
  })

  // ── POST /orgs/:orgId/payments ───────────────────────────────────────────

  describe('POST /orgs/:orgId/payments', () => {
    const VALID_BODY = { planId: 'growth', orgId: 'org1' }

    it('returns 401 when there is no authenticated user', async () => {
      await app.close()
      app = await buildApp(false)

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/payments',
        payload: VALID_BODY,
      })

      expect(res.statusCode).toBe(401)
      expect(mockCreatePayment).not.toHaveBeenCalled()
    })

    it('returns 403 when the caller is not an org member', async () => {
      requireOrgMemberImpl = vi.fn(
        async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
          reply.code(403).send({ error: 'Not a member of this organization' })
        }
      )

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/payments',
        payload: VALID_BODY,
      })

      expect(res.statusCode).toBe(403)
      expect(mockCreatePayment).not.toHaveBeenCalled()
    })

    it('returns 403 when the member is not an org admin', async () => {
      currentMember = { uid: 'user1', role: 'specialist' }

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/payments',
        payload: VALID_BODY,
      })

      expect(res.statusCode).toBe(403)
      expect(res.json()).toMatchObject({ error: 'Only organization admins can create payments' })
      expect(mockCreatePayment).not.toHaveBeenCalled()
    })

    it('returns 400 when body.orgId does not match the URL param', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/payments',
        payload: { planId: 'growth', orgId: 'org2' },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ error: 'Organization ID mismatch' })
      expect(mockCreatePayment).not.toHaveBeenCalled()
    })

    it('rejects an invalid planId not in the allowed enum', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/payments',
        payload: { planId: 'not-a-real-plan', orgId: 'org1' },
      })

      // createPaymentSchema.parse() throws a ZodError that propagates out of
      // the handler uncaught (it sits outside the try/catch) — the server's
      // default error handling turns this into a non-2xx response.
      expect(res.statusCode).toBeGreaterThanOrEqual(400)
      expect(mockCreatePayment).not.toHaveBeenCalled()
    })

    it('creates the payment and returns the service result on success', async () => {
      mockCreatePayment.mockResolvedValue({
        ok: true,
        paymentId: 'pay_1',
        paymentUrl: 'https://pay.example.com/1',
        transactionId: 'txn_1',
      })

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/payments',
        payload: VALID_BODY,
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ ok: true, paymentId: 'pay_1' })
      expect(mockCreatePayment).toHaveBeenCalledWith(VALID_BODY, 'user1')
    })

    it('returns 500 when createPayment throws', async () => {
      mockCreatePayment.mockRejectedValue(new Error('Finik API error: 500'))

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/payments',
        payload: VALID_BODY,
      })

      expect(res.statusCode).toBe(500)
      expect(res.json()).toMatchObject({ error: 'Finik API error: 500' })
    })
  })

  // ── GET /payments/:paymentId/verify ──────────────────────────────────────

  describe('GET /payments/:paymentId/verify', () => {
    it('returns 401 when there is no authenticated user', async () => {
      await app.close()
      app = await buildApp(false)

      const res = await app.inject({ method: 'GET', url: '/payments/pay_1/verify' })

      expect(res.statusCode).toBe(401)
      expect(mockVerifyPayment).not.toHaveBeenCalled()
    })

    it('returns 404 when the payment is not found', async () => {
      mockVerifyPayment.mockResolvedValue({ ok: false, error: 'Payment not found' })

      const res = await app.inject({ method: 'GET', url: '/payments/missing/verify' })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ error: 'Payment not found' })
    })

    it('returns 403 when the payment record has no orgId', async () => {
      mockVerifyPayment.mockResolvedValue({
        ok: true,
        orgId: undefined,
        payment: {
          id: 'pay_1',
          status: 'pending',
          planId: 'growth',
          amount: 9900,
          currency: 'KGS',
        },
      })

      const res = await app.inject({ method: 'GET', url: '/payments/pay_1/verify' })

      expect(res.statusCode).toBe(403)
      expect(res.json()).toMatchObject({
        error: 'Payment record is missing organization context',
      })
    })

    it('returns 403 when the caller is not a member of the payment org', async () => {
      mockVerifyPayment.mockResolvedValue({
        ok: true,
        orgId: 'org1',
        payment: {
          id: 'pay_1',
          status: 'pending',
          planId: 'growth',
          amount: 9900,
          currency: 'KGS',
        },
      })
      requireOrgMemberImpl = vi.fn(
        async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
          reply.code(403).send({ error: 'Not a member of this organization' })
        }
      )

      const res = await app.inject({ method: 'GET', url: '/payments/pay_1/verify' })

      expect(res.statusCode).toBe(403)
    })

    it('returns 200 with the payment on success', async () => {
      mockVerifyPayment.mockResolvedValue({
        ok: true,
        orgId: 'org1',
        payment: { id: 'pay_1', status: 'paid', planId: 'growth', amount: 9900, currency: 'KGS' },
      })

      const res = await app.inject({ method: 'GET', url: '/payments/pay_1/verify' })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ ok: true, orgId: 'org1', payment: { status: 'paid' } })
    })

    it('returns 500 when verifyPayment throws', async () => {
      mockVerifyPayment.mockRejectedValue(new Error('db unavailable'))

      const res = await app.inject({ method: 'GET', url: '/payments/pay_1/verify' })

      expect(res.statusCode).toBe(500)
      expect(res.json()).toMatchObject({ error: 'Failed to verify payment' })
    })
  })
})

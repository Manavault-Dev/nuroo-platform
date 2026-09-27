/**
 * Integration tests: POST /orgs/:orgId/billing/cancel and /billing/resume.
 *
 * Cancellation must use cancel_at_period_end (schedule, not immediate
 * deletion) — access is retained through the paid period per the business
 * requirement "no data deletion on cancellation". requireOrgAdmin is mocked
 * out so these tests are only about the cancel/resume business logic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

// ─── Mocks (hoisted before real imports) ─────────────────────────────────────

vi.mock('../../../infrastructure/auth/rbac.js', () => ({
  requireOrgAdmin: vi.fn().mockResolvedValue({ uid: 'admin_uid', role: 'org_admin' }),
  requireOrgMember: vi.fn().mockResolvedValue({ uid: 'admin_uid', role: 'org_admin' }),
}))

vi.mock('../../../config/index.js', () => ({
  config: { BILLING_MODE: 'stripe' },
}))

const mockUpdateCancelAtPeriodEnd = vi.fn().mockResolvedValue({})

vi.mock('../stripe.service.js', () => ({
  updateSubscriptionCancelAtPeriodEnd: (...args: unknown[]) => mockUpdateCancelAtPeriodEnd(...args),
  createCheckoutSession: vi.fn(),
  createCustomer: vi.fn(),
  createCustomerPortalSession: vi.fn(),
}))

vi.mock('@sentry/node', () => ({
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}))

let orgBilling: Record<string, unknown> | undefined
const mockOrgSet = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn().mockReturnValue({
      doc: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ billing: orgBilling }),
        }),
        set: mockOrgSet,
      }),
    }),
  })),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    ;(request as unknown as { user: { uid: string; email: string } }).user = {
      uid: 'admin_uid',
      email: 'admin@example.com',
    }
  })
  const { subscriptionRoutes } = await import('../subscription.routes.js')
  await app.register(subscriptionRoutes)
  await app.ready()
  return app
}

describe('POST /orgs/:orgId/billing/cancel', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    orgBilling = { status: 'active', stripeSubscriptionId: 'sub_live' }
    app = await buildApp()
  })

  afterEach(async () => {
    await app.close()
  })

  it('schedules cancellation via cancel_at_period_end=true, not immediate deletion', async () => {
    const res = await app.inject({ method: 'POST', url: '/orgs/org1/billing/cancel' })

    expect(res.statusCode).toBe(200)
    expect(mockUpdateCancelAtPeriodEnd).toHaveBeenCalledWith('sub_live', true)
    expect(mockOrgSet).toHaveBeenCalledWith(
      { billing: expect.objectContaining({ cancelAtPeriodEnd: true }) },
      { merge: true }
    )
  })

  it('returns 400 when the org has no Stripe subscription', async () => {
    orgBilling = { status: 'active' } // no stripeSubscriptionId

    const res = await app.inject({ method: 'POST', url: '/orgs/org1/billing/cancel' })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ code: 'NO_SUBSCRIPTION' })
    expect(mockUpdateCancelAtPeriodEnd).not.toHaveBeenCalled()
  })

  it('returns 502 STRIPE_UPDATE_FAILED instead of crashing when Stripe rejects the update', async () => {
    mockUpdateCancelAtPeriodEnd.mockRejectedValueOnce(new Error('No such subscription'))

    const res = await app.inject({ method: 'POST', url: '/orgs/org1/billing/cancel' })

    expect(res.statusCode).toBe(502)
    expect(res.json()).toMatchObject({ code: 'STRIPE_UPDATE_FAILED' })
    expect(mockOrgSet).not.toHaveBeenCalled()
  })
})

describe('POST /orgs/:orgId/billing/resume', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    orgBilling = { status: 'active', stripeSubscriptionId: 'sub_live', cancelAtPeriodEnd: true }
    app = await buildApp()
  })

  afterEach(async () => {
    await app.close()
  })

  it('undoes a scheduled cancellation via cancel_at_period_end=false', async () => {
    const res = await app.inject({ method: 'POST', url: '/orgs/org1/billing/resume' })

    expect(res.statusCode).toBe(200)
    expect(mockUpdateCancelAtPeriodEnd).toHaveBeenCalledWith('sub_live', false)
    expect(mockOrgSet).toHaveBeenCalledWith(
      { billing: expect.objectContaining({ cancelAtPeriodEnd: false }) },
      { merge: true }
    )
  })

  it('returns 400 when the org has no Stripe subscription', async () => {
    orgBilling = { status: 'canceled' }

    const res = await app.inject({ method: 'POST', url: '/orgs/org1/billing/resume' })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ code: 'NO_SUBSCRIPTION' })
    expect(mockUpdateCancelAtPeriodEnd).not.toHaveBeenCalled()
  })

  it('returns 502 STRIPE_UPDATE_FAILED instead of crashing when Stripe rejects the update', async () => {
    mockUpdateCancelAtPeriodEnd.mockRejectedValueOnce(new Error('Subscription already canceled'))

    const res = await app.inject({ method: 'POST', url: '/orgs/org1/billing/resume' })

    expect(res.statusCode).toBe(502)
    expect(res.json()).toMatchObject({ code: 'STRIPE_UPDATE_FAILED' })
    expect(mockOrgSet).not.toHaveBeenCalled()
  })
})

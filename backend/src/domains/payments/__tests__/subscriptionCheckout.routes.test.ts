/**
 * Integration test: POST /orgs/:orgId/billing/checkout — the duplicate-
 * subscription guard specifically.
 *
 * A Checkout Session always creates a NEW Stripe subscription — it never
 * modifies an existing one. Without a guard, clicking "upgrade" while
 * already subscribed would create a second, concurrent subscription (double
 * billing) instead of changing the existing one. requireOrgAdmin (real auth)
 * is mocked out here so the test is only about that guard, not the auth chain.
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

const mockCreateCheckoutSession = vi
  .fn()
  .mockResolvedValue({ url: 'https://checkout.stripe.com/xyz' })
const mockCreateCustomer = vi.fn().mockResolvedValue({ id: 'cus_new' })

vi.mock('../stripe.service.js', () => ({
  createCheckoutSession: (...args: unknown[]) => mockCreateCheckoutSession(...args),
  createCustomer: (...args: unknown[]) => mockCreateCustomer(...args),
  createCustomerPortalSession: vi.fn(),
}))

vi.mock('@sentry/node', () => ({
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}))

let orgBilling: Record<string, unknown> | undefined

vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn().mockReturnValue({
      doc: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ billing: orgBilling }),
        }),
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

const CHECKOUT_BODY = {
  planId: 'growth',
  successUrl: 'https://app.example.com/success',
  cancelUrl: 'https://app.example.com/cancel',
}

describe('POST /orgs/:orgId/billing/checkout — duplicate-subscription guard', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    orgBilling = undefined
    app = await buildApp()
  })

  afterEach(async () => {
    await app.close()
  })

  it('blocks checkout with 409 when the org already has an active subscription', async () => {
    orgBilling = { status: 'active', stripeSubscriptionId: 'sub_existing' }

    const res = await app.inject({
      method: 'POST',
      url: '/orgs/org1/billing/checkout',
      payload: CHECKOUT_BODY,
    })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ code: 'SUBSCRIPTION_ALREADY_EXISTS' })
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('blocks checkout with 409 when the org is on an active trial', async () => {
    orgBilling = { status: 'trialing', stripeSubscriptionId: 'sub_trial' }

    const res = await app.inject({
      method: 'POST',
      url: '/orgs/org1/billing/checkout',
      payload: CHECKOUT_BODY,
    })

    expect(res.statusCode).toBe(409)
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('allows checkout when the org has no subscription yet', async () => {
    orgBilling = undefined

    const res = await app.inject({
      method: 'POST',
      url: '/orgs/org1/billing/checkout',
      payload: CHECKOUT_BODY,
    })

    expect(res.statusCode).toBe(200)
    expect(mockCreateCheckoutSession).toHaveBeenCalledOnce()
  })

  it('allows checkout when the previous subscription was canceled', async () => {
    orgBilling = { status: 'canceled', stripeSubscriptionId: 'sub_old_canceled' }

    const res = await app.inject({
      method: 'POST',
      url: '/orgs/org1/billing/checkout',
      payload: CHECKOUT_BODY,
    })

    expect(res.statusCode).toBe(200)
    expect(mockCreateCheckoutSession).toHaveBeenCalledOnce()
  })
})

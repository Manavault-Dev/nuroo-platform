/**
 * Integration test: POST /webhooks/stripe — Fastify route level.
 *
 * Signature verification (constructWebhookEvent) is mocked out entirely —
 * these tests are about what each event TYPE does to org.billing, not about
 * Stripe's HMAC scheme. Real signature verification is Stripe SDK's own
 * responsibility, not this codebase's.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

// ─── Mocks (hoisted before real imports) ─────────────────────────────────────

const mockConstructWebhookEvent = vi.fn()

vi.mock('../stripe.service.js', async () => {
  const actual =
    await vi.importActual<typeof import('../stripe.service.js')>('../stripe.service.js')
  return {
    ...actual,
    constructWebhookEvent: (...args: unknown[]) => mockConstructWebhookEvent(...args),
  }
})

vi.mock('../../../config/index.js', () => ({
  config: {
    STRIPE_SECRET_KEY: 'sk_test_mock',
    STRIPE_PRICE_STARTER: 'price_starter_123',
    STRIPE_PRICE_GROWTH: 'price_growth_456',
    STRIPE_PRICE_ENTERPRISE: 'price_enterprise_789',
  },
}))

vi.mock('@sentry/node', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}))

const mockSet = vi.fn().mockResolvedValue(undefined) // organizations/{orgId}.set(...)
const mockEventSet = vi.fn().mockResolvedValue(undefined) // stripeWebhookEvents/{id}.set(...)
const mockDocGet = vi.fn().mockResolvedValue({ exists: false })

vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === 'stripeWebhookEvents') {
        return { doc: vi.fn().mockReturnValue({ get: mockDocGet, set: mockEventSet }) }
      }
      return { doc: vi.fn().mockReturnValue({ get: mockDocGet, set: mockSet }) }
    }),
  })),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  const { stripeWebhookRoutes } = await import('../stripeWebhook.routes.js')
  await app.register(stripeWebhookRoutes)
  await app.ready()
  return app
}

function fakeSubscriptionUpdatedEvent(
  priceId: string | undefined,
  orgId = 'org_1',
  cancelAtPeriodEnd = false
) {
  return {
    id: 'evt_test_1',
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_test_1',
        status: 'active',
        trial_end: null,
        current_period_end: Math.floor(Date.now() / 1000) + 86400,
        cancel_at_period_end: cancelAtPeriodEnd,
        metadata: { orgId },
        items: { data: priceId ? [{ price: { id: priceId } }] : [] },
      },
    },
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /webhooks/stripe — customer.subscription.updated', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    mockDocGet.mockResolvedValue({ exists: false })
    mockSet.mockResolvedValue(undefined)
    mockEventSet.mockResolvedValue(undefined)
    app = await buildApp()
  })

  afterEach(async () => {
    await app.close()
  })

  it("resolves the plan from the subscription's current price and writes it to billing", async () => {
    mockConstructWebhookEvent.mockReturnValue(fakeSubscriptionUpdatedEvent('price_growth_456'))

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'sig_whatever' },
      payload: {},
    })

    expect(res.statusCode).toBe(200)
    expect(mockSet).toHaveBeenCalledWith(
      { billing: expect.objectContaining({ plan: 'growth' }) },
      { merge: true }
    )
  })

  it('records cancel_at_period_end from the subscription onto billing', async () => {
    mockConstructWebhookEvent.mockReturnValue(
      fakeSubscriptionUpdatedEvent('price_growth_456', 'org_1', true)
    )

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'sig_whatever' },
      payload: {},
    })

    expect(res.statusCode).toBe(200)
    expect(mockSet).toHaveBeenCalledWith(
      { billing: expect.objectContaining({ cancelAtPeriodEnd: true }) },
      { merge: true }
    )
  })

  it('does not overwrite plan with a wrong value when the price is unrecognized', async () => {
    mockConstructWebhookEvent.mockReturnValue(fakeSubscriptionUpdatedEvent('price_totally_unknown'))

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'sig_whatever' },
      payload: {},
    })

    expect(res.statusCode).toBe(200)
    expect(mockSet).toHaveBeenCalledTimes(1)
    const billingWrite = mockSet.mock.calls[0][0].billing
    expect(billingWrite).not.toHaveProperty('plan')
  })

  it('ignores the event when subscription has no orgId in metadata', async () => {
    mockConstructWebhookEvent.mockReturnValue(fakeSubscriptionUpdatedEvent('price_growth_456', ''))

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'sig_whatever' },
      payload: {},
    })

    expect(res.statusCode).toBe(200)
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('returns 400 when constructWebhookEvent throws (bad signature)', async () => {
    mockConstructWebhookEvent.mockImplementation(() => {
      throw new Error('bad signature')
    })

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'sig_bad' },
      payload: {},
    })

    expect(res.statusCode).toBe(400)
    expect(mockSet).not.toHaveBeenCalled()
  })
})

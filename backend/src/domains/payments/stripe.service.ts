import Stripe from 'stripe'
import { config } from '../../config/index.js'
import type { PlanId } from '../payments/planLimits.js'

let _stripe: Stripe | null = null

function getStripe(): Stripe {
  if (!_stripe) {
    if (!config.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not configured')
    }
    _stripe = new Stripe(config.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
  }
  return _stripe
}

function getPriceIdMap(): Record<PlanId, string | undefined> {
  return {
    starter: config.STRIPE_PRICE_STARTER,
    growth: config.STRIPE_PRICE_GROWTH,
    enterprise: config.STRIPE_PRICE_ENTERPRISE,
  }
}

function getPriceId(planId: PlanId): string {
  const priceId = getPriceIdMap()[planId]
  if (!priceId) {
    throw new Error(`Stripe price ID not configured for plan: ${planId}`)
  }
  return priceId
}

/**
 * Reverse lookup: which PlanId does this Stripe price ID correspond to?
 * Used to derive the CURRENT plan from a subscription's actual price on
 * customer.subscription.updated, instead of trusting subscription metadata
 * (which is only set once at checkout and never updated when the price
 * changes via the Stripe Customer Portal or dashboard).
 */
export function getPlanIdFromPriceId(priceId: string | undefined | null): PlanId | null {
  if (!priceId) return null
  const priceMap = getPriceIdMap()
  for (const [planId, mappedPriceId] of Object.entries(priceMap) as [
    PlanId,
    string | undefined,
  ][]) {
    if (mappedPriceId === priceId) return planId
  }
  return null
}

export async function createCustomer(email: string, orgId: string): Promise<Stripe.Customer> {
  const stripe = getStripe()
  return stripe.customers.create({
    email,
    metadata: { orgId },
  })
}

export async function createCheckoutSession(
  orgId: string,
  planId: PlanId,
  email: string,
  successUrl: string,
  cancelUrl: string,
  existingCustomerId?: string
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe()
  const priceId = getPriceId(planId)

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: {
      trial_period_days: 30,
      metadata: { orgId, planId },
    },
    metadata: { orgId, planId },
  }

  if (existingCustomerId) {
    params.customer = existingCustomerId
  } else {
    params.customer_email = email
  }

  return stripe.checkout.sessions.create(params)
}

export async function createCustomerPortalSession(
  customerId: string,
  returnUrl: string
): Promise<Stripe.BillingPortal.Session> {
  const stripe = getStripe()
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  })
}

export function constructWebhookEvent(payload: Buffer, sig: string): Stripe.Event {
  const stripe = getStripe()
  if (!config.STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured')
  }
  return stripe.webhooks.constructEvent(payload, sig, config.STRIPE_WEBHOOK_SECRET)
}

export async function getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  const stripe = getStripe()
  return stripe.subscriptions.retrieve(subscriptionId)
}

/**
 * Schedules (or un-schedules) cancellation at the end of the current paid
 * period — this is deliberately NOT stripe.subscriptions.cancel()/del(),
 * which would end access immediately. Setting cancel_at_period_end keeps the
 * subscription (and access) active until Stripe's own
 * customer.subscription.deleted event fires at the real period end.
 */
export async function updateSubscriptionCancelAtPeriodEnd(
  subscriptionId: string,
  cancelAtPeriodEnd: boolean
): Promise<Stripe.Subscription> {
  const stripe = getStripe()
  return stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: cancelAtPeriodEnd })
}

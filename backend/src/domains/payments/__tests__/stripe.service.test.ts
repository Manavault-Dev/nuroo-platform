import { describe, it, expect, vi } from 'vitest'

vi.mock('stripe', () => ({ default: vi.fn() }))

vi.mock('../../../config/index.js', () => ({
  config: {
    STRIPE_SECRET_KEY: 'sk_test_mock',
    STRIPE_PRICE_STARTER: 'price_starter_123',
    STRIPE_PRICE_GROWTH: 'price_growth_456',
    STRIPE_PRICE_ENTERPRISE: 'price_enterprise_789',
  },
}))

import { getPlanIdFromPriceId } from '../stripe.service.js'

describe('getPlanIdFromPriceId', () => {
  it('resolves the starter price id', () => {
    expect(getPlanIdFromPriceId('price_starter_123')).toBe('starter')
  })

  it('resolves the growth price id', () => {
    expect(getPlanIdFromPriceId('price_growth_456')).toBe('growth')
  })

  it('resolves the enterprise price id', () => {
    expect(getPlanIdFromPriceId('price_enterprise_789')).toBe('enterprise')
  })

  it('returns null for an unrecognized price id', () => {
    expect(getPlanIdFromPriceId('price_unknown_000')).toBeNull()
  })

  it('returns null for undefined/null input', () => {
    expect(getPlanIdFromPriceId(undefined)).toBeNull()
    expect(getPlanIdFromPriceId(null)).toBeNull()
  })
})

/**
 * Unit tests for payments.service.ts — focused on the logic paths that don't
 * require live Finik request signing (createPayment's config/plan guards,
 * handleWebhook's delegation to payments.repository, verifyPayment, and the
 * plan price/name accessors). The signed-request path inside createPayment
 * (Signer + fetch to the real Finik API) mirrors the same pattern already
 * deliberately left untested at the provider level (see provider.test.ts /
 * webhook.test.ts, which test FinikPaymentProvider.validateConfig and
 * handleWebhook but not createInvoice's signing path) — the
 * `@mancho.devs/authorizer` native signer isn't mocked anywhere in this
 * codebase, so exercising it here would mean signing with a fake PEM, not
 * testing real behavior.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../../config/index.js', () => ({
  config: {
    FINIK_API_URL: 'https://api.acquiring.averspay.kg/payment',
    FINIK_API_KEY: 'test-api-key',
    FINIK_ACCOUNT_ID: 'test-account-id',
    FINIK_PRIVATE_PEM: 'test-private-pem',
    FINIK_WEBHOOK_URL: '',
    BACKEND_PUBLIC_URL: 'http://localhost:3101',
    NEXT_PUBLIC_B2B_URL: 'http://localhost:3000',
    FINIK_DEBUG_SIGNATURE: '0',
  },
}))

const mockCreatePaymentRecord = vi.fn()
const mockUpdatePaymentStatus = vi.fn()
const mockGetPayment = vi.fn()
const mockGetPaymentByFinikTransaction = vi.fn()
const mockCreateOrUpdateBillingPlan = vi.fn()

vi.mock('../payments.repository.js', () => ({
  createPaymentRecord: (...args: unknown[]) => mockCreatePaymentRecord(...args),
  updatePaymentStatus: (...args: unknown[]) => mockUpdatePaymentStatus(...args),
  getPayment: (...args: unknown[]) => mockGetPayment(...args),
  getPaymentByFinikTransaction: (...args: unknown[]) => mockGetPaymentByFinikTransaction(...args),
  createOrUpdateBillingPlan: (...args: unknown[]) => mockCreateOrUpdateBillingPlan(...args),
}))

describe('payments.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── createPayment — guards reachable before Finik request signing ──────

  describe('createPayment', () => {
    it('throws "Invalid plan" for an unknown planId before any signing/network call', async () => {
      const { createPayment } = await import('../payments.service.js')

      await expect(
        createPayment({ planId: 'not-a-real-plan' as never, orgId: 'org1' }, 'user1')
      ).rejects.toThrow('Invalid plan: not-a-real-plan')

      expect(mockCreatePaymentRecord).not.toHaveBeenCalled()
    })
  })

  // ── verifyPayment ────────────────────────────────────────────────────────

  describe('verifyPayment', () => {
    it('returns ok:false when the payment does not exist', async () => {
      mockGetPayment.mockResolvedValue(null)
      const { verifyPayment } = await import('../payments.service.js')

      const result = await verifyPayment('missing_payment')

      expect(result).toEqual({ ok: false, error: 'Payment not found' })
    })

    it('returns the payment projection (id/status/planId/amount/currency) on success', async () => {
      mockGetPayment.mockResolvedValue({
        paymentId: 'pay_1',
        orgId: 'org1',
        status: 'paid',
        planId: 'growth',
        amount: 9900,
        currency: 'KGS',
        finikTransactionId: 'txn_1',
      })
      const { verifyPayment } = await import('../payments.service.js')

      const result = await verifyPayment('pay_1')

      expect(result).toEqual({
        ok: true,
        orgId: 'org1',
        payment: { id: 'pay_1', status: 'paid', planId: 'growth', amount: 9900, currency: 'KGS' },
      })
    })
  })

  // ── handleWebhook ────────────────────────────────────────────────────────

  describe('handleWebhook', () => {
    it('returns ok:false when no payment matches the Finik transaction id', async () => {
      mockGetPaymentByFinikTransaction.mockResolvedValue(null)
      const { handleWebhook } = await import('../payments.service.js')

      const result = await handleWebhook({
        paymentId: 'finik_txn_missing',
        status: 'completed',
        amount: 9900,
        currency: 'KGS',
      })

      expect(result).toEqual({ ok: false, error: 'Payment not found' })
      expect(mockUpdatePaymentStatus).not.toHaveBeenCalled()
    })

    it('updates payment status and upgrades the org billing plan when completed', async () => {
      mockGetPaymentByFinikTransaction.mockResolvedValue({
        paymentId: 'pay_1',
        orgId: 'org1',
        planId: 'growth',
      })
      const { handleWebhook } = await import('../payments.service.js')

      const result = await handleWebhook({
        paymentId: 'finik_txn_1',
        status: 'completed',
        amount: 9900,
        currency: 'KGS',
      })

      expect(result).toEqual({ ok: true, paymentId: 'pay_1' })
      expect(mockUpdatePaymentStatus).toHaveBeenCalledWith('pay_1', 'completed', 'finik_txn_1')
      expect(mockCreateOrUpdateBillingPlan).toHaveBeenCalledWith('org1', 'growth', 30)
    })

    it('does NOT touch the billing plan for a non-completed status', async () => {
      mockGetPaymentByFinikTransaction.mockResolvedValue({
        paymentId: 'pay_1',
        orgId: 'org1',
        planId: 'growth',
      })
      const { handleWebhook } = await import('../payments.service.js')

      await handleWebhook({
        paymentId: 'finik_txn_1',
        status: 'failed',
        amount: 9900,
        currency: 'KGS',
      })

      expect(mockCreateOrUpdateBillingPlan).not.toHaveBeenCalled()
    })

    it('does NOT touch the billing plan when completed but planId is not one of the 3 known plans', async () => {
      mockGetPaymentByFinikTransaction.mockResolvedValue({
        paymentId: 'pay_1',
        orgId: 'org1',
        planId: 'some_legacy_plan_id',
      })
      const { handleWebhook } = await import('../payments.service.js')

      await handleWebhook({
        paymentId: 'finik_txn_1',
        status: 'completed',
        amount: 9900,
        currency: 'KGS',
      })

      expect(mockCreateOrUpdateBillingPlan).not.toHaveBeenCalled()
    })
  })

  // ── getPlanPrices / getPlanNames ─────────────────────────────────────────

  describe('getPlanPrices / getPlanNames', () => {
    it('returns the 3 known plans with their prices and display names', async () => {
      const { getPlanPrices, getPlanNames } = await import('../payments.service.js')

      expect(getPlanPrices()).toEqual({ starter: 4900, growth: 9900, enterprise: 19900 })
      expect(getPlanNames()).toEqual({
        starter: 'Starter',
        growth: 'Growth',
        enterprise: 'Enterprise',
      })
    })
  })
})

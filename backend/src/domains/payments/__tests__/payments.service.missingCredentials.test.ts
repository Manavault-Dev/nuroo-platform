/**
 * Isolated from payments.service.test.ts because FINIK_API_KEY/ACCOUNT_ID/
 * PRIVATE_PEM are read from config into module-level constants at import
 * time — this file needs its own module instance with those left empty to
 * exercise the "not configured" guard.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../../config/index.js', () => ({
  config: {
    FINIK_API_URL: 'https://api.acquiring.averspay.kg/payment',
    FINIK_API_KEY: '',
    FINIK_ACCOUNT_ID: '',
    FINIK_PRIVATE_PEM: '',
    BACKEND_PUBLIC_URL: 'http://localhost:3101',
    NEXT_PUBLIC_B2B_URL: 'http://localhost:3000',
  },
}))

vi.mock('../payments.repository.js', () => ({
  createPaymentRecord: vi.fn(),
  updatePaymentStatus: vi.fn(),
  getPayment: vi.fn(),
  getPaymentByFinikTransaction: vi.fn(),
  createOrUpdateBillingPlan: vi.fn(),
}))

describe('createPayment — missing Finik credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws "Finik payment system is not configured" when API key/account id/private key are all empty', async () => {
    const { createPayment } = await import('../payments.service.js')

    await expect(createPayment({ planId: 'starter', orgId: 'org1' }, 'user1')).rejects.toThrow(
      'Finik payment system is not configured'
    )
  })
})

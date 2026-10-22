/**
 * Regression test: POST /webhooks/finik must fail closed (reject) when
 * FINIK_WEBHOOK_SECRET is not configured, instead of skipping signature
 * verification and processing an unauthenticated payment payload.
 *
 * Kept in a separate file from webhookRoute.integration.test.ts because the
 * config mock there hardcodes a non-empty secret at module load time.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('../../../config/index.js', () => ({
  config: {
    FINIK_WEBHOOK_SECRET: '',
    BACKEND_PUBLIC_URL: 'http://localhost:3101',
    NEXT_PUBLIC_B2B_URL: 'http://localhost:3000',
  },
}))

const mockUpdateInvoiceStatus = vi.fn().mockResolvedValue({})

vi.mock('../invoice.service.js', () => ({
  updateInvoiceStatus: mockUpdateInvoiceStatus,
  getInvoice: vi.fn().mockResolvedValue(null),
}))

const mockCaptureMessage = vi.fn()
vi.mock('@sentry/node', () => ({
  captureMessage: mockCaptureMessage,
  captureException: vi.fn(),
}))

vi.mock('firebase-admin', () => ({
  default: {
    firestore: {
      FieldValue: { serverTimestamp: () => new Date() },
    },
  },
}))

vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(() => ({
    doc: vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue({ exists: false }),
      set: vi.fn().mockResolvedValue({}),
    }),
  })),
}))

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  const { webhookRoutes } = await import('../webhook.routes.js')
  await app.register(webhookRoutes)
  await app.ready()
  return app
}

describe('POST /webhooks/finik — missing FINIK_WEBHOOK_SECRET', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 500 WEBHOOK_NOT_CONFIGURED and never reaches the handler, even with no signature header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/finik',
      headers: { 'content-type': 'application/json' },
      payload: { reference: 'org1__inv_001', status: 'completed' },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toMatchObject({ code: 'WEBHOOK_NOT_CONFIGURED' })
    expect(mockUpdateInvoiceStatus).not.toHaveBeenCalled()
  })

  it('returns 500 WEBHOOK_NOT_CONFIGURED even when an attacker supplies a plausible-looking signature header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/finik',
      headers: {
        'content-type': 'application/json',
        'x-signature': 'a'.repeat(64),
      },
      payload: { reference: 'org1__inv_001', status: 'completed' },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toMatchObject({ code: 'WEBHOOK_NOT_CONFIGURED' })
    expect(mockUpdateInvoiceStatus).not.toHaveBeenCalled()
  })

  it('reports the misconfiguration to Sentry at error level', async () => {
    await app.inject({
      method: 'POST',
      url: '/webhooks/finik',
      headers: { 'content-type': 'application/json' },
      payload: { reference: 'org1__inv_001', status: 'completed' },
    })

    expect(mockCaptureMessage).toHaveBeenCalledWith(
      'finik_webhook_secret_not_configured',
      expect.objectContaining({ level: 'error' })
    )
  })
})

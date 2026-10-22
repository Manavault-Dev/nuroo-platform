/**
 * Integration tests for the phone-OTP login flow (/auth/phone/send-otp,
 * /auth/phone/verify-otp). WhatsApp sending and Firebase custom-token
 * minting are mocked; the OTP/rate-limit/userPhones logic runs for real
 * against a tiny in-memory Firestore fake so a sequence of calls (send then
 * verify) actually shares state the way the real route does.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

// ─── In-memory Firestore fake (shared mutable state across calls in a test) ──

const store = new Map<string, Record<string, unknown> | undefined>()

function timestampFromMillis(ms: number) {
  return { toMillis: () => ms, _ms: ms }
}

vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(() => ({
    doc: vi.fn((path: string) => ({
      get: vi.fn(async () => {
        const data = store.get(path)
        return { exists: data !== undefined, data: () => data }
      }),
      set: vi.fn(async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
        if (opts?.merge) {
          store.set(path, { ...(store.get(path) ?? {}), ...data })
        } else {
          store.set(path, data)
        }
      }),
      update: vi.fn(async (data: Record<string, unknown>) => {
        store.set(path, { ...(store.get(path) ?? {}), ...data })
      }),
      delete: vi.fn(async () => {
        store.delete(path)
      }),
    })),
    collection: vi.fn((name: string) => ({
      doc: vi.fn(() => {
        const id = `fake_${Math.random().toString(36).slice(2, 10)}`
        const path = `${name}/${id}`
        return {
          id,
          get: vi.fn(async () => {
            const data = store.get(path)
            return { exists: data !== undefined, data: () => data }
          }),
          set: vi.fn(async (data: Record<string, unknown>) => {
            store.set(path, data)
          }),
        }
      }),
    })),
  })),
}))

const mockSendOtp = vi.fn().mockResolvedValue(undefined)
vi.mock('../../../modules/whatsapp/whatsapp.provider.js', () => ({
  getWhatsAppOtpProvider: () => ({ sendOtp: mockSendOtp }),
}))

const mockCreateCustomToken = vi.fn().mockResolvedValue('fake-custom-token')
vi.mock('firebase-admin', () => ({
  default: {
    firestore: {
      Timestamp: {
        now: () => timestampFromMillis(Date.now()),
        fromMillis: (ms: number) => timestampFromMillis(ms),
      },
    },
    auth: () => ({ createCustomToken: mockCreateCustomToken }),
  },
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  const { phoneAuthRoutes } = await import('../phoneAuth.routes.js')
  await app.register(phoneAuthRoutes)
  await app.ready()
  return app
}

const PHONE = '+996555123456'

describe('POST /auth/phone/send-otp', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    store.clear()
    app = await buildApp()
  })

  afterEach(async () => {
    await app?.close()
  })

  it('sends an OTP via WhatsApp and stores it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/phone/send-otp',
      payload: { phone: PHONE },
    })
    expect(res.statusCode).toBe(200)
    expect(mockSendOtp).toHaveBeenCalledTimes(1)
    expect(mockSendOtp).toHaveBeenCalledWith(PHONE, expect.stringMatching(/^\d{6}$/))
    expect(store.get(`phoneOtps/${PHONE}`)).toBeDefined()
  })

  it('rejects an invalid phone format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/phone/send-otp',
      payload: { phone: 'not-a-phone' },
    })
    expect(res.statusCode).toBe(400)
    expect(mockSendOtp).not.toHaveBeenCalled()
  })

  it('throttles an immediate resend within the cooldown window', async () => {
    await app.inject({ method: 'POST', url: '/auth/phone/send-otp', payload: { phone: PHONE } })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/phone/send-otp',
      payload: { phone: PHONE },
    })
    expect(res.statusCode).toBe(429)
    expect(mockSendOtp).toHaveBeenCalledTimes(1)
  })
})

describe('POST /auth/phone/verify-otp', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    store.clear()
    app = await buildApp()
  })

  afterEach(async () => {
    await app?.close()
  })

  async function sendOtpAndGetCode(): Promise<string> {
    await app.inject({ method: 'POST', url: '/auth/phone/send-otp', payload: { phone: PHONE } })
    return mockSendOtp.mock.calls[0][1] as string
  }

  it('verifies a correct code, creates a new uid, and mints a custom token', async () => {
    const code = await sendOtpAndGetCode()

    const res = await app.inject({
      method: 'POST',
      url: '/auth/phone/verify-otp',
      payload: { phone: PHONE, code },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.customToken).toBe('fake-custom-token')
    expect(mockCreateCustomToken).toHaveBeenCalledWith(body.uid)

    // userPhones index and users doc both got written for the new uid
    expect(store.get(`userPhones/${PHONE}`)).toMatchObject({ uid: body.uid })
    expect(store.get(`users/${body.uid}`)).toMatchObject({ phoneNumber: PHONE })

    // OTP doc consumed
    expect(store.get(`phoneOtps/${PHONE}`)).toBeUndefined()
  })

  it('reuses the same uid on a second login for the same phone number', async () => {
    const firstCode = await sendOtpAndGetCode()
    const firstRes = await app.inject({
      method: 'POST',
      url: '/auth/phone/verify-otp',
      payload: { phone: PHONE, code: firstCode },
    })
    const firstUid = firstRes.json().uid

    // Simulate a second login some time later
    vi.clearAllMocks()
    const secondCode = await sendOtpAndGetCode()
    const secondRes = await app.inject({
      method: 'POST',
      url: '/auth/phone/verify-otp',
      payload: { phone: PHONE, code: secondCode },
    })

    expect(secondRes.json().uid).toBe(firstUid)
  })

  it('rejects an incorrect code without consuming the OTP', async () => {
    await sendOtpAndGetCode()

    const res = await app.inject({
      method: 'POST',
      url: '/auth/phone/verify-otp',
      payload: { phone: PHONE, code: '000000' },
    })

    expect(res.statusCode).toBe(400)
    expect(store.get(`phoneOtps/${PHONE}`)).toMatchObject({ attempts: 1 })
    expect(mockCreateCustomToken).not.toHaveBeenCalled()
  })

  it('locks out after too many wrong attempts', async () => {
    await sendOtpAndGetCode()

    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: '/auth/phone/verify-otp',
        payload: { phone: PHONE, code: '000000' },
      })
    }

    const res = await app.inject({
      method: 'POST',
      url: '/auth/phone/verify-otp',
      payload: { phone: PHONE, code: '000000' },
    })
    expect(res.statusCode).toBe(429)
  })

  it('rejects verification when no code was ever requested', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/phone/verify-otp',
      payload: { phone: PHONE, code: '123456' },
    })
    expect(res.statusCode).toBe(400)
  })
})

/**
 * Unit tests for WhatsAppNotificationProvider — the booking-status-update
 * sender (separate from the OTP provider: different template/category).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ENV_KEYS = [
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_BOOKING_TEMPLATE_NAME',
  'WHATSAPP_BOOKING_TEMPLATE_LANG',
] as const

const ORIGINAL_ENV: Record<string, string | undefined> = {}

function setEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) {
    if (overrides[key] !== undefined) process.env[key] = overrides[key]
    else delete process.env[key]
  }
}

beforeEach(() => {
  for (const key of ENV_KEYS) ORIGINAL_ENV[key] = process.env[key]
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key]
    else process.env[key] = ORIGINAL_ENV[key]
  }
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('WhatsAppNotificationProvider', () => {
  it('throws a clear setup error when env vars are missing', async () => {
    setEnv({})
    const { WhatsAppNotificationProvider } = await import('../whatsappNotification.provider.js')
    expect(() => new WhatsAppNotificationProvider()).toThrow(/not configured/)
  })

  it('sends a template message with the 5 expected body parameters', async () => {
    setEnv({
      WHATSAPP_PHONE_NUMBER_ID: 'phone_123',
      WHATSAPP_ACCESS_TOKEN: 'token_abc',
      WHATSAPP_BOOKING_TEMPLATE_NAME: 'booking_status_update',
      WHATSAPP_BOOKING_TEMPLATE_LANG: 'ru',
    })

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)

    const { WhatsAppNotificationProvider } = await import('../whatsappNotification.provider.js')
    const provider = new WhatsAppNotificationProvider()

    await provider.sendBookingUpdate('+996555123456', {
      parentName: 'Айгерим',
      specialistName: 'Нурлан',
      date: '2026-11-05',
      time: '10:00',
      statusText: 'подтверждена',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v21.0/phone_123/messages')
    expect(options.headers.Authorization).toBe('Bearer token_abc')

    const body = JSON.parse(options.body)
    expect(body.to).toBe('996555123456') // leading + stripped
    expect(body.template.name).toBe('booking_status_update')
    expect(body.template.language.code).toBe('ru')
    expect(body.template.components[0].parameters).toEqual([
      { type: 'text', text: 'Айгерим' },
      { type: 'text', text: 'Нурлан' },
      { type: 'text', text: '2026-11-05' },
      { type: 'text', text: '10:00' },
      { type: 'text', text: 'подтверждена' },
    ])
  })

  it('throws when the Cloud API responds with a non-OK status', async () => {
    setEnv({
      WHATSAPP_PHONE_NUMBER_ID: 'phone_123',
      WHATSAPP_ACCESS_TOKEN: 'token_abc',
      WHATSAPP_BOOKING_TEMPLATE_NAME: 'booking_status_update',
      WHATSAPP_BOOKING_TEMPLATE_LANG: 'ru',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'bad request' })
    )

    const { WhatsAppNotificationProvider } = await import('../whatsappNotification.provider.js')
    const provider = new WhatsAppNotificationProvider()

    await expect(
      provider.sendBookingUpdate('+996555123456', {
        parentName: 'Айгерим',
        specialistName: 'Нурлан',
        date: '2026-11-05',
        time: '10:00',
        statusText: 'отменена',
      })
    ).rejects.toThrow(/WhatsApp Cloud API error \(400\)/)
  })
})

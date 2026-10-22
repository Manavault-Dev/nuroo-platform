/**
 * WhatsAppNotificationProvider — sends booking status updates (confirmed /
 * cancelled) via the WhatsApp Cloud API, using the same Meta direct
 * integration as the phone-OTP provider (whatsapp.provider.ts) but a
 * separate "Utility" category template — OTP uses "Authentication" category,
 * which has a different structure (autofill button) and a stricter Meta
 * review process than a plain status-update message.
 *
 * Requires env vars (separate from the OTP provider's, since this is a
 * different approved template):
 *   WHATSAPP_PHONE_NUMBER_ID         — same Cloud API sender as OTP
 *   WHATSAPP_ACCESS_TOKEN            — same System User token as OTP
 *   WHATSAPP_BOOKING_TEMPLATE_NAME   — name of the approved "Utility"
 *                                      category template (e.g. "booking_status_update")
 *   WHATSAPP_BOOKING_TEMPLATE_LANG   — template language code (e.g. "ru")
 *
 * None of these exist yet — same WABA-setup blocker as phone OTP. This
 * provider throws a clear setup error until the template is approved in
 * Meta Business Manager, so callers must treat it as best-effort (never
 * block the booking flow on it).
 *
 * Template body is expected to have 5 variables, in order:
 *   {{1}} parent name   {{2}} specialist name   {{3}} date   {{4}} time
 *   {{5}} status text (e.g. "подтверждена" / "отменена")
 */

const GRAPH_API_VERSION = 'v21.0'

export interface BookingWhatsAppNotification {
  parentName: string
  specialistName: string
  date: string
  time: string
  statusText: string
}

export class WhatsAppNotificationProvider {
  private readonly phoneNumberId: string
  private readonly accessToken: string
  private readonly templateName: string
  private readonly templateLang: string

  constructor() {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
    const templateName = process.env.WHATSAPP_BOOKING_TEMPLATE_NAME
    const templateLang = process.env.WHATSAPP_BOOKING_TEMPLATE_LANG

    if (!phoneNumberId || !accessToken || !templateName || !templateLang) {
      throw new Error(
        'WhatsApp booking notifications are not configured — set WHATSAPP_PHONE_NUMBER_ID, ' +
          'WHATSAPP_ACCESS_TOKEN, WHATSAPP_BOOKING_TEMPLATE_NAME, WHATSAPP_BOOKING_TEMPLATE_LANG'
      )
    }

    this.phoneNumberId = phoneNumberId
    this.accessToken = accessToken
    this.templateName = templateName
    this.templateLang = templateLang
  }

  /** `e164Phone` must already be normalized (e.g. "+996555123456"). */
  async sendBookingUpdate(e164Phone: string, data: BookingWhatsAppNotification): Promise<void> {
    const to = e164Phone.replace(/^\+/, '')
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${this.phoneNumberId}/messages`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: this.templateName,
          language: { code: this.templateLang },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: data.parentName },
                { type: 'text', text: data.specialistName },
                { type: 'text', text: data.date },
                { type: 'text', text: data.time },
                { type: 'text', text: data.statusText },
              ],
            },
          ],
        },
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`WhatsApp Cloud API error (${res.status}): ${body}`)
    }
  }
}

/** Singleton — lazily initialized so tests/dev without the env vars can skip it */
let _provider: WhatsAppNotificationProvider | null = null

export function getWhatsAppNotificationProvider(): WhatsAppNotificationProvider {
  if (!_provider) _provider = new WhatsAppNotificationProvider()
  return _provider
}

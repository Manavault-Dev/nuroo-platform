/**
 * WhatsAppOtpProvider — sends OTP codes via the WhatsApp Cloud API directly
 * (Meta-hosted, no BSP middleman — cheaper than SMS, chosen for Central Asia
 * reach/cost).
 *
 * Requires env vars:
 *   WHATSAPP_PHONE_NUMBER_ID  — the Cloud API sender number's ID
 *   WHATSAPP_ACCESS_TOKEN     — System User permanent access token
 *   WHATSAPP_TEMPLATE_NAME    — name of the approved "Authentication"
 *                               category template (e.g. "otp_login")
 *   WHATSAPP_TEMPLATE_LANG    — template language code (e.g. "en_US")
 *
 * None of these exist yet — this provider throws a clear setup error until
 * the Meta Business/WABA account is configured and the template is
 * approved. See the onboarding plan doc for the setup checklist.
 */

const GRAPH_API_VERSION = 'v21.0'

export class WhatsAppOtpProvider {
  private readonly phoneNumberId: string
  private readonly accessToken: string
  private readonly templateName: string
  private readonly templateLang: string

  constructor() {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
    const templateName = process.env.WHATSAPP_TEMPLATE_NAME
    const templateLang = process.env.WHATSAPP_TEMPLATE_LANG

    if (!phoneNumberId || !accessToken || !templateName || !templateLang) {
      throw new Error(
        'WhatsApp OTP is not configured — set WHATSAPP_PHONE_NUMBER_ID, ' +
          'WHATSAPP_ACCESS_TOKEN, WHATSAPP_TEMPLATE_NAME, WHATSAPP_TEMPLATE_LANG'
      )
    }

    this.phoneNumberId = phoneNumberId
    this.accessToken = accessToken
    this.templateName = templateName
    this.templateLang = templateLang
  }

  /**
   * Sends a one-time code via an approved "Authentication" template.
   * `e164Phone` must already be normalized (e.g. "+996555123456") — the
   * Cloud API wants it without the leading "+".
   */
  async sendOtp(e164Phone: string, code: string): Promise<void> {
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
              parameters: [{ type: 'text', text: code }],
            },
            // Meta's Authentication templates put the code again in a
            // "copy code" / "one-tap autofill" quick-reply button.
            {
              type: 'button',
              sub_type: 'url',
              index: '0',
              parameters: [{ type: 'text', text: code }],
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
let _provider: WhatsAppOtpProvider | null = null

export function getWhatsAppOtpProvider(): WhatsAppOtpProvider {
  if (!_provider) _provider = new WhatsAppOtpProvider()
  return _provider
}

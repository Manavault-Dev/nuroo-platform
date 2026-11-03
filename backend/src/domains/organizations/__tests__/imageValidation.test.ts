/**
 * Unit tests for the image/URL validation hardening added after a QA pass:
 * - sniffImageMimeType: never trust a client-declared mimetype for uploaded
 *   images — reject anything that isn't actually PNG/JPEG/WebP by magic
 *   bytes (an SVG masquerading as "image/svg+xml" could otherwise be
 *   uploaded and served publicly, executing embedded <script> content).
 * - safeHttpUrlSchema: zod's .url() accepts `javascript:` URIs; this
 *   restricts to http(s) so a stored org website/source URL can't become a
 *   stored-XSS vector when rendered as a clickable link.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(),
  getStorageBucket: vi.fn(),
}))
vi.mock('../../payments/planLimits.js', () => ({
  FREE_TRIAL_DAYS: 30,
  FREE_TRIAL_PLAN_ID: 'enterprise',
}))
vi.mock('../../../infrastructure/auth/rbac.js', () => ({
  requireOrgMember: vi.fn(),
  requirePlatformAdmin: vi.fn(),
}))
vi.mock('../../../infrastructure/audit/audit.js', () => ({
  writeAudit: vi.fn(),
}))

const { sniffImageMimeType, safeHttpUrlSchema, parseDataImageUrl } =
  await import('../orgs.routes.js')

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
const WEBP_HEADER = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
])
const SVG_WITH_SCRIPT = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>',
  'utf-8'
)

describe('sniffImageMimeType', () => {
  it('recognizes a real PNG by magic bytes', () => {
    expect(sniffImageMimeType(PNG_1X1)).toBe('image/png')
  })

  it('recognizes a real JPEG by magic bytes', () => {
    expect(sniffImageMimeType(JPEG_HEADER)).toBe('image/jpeg')
  })

  it('recognizes a real WebP by magic bytes', () => {
    expect(sniffImageMimeType(WEBP_HEADER)).toBe('image/webp')
  })

  it('rejects an SVG with an embedded <script>, regardless of claimed mimetype', () => {
    expect(sniffImageMimeType(SVG_WITH_SCRIPT)).toBeNull()
  })

  it('rejects arbitrary non-image content', () => {
    expect(sniffImageMimeType(Buffer.from('not an image at all'))).toBeNull()
  })

  it('rejects an empty buffer', () => {
    expect(sniffImageMimeType(Buffer.alloc(0))).toBeNull()
  })
})

describe('parseDataImageUrl + sniffImageMimeType together reject a spoofed SVG upload', () => {
  it('a data:image/svg+xml payload decodes fine but fails the content sniff', () => {
    const dataUrl = `data:image/svg+xml;base64,${SVG_WITH_SCRIPT.toString('base64')}`
    const parsed = parseDataImageUrl(dataUrl)
    expect(parsed).not.toBeNull()
    // The declared mimetype says svg+xml, but the actual decoded content
    // must never be trusted — sniffing it must come back null.
    expect(sniffImageMimeType(parsed!.buffer)).toBeNull()
  })

  it('a data:image/png payload with real PNG bytes sniffs correctly', () => {
    const dataUrl = `data:image/png;base64,${PNG_1X1.toString('base64')}`
    const parsed = parseDataImageUrl(dataUrl)
    expect(sniffImageMimeType(parsed!.buffer)).toBe('image/png')
  })
})

describe('safeHttpUrlSchema', () => {
  const schema = safeHttpUrlSchema(500)

  it('accepts a normal https URL', () => {
    expect(schema.safeParse('https://example.com').success).toBe(true)
  })

  it('accepts a normal http URL', () => {
    expect(schema.safeParse('http://example.com').success).toBe(true)
  })

  it('rejects a javascript: URI', () => {
    expect(schema.safeParse('javascript:alert(document.cookie)').success).toBe(false)
  })

  it('rejects a data: URI', () => {
    expect(schema.safeParse('data:text/html,<script>alert(1)</script>').success).toBe(false)
  })

  it('rejects a non-URL string', () => {
    expect(schema.safeParse('not a url').success).toBe(false)
  })
})

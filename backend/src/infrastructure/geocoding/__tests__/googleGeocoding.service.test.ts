import { describe, it, expect, afterEach, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.doUnmock('../../../config/index.js')
})

async function loadWithApiKey(apiKey: string | undefined) {
  vi.doMock('../../../config/index.js', () => ({ config: { GOOGLE_MAPS_API_KEY: apiKey } }))
  const mod = await import('../googleGeocoding.service.js')
  return mod.geocodeAddress
}

describe('geocodeAddress', () => {
  it('returns null without calling the network when no API key is configured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const geocodeAddress = await loadWithApiKey(undefined)

    const result = await geocodeAddress('проспект Жибек-Жолу, 445', { country: 'KG' })

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null for a blank address without calling the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const geocodeAddress = await loadWithApiKey('test-key')

    const result = await geocodeAddress('   ')

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns coordinates parsed from a successful Google Geocoding response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'OK',
        results: [{ geometry: { location: { lat: 42.8746, lng: 74.6122 } } }],
      }),
    } as Response)
    const geocodeAddress = await loadWithApiKey('test-key')

    const result = await geocodeAddress('проспект Жибек-Жолу, 445', {
      country: 'KG',
      city: 'Бишкек',
    })

    expect(result).toEqual({ lat: 42.8746, lng: 74.6122 })
  })

  it('biases the request toward the organization country via the region param', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'OK',
        results: [{ geometry: { location: { lat: 1, lng: 2 } } }],
      }),
    } as Response)
    const geocodeAddress = await loadWithApiKey('test-key')

    await geocodeAddress('ул. Советская, 1', { country: 'KG' })

    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string
    expect(calledUrl).toContain('region=kg')
  })

  it('skips the region bias for a country that is not a real geocoding region (e.g. ONLINE)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'OK',
        results: [{ geometry: { location: { lat: 1, lng: 2 } } }],
      }),
    } as Response)
    const geocodeAddress = await loadWithApiKey('test-key')

    await geocodeAddress('some address', { country: 'ONLINE' })

    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string
    expect(calledUrl).not.toContain('region=')
  })

  it('returns null when Google reports a non-OK status (e.g. ZERO_RESULTS)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ZERO_RESULTS', results: [] }),
    } as Response)
    const geocodeAddress = await loadWithApiKey('test-key')

    const result = await geocodeAddress('a nonexistent address')

    expect(result).toBeNull()
  })

  it('returns null when the HTTP request itself fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response)
    const geocodeAddress = await loadWithApiKey('test-key')

    const result = await geocodeAddress('some address')

    expect(result).toBeNull()
  })

  it('returns null and does not throw when fetch rejects (network error)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    const geocodeAddress = await loadWithApiKey('test-key')

    await expect(geocodeAddress('some address')).resolves.toBeNull()
  })
})

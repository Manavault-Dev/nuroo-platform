import { config } from '../../config/index.js'

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'
// Runs inside user-facing requests (org creation): never let a slow Google
// response hold the request open.
const GEOCODE_TIMEOUT_MS = 3000

export interface GeocodeResult {
  lat: number
  lng: number
}

interface GeocodeOptions {
  country?: string | null
  city?: string | null
}

/**
 * Best-effort — a missing API key, a network error, or an address Google
 * can't resolve must never block an organization write. Callers treat a
 * null result as "no map pin for this org," not a failure.
 */
export async function geocodeAddress(
  address: string,
  options: GeocodeOptions = {}
): Promise<GeocodeResult | null> {
  const apiKey = config.GOOGLE_MAPS_API_KEY
  if (!apiKey || !address.trim()) return null

  const fullAddress = [address, options.city, resolveCountryLabel(options.country)]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join(', ')

  const params = new URLSearchParams({ address: fullAddress, key: apiKey })
  // Biases ambiguous street names (common across CIS cities) toward the
  // org's own country instead of resolving to the wrong one.
  const regionBias = resolveRegionCode(options.country)
  if (regionBias) params.set('region', regionBias)

  try {
    const res = await fetch(`${GEOCODE_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
    })
    if (!res.ok) return null

    const data = (await res.json()) as {
      status: string
      results?: Array<{ geometry?: { location?: { lat: unknown; lng: unknown } } }>
    }
    if (data.status !== 'OK') return null

    const location = data.results?.[0]?.geometry?.location
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      return null
    }
    return { lat: location.lat, lng: location.lng }
  } catch {
    return null
  }
}

function resolveRegionCode(country?: string | null): string | null {
  if (!country) return null
  const code = country.trim().toUpperCase()
  if (code === 'ONLINE' || code.length !== 2) return null
  return code.toLowerCase()
}

function resolveCountryLabel(country?: string | null): string | null {
  const code = resolveRegionCode(country)
  return code ? code.toUpperCase() : null
}

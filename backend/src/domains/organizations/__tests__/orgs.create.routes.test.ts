/**
 * POST /orgs — geocoding of the optional address at creation time.
 * Geocoding is best-effort: it must add lat/lng when it resolves, and must
 * never block or fail org creation when it doesn't.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

const mockGeocode = vi.fn()
vi.mock('../../../infrastructure/geocoding/googleGeocoding.service.js', () => ({
  geocodeAddress: (...args: unknown[]) => mockGeocode(...args),
}))

vi.mock('firebase-admin', () => ({
  default: {
    firestore: {
      Timestamp: {
        now: () => ({ __type: 'timestamp', value: 'now' }),
        fromDate: (d: Date) => ({ __type: 'timestamp', value: d.toISOString() }),
      },
    },
  },
}))

function makeFakeFirestore() {
  const store = new Map<string, any>()
  let autoId = 0

  function snapFor(path: string) {
    const data = store.get(path)
    return { id: path.split('/').pop()!, exists: data !== undefined, data: () => data }
  }

  function makeDocRef(path: string): any {
    return {
      id: path.split('/').pop()!,
      path,
      get: async () => snapFor(path),
      collection: (sub: string) => makeCollectionRef(`${path}/${sub}`),
      set: async (data: any) => {
        store.set(path, data)
      },
      update: async (data: any) => {
        store.set(path, { ...store.get(path), ...data })
      },
    }
  }

  function makeCollectionRef(path: string): any {
    const filters: Array<[string, any]> = []
    const ref: any = {
      doc: (id?: string) => makeDocRef(`${path}/${id ?? `org${++autoId}`}`),
      where: (field: string, _op: string, value: any) => {
        filters.push([field, value])
        return ref
      },
      limit: () => ref,
      get: async () => {
        const prefix = `${path}/`
        const docs = [...store.keys()]
          .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
          .map((p) => snapFor(p))
          .filter((d) => filters.every(([f, v]) => d.data()?.[f] === v))
        return { empty: docs.length === 0, docs, size: docs.length }
      },
    }
    return ref
  }

  return {
    store,
    db: {
      doc: (path: string) => makeDocRef(path),
      collection: (path: string) => makeCollectionRef(path),
    },
  }
}

let fakeDb: ReturnType<typeof makeFakeFirestore>

vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(() => fakeDb.db),
  getStorageBucket: vi.fn(),
}))

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    ;(request as unknown as { user: { uid: string; email: string } }).user = {
      uid: 'owner_1',
      email: 'owner@example.com',
    }
  })
  const { orgsRoute } = await import('../orgs.routes.js')
  await app.register(orgsRoute)
  await app.ready()
  return app
}

const ZW = String.fromCharCode(0x200b)

describe('POST /orgs geocoding', () => {
  let app: FastifyInstance

  beforeEach(() => {
    vi.clearAllMocks()
    fakeDb = makeFakeFirestore()
  })

  afterEach(async () => {
    await app?.close()
  })

  function savedOrg() {
    const entry = [...fakeDb.store.entries()].find(([path]) => /^organizations\/[^/]+$/.test(path))
    return entry?.[1]
  }

  it('stores coordinates, city and address when the address geocodes', async () => {
    mockGeocode.mockResolvedValue({ lat: 42.858491, lng: 74.627342 })
    app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/orgs',
      payload: {
        name: 'AlphaKids',
        country: 'KG',
        city: 'Бишкек',
        address: 'Кара-Дарьинская улица, 85',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(mockGeocode).toHaveBeenCalledWith('Кара-Дарьинская улица, 85', {
      country: 'KG',
      city: 'Бишкек',
    })
    expect(savedOrg()).toMatchObject({
      city: 'Бишкек',
      address: 'Кара-Дарьинская улица, 85',
      lat: 42.858491,
      lng: 74.627342,
    })
  })

  it('creates the org without coordinates when geocoding returns null', async () => {
    mockGeocode.mockResolvedValue(null)
    app = await buildApp()

    const res = await app.inject({
      method: 'POST',
      url: '/orgs',
      payload: { name: 'Unmappable', address: 'нет такого адреса' },
    })

    expect(res.statusCode).toBe(200)
    const org = savedOrg()
    expect(org).toMatchObject({ name: 'Unmappable', address: 'нет такого адреса' })
    expect(org).not.toHaveProperty('lat')
    expect(org).not.toHaveProperty('lng')
  })

  it('does not call the geocoder when no address is provided', async () => {
    app = await buildApp()

    const res = await app.inject({ method: 'POST', url: '/orgs', payload: { name: 'No address' } })

    expect(res.statusCode).toBe(200)
    expect(mockGeocode).not.toHaveBeenCalled()
    const org = savedOrg()
    expect(org).not.toHaveProperty('address')
    expect(org).not.toHaveProperty('lat')
  })

  it('strips zero-width characters from the address before storing and geocoding', async () => {
    mockGeocode.mockResolvedValue(null)
    app = await buildApp()

    await app.inject({
      method: 'POST',
      url: '/orgs',
      payload: { name: 'Zero width', address: ZW + 'Улица Лермонтова, 8' + ZW },
    })

    expect(mockGeocode).toHaveBeenCalledWith('Улица Лермонтова, 8', expect.anything())
    expect(savedOrg()).toMatchObject({ address: 'Улица Лермонтова, 8' })
  })
})

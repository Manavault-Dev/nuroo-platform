/**
 * Route-level tests for POST /api/parent/organizations — self-serve "basic"
 * org creation (mobile's create-organization screen). Covers the richer
 * field set added alongside the mobile create-org form: description,
 * address, website, categories, cover image, and gallery photos.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

vi.mock('firebase-admin', () => ({
  default: {
    firestore: {
      FieldValue: { serverTimestamp: () => ({ __type: 'serverTimestamp' }) },
    },
  },
}))

const mockUploadOrgMarketplaceImage = vi.fn(
  async (_orgId: string, kind: string) => `https://storage.example.com/${kind}-uploaded.jpg`
)
vi.mock('../../../domains/organizations/orgs.routes.js', () => ({
  parseDataImageUrl: (value: string) =>
    value.startsWith('data:image/') ? { mimeType: 'image/png', buffer: Buffer.from('fake') } : null,
  uploadOrgMarketplaceImage: (...args: Parameters<typeof mockUploadOrgMarketplaceImage>) =>
    mockUploadOrgMarketplaceImage(...args),
  imageSourceSchema: (() => {
    const { z } = require('zod')
    return z
      .string()
      .trim()
      .max(900_000)
      .refine(
        (value: string) =>
          value.startsWith('data:image/') || z.string().url().safeParse(value).success,
        { message: 'Must be a valid URL or uploaded image' }
      )
  })(),
  safeHttpUrlSchema: (maxLength: number) => {
    const { z } = require('zod')
    return z
      .string()
      .trim()
      .max(maxLength)
      .refine(
        (value: string) => {
          try {
            const protocol = new URL(value).protocol
            return protocol === 'http:' || protocol === 'https:'
          } catch {
            return false
          }
        },
        { message: 'Must be a valid http(s) URL' }
      )
  },
}))

vi.mock('../../../domains/payments/planLimits.js', () => ({
  FREE_TRIAL_DAYS: 30,
  FREE_TRIAL_PLAN_ID: 'enterprise',
}))

type DocSnap = { exists: boolean; data: () => any }

function makeFakeFirestore() {
  const store = new Map<string, any>()
  function snapFor(path: string): DocSnap {
    const data = store.get(path)
    return { exists: data !== undefined, data: () => data }
  }
  let autoIdCounter = 0
  return {
    store,
    collection: (path: string) => ({
      where: () => ({
        where: () => ({
          limit: () => ({
            get: async () => {
              const prefix = `${path}/`
              const docs = [...store.keys()]
                .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
                .map((p) => snapFor(p))
              return { empty: docs.length === 0, docs }
            },
          }),
        }),
      }),
      doc: () => {
        const id = `auto${++autoIdCounter}`
        const path = `organizations/${id}`
        return {
          id,
          set: async (data: any) => store.set(path, data),
        }
      },
    }),
  }
}

let fakeDb: ReturnType<typeof makeFakeFirestore>
vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(() => fakeDb),
}))

async function buildApp(uid = 'creator_1'): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    ;(request as unknown as { user: { uid: string } }).user = { uid }
  })
  const { parentApiRoutes } = await import('../parent.routes.js')
  await app.register(parentApiRoutes)
  await app.ready()
  return app
}

describe('POST /api/parent/organizations', () => {
  let app: FastifyInstance

  beforeEach(() => {
    vi.clearAllMocks()
    fakeDb = makeFakeFirestore()
  })

  afterEach(async () => {
    await app?.close()
  })

  it('rejects when neither contactPhone nor whatsappNumber is provided', async () => {
    app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/parent/organizations',
      payload: { name: 'No Contact Org' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('creates a basic org with the full rich profile, uploading cover and gallery', async () => {
    app = await buildApp('creator_1')

    const res = await app.inject({
      method: 'POST',
      url: '/api/parent/organizations',
      payload: {
        name: 'Rich Org',
        contactPhone: '+996555000001',
        description: 'A great place',
        address: 'Main street 1',
        websiteUrl: 'https://example.com',
        categories: ['ABA', 'Psychology'],
        coverImageUrl: 'data:image/png;base64,ZmFrZQ==',
        photos: ['data:image/png;base64,ZmFrZQ==', 'https://already-hosted.example.com/b.jpg'],
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, name: 'Rich Org' })

    const orgId = res.json().orgId
    const org = fakeDb.store.get(`organizations/${orgId}`)
    expect(org).toMatchObject({
      name: 'Rich Org',
      description: 'A great place',
      address: 'Main street 1',
      websiteUrl: 'https://example.com',
      categories: ['ABA', 'Psychology'],
      coverImageUrl: 'https://storage.example.com/cover-uploaded.jpg',
      tier: 'basic',
      createdBy: 'creator_1',
    })
    expect(org.photos).toEqual([
      'https://storage.example.com/photo-uploaded.jpg',
      'https://already-hosted.example.com/b.jpg',
    ])
  })

  it('defaults optional rich fields to null/empty when omitted', async () => {
    app = await buildApp('creator_1')

    const res = await app.inject({
      method: 'POST',
      url: '/api/parent/organizations',
      payload: { name: 'Bare Org', whatsappNumber: '+996555000002' },
    })

    expect(res.statusCode).toBe(200)
    const orgId = res.json().orgId
    const org = fakeDb.store.get(`organizations/${orgId}`)
    expect(org).toMatchObject({
      description: null,
      address: null,
      websiteUrl: null,
      categories: [],
      coverImageUrl: null,
      photos: [],
    })
  })
})

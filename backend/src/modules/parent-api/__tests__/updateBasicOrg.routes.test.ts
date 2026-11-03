/**
 * Route-level tests for PATCH /api/parent/organizations/:orgId — the
 * self-serve basic-org editor (mobile's "created organizations" screen),
 * scoped by createdBy since the creator has no membership doc until they
 * claim-admin. Covers the richer field set added alongside the mobile
 * profile editor: description/address/website/categories, cover image,
 * and the full-replace photo gallery.
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

function makeFakeFirestore(seed: Record<string, any>) {
  const store = new Map<string, any>(Object.entries(seed))
  function snapFor(path: string): DocSnap {
    const data = store.get(path)
    return { exists: data !== undefined, data: () => data }
  }
  return {
    store,
    doc: (path: string) => ({
      get: async () => snapFor(path),
      update: async (data: any) => store.set(path, { ...store.get(path), ...data }),
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

describe('PATCH /api/parent/organizations/:orgId', () => {
  let app: FastifyInstance

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await app?.close()
  })

  it('returns 403 when the caller did not create the org', async () => {
    fakeDb = makeFakeFirestore({
      'organizations/org1': { createdBy: 'someone_else', tier: 'basic' },
    })
    app = await buildApp('creator_1')

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/parent/organizations/org1',
      payload: {},
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 400 when the org is no longer basic tier', async () => {
    fakeDb = makeFakeFirestore({
      'organizations/org1': { createdBy: 'creator_1', tier: undefined },
    })
    app = await buildApp('creator_1')

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/parent/organizations/org1',
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('updates description, address, website, and categories', async () => {
    fakeDb = makeFakeFirestore({
      'organizations/org1': { createdBy: 'creator_1', tier: 'basic' },
    })
    app = await buildApp('creator_1')

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/parent/organizations/org1',
      payload: {
        description: 'A great center',
        address: 'Main street 1',
        websiteUrl: 'https://example.com',
        categories: ['ABA', 'Psychology'],
      },
    })

    expect(res.statusCode).toBe(200)
    expect(fakeDb.store.get('organizations/org1')).toMatchObject({
      description: 'A great center',
      address: 'Main street 1',
      websiteUrl: 'https://example.com',
      categories: ['ABA', 'Psychology'],
    })
  })

  it('uploads a base64 cover image and stores the resulting URL', async () => {
    fakeDb = makeFakeFirestore({
      'organizations/org1': { createdBy: 'creator_1', tier: 'basic' },
    })
    app = await buildApp('creator_1')

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/parent/organizations/org1',
      payload: { coverImageUrl: 'data:image/png;base64,ZmFrZQ==' },
    })

    expect(res.statusCode).toBe(200)
    expect(mockUploadOrgMarketplaceImage).toHaveBeenCalledWith(
      'org1',
      'cover',
      expect.any(Buffer),
      'image/png',
      'cover'
    )
    expect(fakeDb.store.get('organizations/org1').coverImageUrl).toBe(
      'https://storage.example.com/cover-uploaded.jpg'
    )
  })

  it('replaces the full gallery, uploading any base64 entries and passing URLs through', async () => {
    fakeDb = makeFakeFirestore({
      'organizations/org1': {
        createdBy: 'creator_1',
        tier: 'basic',
        photos: ['https://old.example.com/a.jpg'],
      },
    })
    app = await buildApp('creator_1')

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/parent/organizations/org1',
      payload: {
        photos: ['data:image/png;base64,ZmFrZQ==', 'https://already-hosted.example.com/b.jpg'],
      },
    })

    expect(res.statusCode).toBe(200)
    expect(fakeDb.store.get('organizations/org1').photos).toEqual([
      'https://storage.example.com/photo-uploaded.jpg',
      'https://already-hosted.example.com/b.jpg',
    ])
  })

  it('clears the cover image when an empty string is sent', async () => {
    fakeDb = makeFakeFirestore({
      'organizations/org1': {
        createdBy: 'creator_1',
        tier: 'basic',
        coverImageUrl: 'https://old.jpg',
      },
    })
    app = await buildApp('creator_1')

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/parent/organizations/org1',
      payload: { coverImageUrl: '' },
    })

    expect(res.statusCode).toBe(200)
    expect(fakeDb.store.get('organizations/org1').coverImageUrl).toBeNull()
  })
})

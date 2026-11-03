/**
 * Route-level tests for the claim-request flow: POST /orgs/:orgId/claim
 * (submit a claim on an unclaimed listing — never grants access by itself)
 * and GET /orgs/:orgId/claim (CTA state for the caller). Uses a small
 * in-memory Firestore fake (Map-backed, supports runTransaction) so the
 * one-active-claim-per-org transaction logic is exercised for real instead
 * of mocked away.
 *
 * Admin-review tests (list/approve/reject) live in
 * orgClaimsAdmin.routes.test.ts, mirroring the orgClaims.routes.ts /
 * orgClaimsAdmin.routes.ts split.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

// ─── Mocks (hoisted before real imports) ─────────────────────────────────────

const mockWriteAudit = vi.fn()
vi.mock('../../../infrastructure/audit/audit.js', () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
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

// ─── Minimal in-memory Firestore fake ────────────────────────────────────────

type DocSnap = { id: string; exists: boolean; data: () => any }

function makeFakeFirestore(seed: Record<string, any> = {}) {
  const store = new Map<string, any>(Object.entries(seed))
  let autoIdCounter = 0

  function snapFor(path: string): DocSnap {
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
    const filters: Array<[string, string, any]> = []
    let limitN: number | undefined
    const ref: any = {
      doc: (id?: string) => makeDocRef(`${path}/${id ?? `auto${++autoIdCounter}`}`),
      where: (field: string, _op: string, value: any) => {
        filters.push([field, '==', value])
        return ref
      },
      limit: (n: number) => {
        limitN = n
        return ref
      },
      get: async () => {
        const prefix = `${path}/`
        let docs = [...store.keys()]
          .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
          .map((p) => snapFor(p))
        docs = docs.filter((d) => filters.every(([f, , v]) => d.data()?.[f] === v))
        if (limitN !== undefined) docs = docs.slice(0, limitN)
        return { empty: docs.length === 0, docs, size: docs.length }
      },
    }
    return ref
  }

  const db = {
    doc: (path: string) => makeDocRef(path),
    collection: (path: string) => makeCollectionRef(path),
    runTransaction: async (cb: (tx: any) => Promise<any>) => {
      const tx = {
        get: async (refOrQuery: any) => refOrQuery.get(),
        set: (ref: any, data: any) => store.set(ref.path, data),
        update: (ref: any, data: any) => store.set(ref.path, { ...store.get(ref.path), ...data }),
      }
      return cb(tx)
    },
  }
  return { db, store }
}

let fakeDb: ReturnType<typeof makeFakeFirestore>

vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(() => fakeDb.db),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildApp(uid = 'parent_1'): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    ;(request as unknown as { user: { uid: string } }).user = { uid }
  })
  const { orgClaimsRoute } = await import('../orgClaims.routes.js')
  await app.register(orgClaimsRoute)
  await app.ready()
  return app
}

describe('POST /orgs/:orgId/claim', () => {
  let app: FastifyInstance

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await app?.close()
  })

  it('returns 404 when the organization does not exist', async () => {
    fakeDb = makeFakeFirestore({})
    app = await buildApp()

    const res = await app.inject({ method: 'POST', url: '/orgs/missing_org/claim', payload: {} })
    expect(res.statusCode).toBe(404)
  })

  it('returns 409 for an org that is not unclaimed (already owned/organic)', async () => {
    fakeDb = makeFakeFirestore({ 'organizations/org1': { name: 'Org', status: undefined } })
    app = await buildApp()

    const res = await app.inject({ method: 'POST', url: '/orgs/org1/claim', payload: {} })
    expect(res.statusCode).toBe(409)
  })

  it('returns 409 for an org already in pending_verification or active', async () => {
    fakeDb = makeFakeFirestore({ 'organizations/org1': { name: 'Org', status: 'active' } })
    app = await buildApp()

    const res = await app.inject({ method: 'POST', url: '/orgs/org1/claim', payload: {} })
    expect(res.statusCode).toBe(409)
  })

  it('creates a pending claim, flips org status, and writes an audit event', async () => {
    fakeDb = makeFakeFirestore({ 'organizations/org1': { name: 'Org', status: 'unclaimed' } })
    app = await buildApp('parent_1')

    const res = await app.inject({
      method: 'POST',
      url: '/orgs/org1/claim',
      payload: { contactName: 'Tilek', contactPhone: '+996555000000' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, status: 'pending' })
    expect(fakeDb.store.get('organizations/org1').status).toBe('pending_verification')

    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'organization.claim_submitted',
        actorRole: 'parent',
        actorId: 'parent_1',
        orgId: 'org1',
      })
    )
  })

  it('is idempotent for the same user re-requesting while their claim is pending', async () => {
    fakeDb = makeFakeFirestore({ 'organizations/org1': { name: 'Org', status: 'unclaimed' } })
    app = await buildApp('parent_1')

    const first = await app.inject({ method: 'POST', url: '/orgs/org1/claim', payload: {} })
    const second = await app.inject({ method: 'POST', url: '/orgs/org1/claim', payload: {} })

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(second.json().claimId).toBe(first.json().claimId)

    const claimDocs = [...fakeDb.store.keys()].filter((k) =>
      k.startsWith('organizations/org1/claims/')
    )
    expect(claimDocs).toHaveLength(1)
  })

  it('rejects a second user while another claim is already pending', async () => {
    fakeDb = makeFakeFirestore({ 'organizations/org1': { name: 'Org', status: 'unclaimed' } })
    app = await buildApp('parent_1')
    await app.inject({ method: 'POST', url: '/orgs/org1/claim', payload: {} })
    await app.close()

    app = await buildApp('parent_2')
    const res = await app.inject({ method: 'POST', url: '/orgs/org1/claim', payload: {} })
    expect(res.statusCode).toBe(409)
  })
})

describe('GET /orgs/:orgId/claim', () => {
  let app: FastifyInstance

  afterEach(async () => {
    await app?.close()
  })

  it('reports claimable=true for an unclaimed org with no prior claim from this user', async () => {
    fakeDb = makeFakeFirestore({ 'organizations/org1': { name: 'Org', status: 'unclaimed' } })
    app = await buildApp('parent_1')

    const res = await app.inject({ method: 'GET', url: '/orgs/org1/claim' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, claimable: true, myClaim: null })
  })

  it('reports claimable=false and myClaim=pending after submitting a claim', async () => {
    fakeDb = makeFakeFirestore({ 'organizations/org1': { name: 'Org', status: 'unclaimed' } })
    app = await buildApp('parent_1')
    await app.inject({ method: 'POST', url: '/orgs/org1/claim', payload: {} })

    const res = await app.inject({ method: 'GET', url: '/orgs/org1/claim' })
    expect(res.statusCode).toBe(200)
    expect(res.json().claimable).toBe(false)
    expect(res.json().myClaim).toMatchObject({ status: 'pending' })
  })

  it('returns 404 for a non-existent organization', async () => {
    fakeDb = makeFakeFirestore({})
    app = await buildApp()

    const res = await app.inject({ method: 'GET', url: '/orgs/missing_org/claim' })
    expect(res.statusCode).toBe(404)
  })
})

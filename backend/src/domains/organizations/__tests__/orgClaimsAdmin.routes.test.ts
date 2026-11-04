/**
 * Route-level tests for the platform-admin claim review flow:
 * GET /admin/orgs/claims, POST .../approve, POST .../reject. Mirrors the
 * orgClaims.routes.ts / orgClaimsAdmin.routes.ts split — claimant-facing
 * submit/status tests live in orgClaims.routes.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

// ─── Mocks (hoisted before real imports) ─────────────────────────────────────

const mockWriteAudit = vi.fn()
vi.mock('../../../infrastructure/audit/audit.js', () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}))

let requirePlatformAdminImpl: (...args: unknown[]) => Promise<unknown> = vi
  .fn()
  .mockResolvedValue(undefined)
vi.mock('../../../infrastructure/auth/rbac.js', () => ({
  requirePlatformAdmin: (...args: unknown[]) => requirePlatformAdminImpl(...args),
}))

const mockGetUser = vi.fn().mockResolvedValue({ email: 'owner@example.com', displayName: 'Owner' })
vi.mock('firebase-admin', () => ({
  default: {
    firestore: {
      Timestamp: {
        now: () => ({ __type: 'timestamp', value: 'now' }),
        fromDate: (d: Date) => ({ __type: 'timestamp', value: d.toISOString() }),
      },
    },
    auth: () => ({ getUser: (...args: unknown[]) => mockGetUser(...args) }),
  },
}))

vi.mock('../../payments/planLimits.js', () => ({
  FREE_TRIAL_DAYS: 30,
  FREE_TRIAL_PLAN_ID: 'enterprise',
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

async function buildApp(uid = 'admin_1'): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    ;(request as unknown as { user: { uid: string } }).user = { uid }
  })
  const { orgClaimsAdminRoute } = await import('../orgClaimsAdmin.routes.js')
  await app.register(orgClaimsAdminRoute)
  await app.ready()
  return app
}

describe('GET /admin/orgs/claims', () => {
  let app: FastifyInstance

  beforeEach(() => {
    vi.clearAllMocks()
    requirePlatformAdminImpl = vi.fn().mockResolvedValue(undefined)
  })

  afterEach(async () => {
    await app?.close()
  })

  it('returns 403 when the caller is not a platform admin', async () => {
    requirePlatformAdminImpl = vi.fn(
      async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
        reply.code(403).send({ error: 'Platform admin access required' })
      }
    )
    fakeDb = makeFakeFirestore({})
    app = await buildApp('admin_1')

    const res = await app.inject({ method: 'GET', url: '/admin/orgs/claims' })
    expect(res.statusCode).toBe(403)
  })

  it('lists orgs with a pending claim, skipping ones with none despite the status flag', async () => {
    fakeDb = makeFakeFirestore({
      'organizations/org1': { name: 'Org One', status: 'pending_verification' },
      'organizations/org1/claims/claim1': {
        uid: 'parent_1',
        status: 'pending',
        contactName: 'Tilek',
        contactPhone: null,
        note: null,
        submittedAt: { __type: 'timestamp', value: 'now' },
      },
      // No pending claim under this one (e.g. race already resolved) — must not appear.
      'organizations/org2': { name: 'Org Two', status: 'pending_verification' },
      'organizations/org3': { name: 'Org Three', status: 'unclaimed' },
    })
    app = await buildApp('admin_1')

    const res = await app.inject({ method: 'GET', url: '/admin/orgs/claims' })
    expect(res.statusCode).toBe(200)
    expect(res.json().claims).toEqual([
      expect.objectContaining({
        claimId: 'claim1',
        orgId: 'org1',
        orgName: 'Org One',
        uid: 'parent_1',
      }),
    ])
  })
})

describe('POST /admin/orgs/:orgId/claims/:claimId/approve', () => {
  let app: FastifyInstance

  beforeEach(() => {
    vi.clearAllMocks()
    requirePlatformAdminImpl = vi.fn().mockResolvedValue(undefined)
    mockGetUser.mockResolvedValue({ email: 'owner@example.com', displayName: 'Owner' })
  })

  afterEach(async () => {
    await app?.close()
  })

  function seedPendingClaim() {
    return makeFakeFirestore({
      'organizations/org1': { name: 'Org One', country: 'KG', status: 'pending_verification' },
      'organizations/org1/claims/claim1': { uid: 'parent_1', status: 'pending' },
    })
  }

  it('returns 409 when the claim was already reviewed', async () => {
    fakeDb = makeFakeFirestore({
      'organizations/org1': { name: 'Org One', status: 'pending_verification' },
      'organizations/org1/claims/claim1': { uid: 'parent_1', status: 'approved' },
    })
    app = await buildApp('admin_1')

    const res = await app.inject({
      method: 'POST',
      url: '/admin/orgs/org1/claims/claim1/approve',
    })
    expect(res.statusCode).toBe(409)
  })

  it('grants org_admin membership, starts the trial, and marks the org active', async () => {
    fakeDb = seedPendingClaim()
    app = await buildApp('admin_1')

    const res = await app.inject({
      method: 'POST',
      url: '/admin/orgs/org1/claims/claim1/approve',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, orgId: 'org1', uid: 'parent_1' })

    const org = fakeDb.store.get('organizations/org1')
    expect(org.status).toBe('active')
    expect(org.claimedBy).toBe('parent_1')
    expect(org.crmEnabled).toBe(true)
    expect(org.billing.status).toBe('trialing')

    const claim = fakeDb.store.get('organizations/org1/claims/claim1')
    expect(claim.status).toBe('approved')
    expect(claim.reviewedBy).toBe('admin_1')

    const member = fakeDb.store.get('organizations/org1/members/parent_1')
    expect(member).toMatchObject({ uid: 'parent_1', role: 'org_admin', status: 'active' })

    const specialistOrgIndex = fakeDb.store.get('specialists/parent_1/organizations/org1')
    expect(specialistOrgIndex).toMatchObject({ orgId: 'org1', role: 'org_admin', status: 'active' })

    const specialist = fakeDb.store.get('specialists/parent_1')
    expect(specialist).toMatchObject({
      uid: 'parent_1',
      role: 'org_admin',
      email: 'owner@example.com',
    })

    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'organization.claim_approved',
        actorRole: 'platform_admin',
        actorId: 'admin_1',
        orgId: 'org1',
      })
    )
  })

  it('updates an existing specialists/{uid} doc instead of overwriting it wholesale', async () => {
    fakeDb = seedPendingClaim()
    fakeDb.store.set('specialists/parent_1', {
      uid: 'parent_1',
      fullName: 'Existing Name',
      role: 'specialist',
    })
    app = await buildApp('admin_1')

    await app.inject({ method: 'POST', url: '/admin/orgs/org1/claims/claim1/approve' })

    const specialist = fakeDb.store.get('specialists/parent_1')
    expect(specialist.fullName).toBe('Existing Name')
    expect(specialist.role).toBe('org_admin')
    expect(specialist.orgId).toBe('org1')
  })

  it('still returns success when the specialists/{uid} index upsert fails, since the core grant already committed', async () => {
    fakeDb = seedPendingClaim()
    mockGetUser.mockRejectedValue(new Error('auth lookup boom'))
    // Force the upsert branch to throw by making the "existing doc" update path fail too —
    // simplest way here is to make specialistRef.get() itself throw.
    const originalDoc = fakeDb.db.doc
    fakeDb.db.doc = (path: string) => {
      const ref = originalDoc(path)
      if (path === 'specialists/parent_1') {
        return {
          ...ref,
          get: async () => {
            throw new Error('boom')
          },
        }
      }
      return ref
    }
    app = await buildApp('admin_1')

    const res = await app.inject({ method: 'POST', url: '/admin/orgs/org1/claims/claim1/approve' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, orgId: 'org1', uid: 'parent_1' })
    // The core grant still happened despite the index-doc failure.
    expect(fakeDb.store.get('organizations/org1').status).toBe('active')
    expect(fakeDb.store.get('organizations/org1/members/parent_1')).toMatchObject({
      role: 'org_admin',
    })
  })
})

describe('POST /admin/orgs/:orgId/claims/:claimId/reject', () => {
  let app: FastifyInstance

  beforeEach(() => {
    vi.clearAllMocks()
    requirePlatformAdminImpl = vi.fn().mockResolvedValue(undefined)
  })

  afterEach(async () => {
    await app?.close()
  })

  it('reopens the listing and marks the claim rejected, without granting anything', async () => {
    fakeDb = makeFakeFirestore({
      'organizations/org1': { name: 'Org One', status: 'pending_verification' },
      'organizations/org1/claims/claim1': { uid: 'parent_1', status: 'pending' },
    })
    app = await buildApp('admin_1')

    const res = await app.inject({
      method: 'POST',
      url: '/admin/orgs/org1/claims/claim1/reject',
      payload: { reason: 'Could not verify ownership' },
    })

    expect(res.statusCode).toBe(200)
    expect(fakeDb.store.get('organizations/org1').status).toBe('unclaimed')
    expect(fakeDb.store.get('organizations/org1/claims/claim1')).toMatchObject({
      status: 'rejected',
      reviewedBy: 'admin_1',
      reason: 'Could not verify ownership',
    })
    expect(fakeDb.store.get('organizations/org1/members/parent_1')).toBeUndefined()

    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'organization.claim_rejected', actorId: 'admin_1' })
    )
  })

  it('returns 409 when the claim was already reviewed', async () => {
    fakeDb = makeFakeFirestore({
      'organizations/org1': { name: 'Org One', status: 'unclaimed' },
      'organizations/org1/claims/claim1': { uid: 'parent_1', status: 'rejected' },
    })
    app = await buildApp('admin_1')

    const res = await app.inject({
      method: 'POST',
      url: '/admin/orgs/org1/claims/claim1/reject',
      payload: {},
    })
    expect(res.statusCode).toBe(409)
  })

  it('returns 409 and does not unclaim an org that is no longer awaiting verification', async () => {
    // A stale 'pending' claim on an org that's already active (e.g. approved
    // via a different claim in the meantime) must not be reject-able — doing
    // so would silently flip a live, claimed org back to 'unclaimed'.
    fakeDb = makeFakeFirestore({
      'organizations/org1': { name: 'Org One', status: 'active' },
      'organizations/org1/claims/claim1': { uid: 'parent_1', status: 'pending' },
    })
    app = await buildApp('admin_1')

    const res = await app.inject({
      method: 'POST',
      url: '/admin/orgs/org1/claims/claim1/reject',
      payload: {},
    })
    expect(res.statusCode).toBe(409)
    expect(fakeDb.store.get('organizations/org1').status).toBe('active')
    expect(fakeDb.store.get('organizations/org1/claims/claim1').status).toBe('pending')
  })
})

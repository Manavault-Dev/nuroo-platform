/**
 * Route-level tests for manualBilling.routes.ts — platform-admin-only manual
 * billing overrides (used by support/ops to activate or extend an org's plan
 * outside of Stripe/Finik, e.g. for manual bank transfers). Covers the
 * requirePlatformAdmin gate, date validation, org existence, and the actual
 * Firestore writes (billing status + audit log entry).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

// ─── Mocks (hoisted before real imports) ─────────────────────────────────────

let requirePlatformAdminImpl: (...args: unknown[]) => Promise<unknown> = vi
  .fn()
  .mockResolvedValue(undefined)

vi.mock('../../../infrastructure/auth/rbac.js', () => ({
  requirePlatformAdmin: (...args: unknown[]) => requirePlatformAdminImpl(...args),
}))

vi.mock('@sentry/node', () => ({
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
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

let orgExists = true
const mockOrgSet = vi.fn().mockResolvedValue(undefined)
const mockAuditLogAdd = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn().mockReturnValue({
      doc: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: orgExists }),
        set: mockOrgSet,
        collection: vi.fn().mockReturnValue({
          add: mockAuditLogAdd,
        }),
      }),
    }),
  })),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    ;(request as unknown as { user: { uid: string } }).user = { uid: 'platform_admin_1' }
  })
  const { manualBillingRoutes } = await import('../manualBilling.routes.js')
  await app.register(manualBillingRoutes)
  await app.ready()
  return app
}

function futureDateStr(daysAhead = 30): string {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  return d.toISOString().split('T')[0]
}

function pastDateStr(daysAgo = 5): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().split('T')[0]
}

describe('manualBillingRoutes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    requirePlatformAdminImpl = vi.fn().mockResolvedValue(undefined)
    orgExists = true
    app = await buildApp()
  })

  afterEach(async () => {
    await app.close()
  })

  // ── POST /orgs/:orgId/billing/manual-activate ───────────────────────────

  describe('POST /orgs/:orgId/billing/manual-activate', () => {
    const VALID_BODY = { plan: 'growth', activeUntil: '' }

    beforeEach(() => {
      VALID_BODY.activeUntil = futureDateStr()
    })

    it('returns 403 PLATFORM_ADMIN_REQUIRED when caller is not a platform admin, and never writes billing state', async () => {
      requirePlatformAdminImpl = vi.fn(
        async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
          reply
            .code(403)
            .send({ error: 'Platform admin access required', code: 'PLATFORM_ADMIN_REQUIRED' })
        }
      )

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/manual-activate',
        payload: VALID_BODY,
      })

      expect(res.statusCode).toBe(403)
      expect(res.json()).toMatchObject({ code: 'PLATFORM_ADMIN_REQUIRED' })
      expect(mockOrgSet).not.toHaveBeenCalled()
      expect(mockAuditLogAdd).not.toHaveBeenCalled()
    })

    it('rejects an invalid plan id via schema validation (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/manual-activate',
        payload: { ...VALID_BODY, plan: 'not-a-real-plan' },
      })

      expect(res.statusCode).toBe(400)
      expect(mockOrgSet).not.toHaveBeenCalled()
    })

    it('returns 400 INVALID_DATE for a malformed activeUntil', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/manual-activate',
        payload: { plan: 'growth', activeUntil: 'not-a-date' },
      })

      // Malformed strings that don't match the 'date' format are rejected by
      // the Fastify/AJV schema itself before the handler runs.
      expect(res.statusCode).toBe(400)
      expect(mockOrgSet).not.toHaveBeenCalled()
    })

    it('returns 400 PAST_DATE when activeUntil is in the past', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/manual-activate',
        payload: { plan: 'growth', activeUntil: pastDateStr() },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ code: 'PAST_DATE' })
      expect(mockOrgSet).not.toHaveBeenCalled()
    })

    it('returns 404 ORG_NOT_FOUND when the organization does not exist', async () => {
      orgExists = false

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/missing-org/billing/manual-activate',
        payload: VALID_BODY,
      })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ code: 'ORG_NOT_FOUND' })
      expect(mockOrgSet).not.toHaveBeenCalled()
    })

    it('activates the plan, writes an audit log entry, and returns 200', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/manual-activate',
        payload: { ...VALID_BODY, note: 'manual bank transfer' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ ok: true, status: 'manual_active', plan: 'growth' })

      expect(mockOrgSet).toHaveBeenCalledWith(
        {
          billing: expect.objectContaining({
            status: 'manual_active',
            provider: 'manual',
            plan: 'growth',
          }),
        },
        { merge: true }
      )

      expect(mockAuditLogAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'billing_manual_activated',
          plan: 'growth',
          note: 'manual bank transfer',
          activatedBy: 'platform_admin_1',
        })
      )
    })

    it('records a null note when none is provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/manual-activate',
        payload: VALID_BODY,
      })

      expect(res.statusCode).toBe(200)
      expect(mockAuditLogAdd).toHaveBeenCalledWith(expect.objectContaining({ note: null }))
    })
  })

  // ── POST /orgs/:orgId/billing/manual-extend ─────────────────────────────

  describe('POST /orgs/:orgId/billing/manual-extend', () => {
    it('returns 403 PLATFORM_ADMIN_REQUIRED when caller is not a platform admin, and never writes billing state', async () => {
      requirePlatformAdminImpl = vi.fn(
        async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
          reply
            .code(403)
            .send({ error: 'Platform admin access required', code: 'PLATFORM_ADMIN_REQUIRED' })
        }
      )

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/manual-extend',
        payload: { activeUntil: futureDateStr() },
      })

      expect(res.statusCode).toBe(403)
      expect(mockOrgSet).not.toHaveBeenCalled()
      expect(mockAuditLogAdd).not.toHaveBeenCalled()
    })

    it('returns 400 PAST_DATE when activeUntil is in the past', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/manual-extend',
        payload: { activeUntil: pastDateStr() },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ code: 'PAST_DATE' })
    })

    it('returns 404 ORG_NOT_FOUND when the organization does not exist', async () => {
      orgExists = false

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/missing-org/billing/manual-extend',
        payload: { activeUntil: futureDateStr() },
      })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ code: 'ORG_NOT_FOUND' })
    })

    it('extends the period, writes an audit log entry, and returns 200 (no plan field)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/billing/manual-extend',
        payload: { activeUntil: futureDateStr(), note: 'extended by support' },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ ok: true, status: 'manual_active' })
      expect(res.json()).not.toHaveProperty('plan')

      expect(mockOrgSet).toHaveBeenCalledWith(
        { billing: expect.objectContaining({ status: 'manual_active' }) },
        { merge: true }
      )
      expect(mockOrgSet).toHaveBeenCalledWith(
        expect.objectContaining({
          billing: expect.not.objectContaining({ plan: expect.anything() }),
        }),
        { merge: true }
      )

      expect(mockAuditLogAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'billing_manual_extended',
          note: 'extended by support',
          extendedBy: 'platform_admin_1',
        })
      )
    })
  })
})

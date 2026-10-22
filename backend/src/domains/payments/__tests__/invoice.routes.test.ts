/**
 * Route-level tests for invoice.routes.ts — auth gating (member + branch
 * scoping), request validation, status-code mapping, and correct delegation
 * to invoice.service.ts (mocked out here; its internals are covered by
 * invoice.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

// ─── Mocks (hoisted before real imports) ─────────────────────────────────────

type Member = { uid: string; role: 'org_admin' | 'specialist'; branchId?: string | null }

let currentMember: Member = { uid: 'member1', role: 'org_admin', branchId: null }
let requireOrgMemberImpl: (...args: unknown[]) => Promise<unknown> = vi.fn(
  async () => currentMember
)

vi.mock('../../../infrastructure/auth/rbac.js', () => ({
  requireOrgMember: (...args: unknown[]) => requireOrgMemberImpl(...args),
  memberBranchScope: (member: Member) => member.branchId ?? null,
}))

const mockCreateInvoice = vi.fn()
const mockListInvoices = vi.fn()
const mockGetInvoice = vi.fn()
const mockCancelInvoice = vi.fn()

vi.mock('../invoice.service.js', () => ({
  createInvoice: (...args: unknown[]) => mockCreateInvoice(...args),
  listInvoices: (...args: unknown[]) => mockListInvoices(...args),
  getInvoice: (...args: unknown[]) => mockGetInvoice(...args),
  cancelInvoice: (...args: unknown[]) => mockCancelInvoice(...args),
}))

let childBranchId: string | null = null

vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(() => ({
    doc: vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue({ data: () => ({ branchId: childBranchId }) }),
    }),
  })),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    ;(request as unknown as { user: { uid: string } }).user = { uid: 'member1' }
  })
  const { invoiceRoutes } = await import('../invoice.routes.js')
  await app.register(invoiceRoutes)
  await app.ready()
  return app
}

function futureDate(daysAhead = 10): string {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  return d.toISOString().split('T')[0]
}

const VALID_BODY = {
  parentId: 'parent1',
  childId: 'child1',
  amount: 1000,
  currency: 'KGS',
  description: 'Monthly fee',
  dueDate: '',
}

describe('invoiceRoutes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    currentMember = { uid: 'member1', role: 'org_admin', branchId: null }
    requireOrgMemberImpl = vi.fn(async () => currentMember)
    childBranchId = null
    VALID_BODY.dueDate = futureDate()
    app = await buildApp()
  })

  afterEach(async () => {
    await app.close()
  })

  // ── POST /orgs/:orgId/invoices ──────────────────────────────────────────

  describe('POST /orgs/:orgId/invoices', () => {
    it('returns 403 when the caller is not an org member', async () => {
      requireOrgMemberImpl = vi.fn(
        async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
          reply.code(403).send({ error: 'Not a member of this organization' })
        }
      )

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/invoices',
        payload: VALID_BODY,
      })

      expect(res.statusCode).toBe(403)
      expect(mockCreateInvoice).not.toHaveBeenCalled()
    })

    it('rejects a body missing required fields (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/invoices',
        payload: { parentId: 'parent1' },
      })

      expect(res.statusCode).toBe(400)
      expect(mockCreateInvoice).not.toHaveBeenCalled()
    })

    it('returns 400 INVALID_DUE_DATE when dueDate is in the past', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/invoices',
        payload: { ...VALID_BODY, dueDate: '2000-01-01' },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ code: 'INVALID_DUE_DATE' })
      expect(mockCreateInvoice).not.toHaveBeenCalled()
    })

    it('returns 400 INVALID_DUE_DATE when dueDate is not a parseable date', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/invoices',
        payload: { ...VALID_BODY, dueDate: 'not-a-date-at-all' },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ code: 'INVALID_DUE_DATE' })
    })

    it('returns 403 when a branch-scoped member targets a child from another branch', async () => {
      currentMember = { uid: 'member1', role: 'specialist', branchId: 'branchA' }
      childBranchId = 'branchB'

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/invoices',
        payload: VALID_BODY,
      })

      expect(res.statusCode).toBe(403)
      expect(mockCreateInvoice).not.toHaveBeenCalled()
    })

    it('allows a branch-scoped member when the child belongs to their branch', async () => {
      currentMember = { uid: 'member1', role: 'specialist', branchId: 'branchA' }
      childBranchId = 'branchA'
      mockCreateInvoice.mockResolvedValue({ invoiceId: 'inv1' })

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/invoices',
        payload: VALID_BODY,
      })

      expect(res.statusCode).toBe(201)
      expect(mockCreateInvoice).toHaveBeenCalledOnce()
    })

    it('creates an invoice and returns 201 for an HQ-level (unscoped) member', async () => {
      mockCreateInvoice.mockResolvedValue({ invoiceId: 'inv1', status: 'pending' })

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/invoices',
        payload: VALID_BODY,
      })

      expect(res.statusCode).toBe(201)
      expect(res.json()).toMatchObject({ ok: true, invoice: { invoiceId: 'inv1' } })
      expect(mockCreateInvoice).toHaveBeenCalledWith(
        expect.anything(),
        'org1',
        {
          parentId: VALID_BODY.parentId,
          childId: VALID_BODY.childId,
          amount: VALID_BODY.amount,
          currency: VALID_BODY.currency,
          description: VALID_BODY.description,
          dueDate: VALID_BODY.dueDate,
        },
        'member1'
      )
    })

    it('returns 422 PROVIDER_NOT_CONNECTED when the service reports no provider', async () => {
      mockCreateInvoice.mockRejectedValue(
        new Error('Payment provider is not connected. Please configure Finik.')
      )

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/invoices',
        payload: VALID_BODY,
      })

      expect(res.statusCode).toBe(422)
      expect(res.json()).toMatchObject({ code: 'PROVIDER_NOT_CONNECTED' })
    })

    it('returns 500 INVOICE_CREATE_FAILED for unexpected service errors', async () => {
      mockCreateInvoice.mockRejectedValue(new Error('unexpected failure'))

      const res = await app.inject({
        method: 'POST',
        url: '/orgs/org1/invoices',
        payload: VALID_BODY,
      })

      expect(res.statusCode).toBe(500)
      expect(res.json()).toMatchObject({ code: 'INVOICE_CREATE_FAILED' })
    })
  })

  // ── GET /orgs/:orgId/invoices ────────────────────────────────────────────

  describe('GET /orgs/:orgId/invoices', () => {
    it('returns 403 when the caller is not an org member', async () => {
      requireOrgMemberImpl = vi.fn(
        async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
          reply.code(403).send({ error: 'Not a member' })
        }
      )

      const res = await app.inject({ method: 'GET', url: '/orgs/org1/invoices' })

      expect(res.statusCode).toBe(403)
      expect(mockListInvoices).not.toHaveBeenCalled()
    })

    it('forwards query filters and defaults limit to 50', async () => {
      mockListInvoices.mockResolvedValue([])

      const res = await app.inject({
        method: 'GET',
        url: '/orgs/org1/invoices?parentId=parent1&status=paid&month=2025-06',
      })

      expect(res.statusCode).toBe(200)
      expect(mockListInvoices).toHaveBeenCalledWith(expect.anything(), 'org1', {
        parentId: 'parent1',
        status: 'paid',
        limit: 50,
        month: '2025-06',
        branchId: undefined,
      })
    })

    it('parses an explicit limit query param', async () => {
      mockListInvoices.mockResolvedValue([])

      const res = await app.inject({ method: 'GET', url: '/orgs/org1/invoices?limit=10' })

      expect(res.statusCode).toBe(200)
      expect(mockListInvoices).toHaveBeenCalledWith(
        expect.anything(),
        'org1',
        expect.objectContaining({ limit: 10 })
      )
    })

    it("overrides the branchId query param with the member's own branch scope", async () => {
      currentMember = { uid: 'member1', role: 'specialist', branchId: 'branchA' }
      mockListInvoices.mockResolvedValue([])

      const res = await app.inject({
        method: 'GET',
        url: '/orgs/org1/invoices?branchId=branchB',
      })

      expect(res.statusCode).toBe(200)
      expect(mockListInvoices).toHaveBeenCalledWith(
        expect.anything(),
        'org1',
        expect.objectContaining({ branchId: 'branchA' })
      )
    })
  })

  // ── GET /orgs/:orgId/invoices/:invoiceId ────────────────────────────────

  describe('GET /orgs/:orgId/invoices/:invoiceId', () => {
    it('returns 404 INVOICE_NOT_FOUND when the invoice does not exist', async () => {
      mockGetInvoice.mockResolvedValue(null)

      const res = await app.inject({ method: 'GET', url: '/orgs/org1/invoices/missing' })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ code: 'INVOICE_NOT_FOUND' })
    })

    it('returns 403 when a branch-scoped member requests an invoice from another branch', async () => {
      currentMember = { uid: 'member1', role: 'specialist', branchId: 'branchA' }
      mockGetInvoice.mockResolvedValue({ invoiceId: 'inv1', branchId: 'branchB' })

      const res = await app.inject({ method: 'GET', url: '/orgs/org1/invoices/inv1' })

      expect(res.statusCode).toBe(403)
    })

    it('returns 200 with the invoice when found and in scope', async () => {
      mockGetInvoice.mockResolvedValue({ invoiceId: 'inv1', branchId: null })

      const res = await app.inject({ method: 'GET', url: '/orgs/org1/invoices/inv1' })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ ok: true, invoice: { invoiceId: 'inv1' } })
    })
  })

  // ── PATCH /orgs/:orgId/invoices/:invoiceId/cancel ───────────────────────

  describe('PATCH /orgs/:orgId/invoices/:invoiceId/cancel', () => {
    it('returns 404 INVOICE_NOT_FOUND when the invoice does not exist', async () => {
      mockCancelInvoice.mockRejectedValue(new Error('Invoice not found'))

      const res = await app.inject({
        method: 'PATCH',
        url: '/orgs/org1/invoices/missing/cancel',
      })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ code: 'INVOICE_NOT_FOUND' })
    })

    it('returns 409 INVALID_STATUS when the invoice cannot be canceled from its current status', async () => {
      mockCancelInvoice.mockRejectedValue(new Error('Cannot cancel invoice with status: paid'))

      const res = await app.inject({ method: 'PATCH', url: '/orgs/org1/invoices/inv1/cancel' })

      expect(res.statusCode).toBe(409)
      expect(res.json()).toMatchObject({ code: 'INVALID_STATUS' })
    })

    it('returns 500 CANCEL_FAILED for unexpected service errors', async () => {
      mockCancelInvoice.mockRejectedValue(new Error('db unavailable'))

      const res = await app.inject({ method: 'PATCH', url: '/orgs/org1/invoices/inv1/cancel' })

      expect(res.statusCode).toBe(500)
      expect(res.json()).toMatchObject({ code: 'CANCEL_FAILED' })
    })

    it('returns 403 when a branch-scoped member cancels an invoice from another branch', async () => {
      currentMember = { uid: 'member1', role: 'specialist', branchId: 'branchA' }
      mockGetInvoice.mockResolvedValue({ invoiceId: 'inv1', branchId: 'branchB' })

      const res = await app.inject({ method: 'PATCH', url: '/orgs/org1/invoices/inv1/cancel' })

      expect(res.statusCode).toBe(403)
      expect(mockCancelInvoice).not.toHaveBeenCalled()
    })

    it('cancels successfully (200) on first call, then rejects a second cancel with 409 (double-submission)', async () => {
      mockCancelInvoice
        .mockResolvedValueOnce({ invoiceId: 'inv1', status: 'canceled' })
        .mockRejectedValueOnce(new Error('Cannot cancel invoice with status: canceled'))

      const first = await app.inject({ method: 'PATCH', url: '/orgs/org1/invoices/inv1/cancel' })
      expect(first.statusCode).toBe(200)
      expect(first.json()).toMatchObject({ ok: true, invoice: { status: 'canceled' } })

      const second = await app.inject({ method: 'PATCH', url: '/orgs/org1/invoices/inv1/cancel' })
      expect(second.statusCode).toBe(409)
      expect(second.json()).toMatchObject({ code: 'INVALID_STATUS' })
    })
  })
})

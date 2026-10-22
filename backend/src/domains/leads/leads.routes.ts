import type { FastifyPluginAsync } from 'fastify'
import admin from 'firebase-admin'
import { z } from 'zod'
import { getFirestore } from '../../infrastructure/database/firebase.js'
import { requireOrgMember, memberBranchScope } from '../../infrastructure/auth/rbac.js'
import { checkOrgHasFeature } from '../payments/planLimits.js'

const LEAD_STATUSES = ['new', 'contacted', 'trial_booked', 'active_client', 'lost'] as const

const manualLeadSchema = z.object({
  branchId: z.string().max(200).optional().nullable(),
  parentName: z.string().min(1).max(200),
  phone: z.string().min(5).max(30),
  email: z.string().email().max(200).optional().nullable(),
  childName: z.string().max(200).optional().nullable(),
  programInterest: z.string().max(300).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
})

const updateLeadSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  branchId: z.string().max(200).nullable().optional(),
  assignedTo: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

const orgIdParamsSchema = {
  type: 'object',
  required: ['orgId'],
  properties: { orgId: { type: 'string', description: 'Organization ID' } },
} as const

const leadIdParamsSchema = {
  type: 'object',
  required: ['orgId', 'leadId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    leadId: { type: 'string', description: 'Lead ID' },
  },
} as const

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  additionalProperties: true,
  properties: { error: { type: 'string' } },
} as const

const okResponseSchema = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
} as const

const leadResponseSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: { type: 'string' },
    orgId: { type: 'string' },
    branchId: { type: ['string', 'null'] },
    parentName: { type: 'string' },
    phone: { type: 'string' },
    email: { type: ['string', 'null'] },
    childName: { type: ['string', 'null'] },
    childAge: { type: ['string', 'null'] },
    programInterest: { type: ['string', 'null'] },
    message: { type: ['string', 'null'] },
    source: { type: 'string' },
    status: { type: 'string' },
    assignedTo: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    createdAt: { type: ['string', 'null'] },
    updatedAt: { type: ['string', 'null'] },
  },
} as const

const createLeadBodySchema = {
  type: 'object',
  required: ['parentName', 'phone'],
  additionalProperties: true,
  properties: {
    branchId: { type: ['string', 'null'] },
    parentName: { type: 'string', minLength: 1, maxLength: 200 },
    phone: { type: 'string', minLength: 5, maxLength: 30 },
    email: { type: ['string', 'null'] },
    childName: { type: ['string', 'null'] },
    programInterest: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
  },
} as const

const updateLeadBodySchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    status: { type: 'string', enum: [...LEAD_STATUSES] },
    branchId: { type: ['string', 'null'] },
    assignedTo: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
  },
} as const

function transformLead(
  doc: admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot
) {
  const data = doc.data()!
  return {
    id: doc.id,
    orgId: data.orgId,
    branchId: data.branchId ?? null,
    parentName: data.parentName,
    phone: data.phone,
    email: data.email ?? null,
    childName: data.childName ?? null,
    childAge: data.childAge ?? null,
    programInterest: data.programInterest ?? null,
    message: data.message ?? null,
    source: data.source ?? 'manual',
    status: data.status ?? 'new',
    assignedTo: data.assignedTo ?? null,
    notes: data.notes ?? null,
    createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
  }
}

export const leadsRoute: FastifyPluginAsync = async (fastify) => {
  const db = getFirestore()

  // ── GET /orgs/:orgId/leads ─────────────────────────────────────────────────
  fastify.get<{
    Params: { orgId: string }
    Querystring: { branchId?: string; status?: string }
  }>(
    '/orgs/:orgId/leads',
    {
      schema: {
        tags: ['Leads'],
        summary: "List an organization's leads, optionally filtered by branch or status",
        params: orgIdParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: true,
          properties: {
            branchId: {
              type: 'string',
              description: 'Branch ID (ignored for branch-scoped members)',
            },
            status: { type: 'string', enum: [...LEAD_STATUSES] },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['ok', 'leads', 'count'],
            properties: {
              ok: { type: 'boolean' },
              leads: { type: 'array', items: leadResponseSchema },
              count: { type: 'number' },
            },
          },
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { orgId } = request.params
      const member = await requireOrgMember(request, reply, orgId)
      if (reply.sent) return

      const featureCheck = await checkOrgHasFeature(orgId, 'crm')
      if (!featureCheck.ok) {
        return reply.code(403).send({ error: featureCheck.error, upgradeRequired: true })
      }

      // A branch-scoped member (Branch Admin / Admissions Manager) always sees only their
      // own branch, regardless of what the query string asks for. HQ members (no branch
      // scope) may optionally filter by branchId via the query string.
      const scope = memberBranchScope(member)
      const effectiveBranchId = scope ?? request.query.branchId

      let query: FirebaseFirestore.Query = db.collection(`organizations/${orgId}/leads`)
      if (effectiveBranchId) query = query.where('branchId', '==', effectiveBranchId)
      if (request.query.status) query = query.where('status', '==', request.query.status)

      const snap = await query.orderBy('createdAt', 'desc').get()
      const leads = snap.docs.map(transformLead)
      return { ok: true, leads, count: leads.length }
    }
  )

  // ── GET /orgs/:orgId/leads/analytics ───────────────────────────────────────
  // Registered before the :leadId routes so Fastify doesn't treat "analytics" as an id.
  fastify.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId/leads/analytics',
    {
      schema: {
        tags: ['Leads'],
        summary:
          'Get aggregated lead conversion analytics for an organization, broken down by branch',
        params: orgIdParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'total', 'totalByStatus', 'conversionRate', 'byBranch'],
            properties: {
              ok: { type: 'boolean' },
              total: { type: 'number' },
              totalByStatus: { type: 'object', additionalProperties: { type: 'number' } },
              conversionRate: { type: 'number' },
              byBranch: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['branchId', 'branchName', 'total', 'byStatus', 'conversionRate'],
                  properties: {
                    branchId: { type: ['string', 'null'] },
                    branchName: { type: 'string' },
                    total: { type: 'number' },
                    byStatus: { type: 'object', additionalProperties: { type: 'number' } },
                    conversionRate: { type: 'number' },
                  },
                },
              },
            },
          },
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { orgId } = request.params
      const member = await requireOrgMember(request, reply, orgId)
      if (reply.sent) return

      const featureCheck = await checkOrgHasFeature(orgId, 'crm')
      if (!featureCheck.ok) {
        return reply.code(403).send({ error: featureCheck.error, upgradeRequired: true })
      }

      const scope = memberBranchScope(member)
      const leadsCollection = db.collection(`organizations/${orgId}/leads`)

      const [leadsSnap, branchesSnap] = await Promise.all([
        scope ? leadsCollection.where('branchId', '==', scope).get() : leadsCollection.get(),
        db.collection(`organizations/${orgId}/branches`).get(),
      ])

      const branchNames = new Map<string, string>()
      branchesSnap.docs.forEach((d) => branchNames.set(d.id, (d.data().name as string) ?? d.id))

      type BranchStat = {
        branchId: string | null
        branchName: string
        total: number
        byStatus: Record<string, number>
        conversionRate: number
      }
      const byBranch = new Map<string, BranchStat>()
      const totalByStatus: Record<string, number> = {}

      leadsSnap.docs.forEach((d) => {
        const data = d.data()
        const status = (data.status as string) ?? 'new'
        const branchId = (data.branchId as string | null) ?? null
        const key = branchId ?? '__none__'

        totalByStatus[status] = (totalByStatus[status] ?? 0) + 1

        if (!byBranch.has(key)) {
          byBranch.set(key, {
            branchId,
            branchName: branchId
              ? (branchNames.get(branchId) ?? 'Неизвестный филиал')
              : 'Без филиала',
            total: 0,
            byStatus: {},
            conversionRate: 0,
          })
        }
        const stat = byBranch.get(key)!
        stat.total += 1
        stat.byStatus[status] = (stat.byStatus[status] ?? 0) + 1
      })

      byBranch.forEach((stat) => {
        const active = stat.byStatus.active_client ?? 0
        stat.conversionRate = stat.total > 0 ? Math.round((active / stat.total) * 100) : 0
      })

      const total = leadsSnap.size
      const activeTotal = totalByStatus.active_client ?? 0

      return {
        ok: true,
        total,
        totalByStatus,
        conversionRate: total > 0 ? Math.round((activeTotal / total) * 100) : 0,
        byBranch: Array.from(byBranch.values()).sort((a, b) => b.total - a.total),
      }
    }
  )

  // ── POST /orgs/:orgId/leads ─────────────────────────────────────────────────
  // Staff creates a lead manually (phone call, walk-in, referral, etc.)
  fastify.post<{ Params: { orgId: string } }>(
    '/orgs/:orgId/leads',
    {
      schema: {
        tags: ['Leads'],
        summary: 'Manually create a lead for an organization (phone call, walk-in, referral, etc.)',
        params: orgIdParamsSchema,
        body: createLeadBodySchema,
        response: {
          201: {
            type: 'object',
            required: ['ok', 'lead'],
            properties: { ok: { type: 'boolean' }, lead: leadResponseSchema },
          },
          400: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { orgId } = request.params
      const member = await requireOrgMember(request, reply, orgId)
      if (reply.sent) return

      const featureCheck = await checkOrgHasFeature(orgId, 'crm')
      if (!featureCheck.ok) {
        return reply.code(403).send({ error: featureCheck.error, upgradeRequired: true })
      }

      const parse = manualLeadSchema.safeParse(request.body)
      if (!parse.success) {
        return reply.code(400).send({ error: 'Invalid input', details: parse.error.issues })
      }
      const body = parse.data

      // A branch-scoped member can only create leads for their own branch.
      const scope = memberBranchScope(member)
      const branchId = scope ?? body.branchId ?? null

      if (branchId) {
        const branchSnap = await db.doc(`organizations/${orgId}/branches/${branchId}`).get()
        if (!branchSnap.exists) return reply.code(404).send({ error: 'Branch not found' })
      }

      const now = admin.firestore.Timestamp.fromDate(new Date())
      const ref = db.collection(`organizations/${orgId}/leads`).doc()
      const lead = {
        orgId,
        branchId,
        parentName: body.parentName.trim(),
        phone: body.phone.trim(),
        email: body.email?.trim() || null,
        childName: body.childName?.trim() || null,
        childAge: null,
        programInterest: body.programInterest?.trim() || null,
        message: null,
        source: 'manual' as const,
        status: 'new' as const,
        assignedTo: null,
        notes: body.notes?.trim() || null,
        createdAt: now,
        updatedAt: now,
      }
      await ref.set(lead)

      const snap = await ref.get()
      return reply.code(201).send({ ok: true, lead: transformLead(snap) })
    }
  )

  // ── PATCH /orgs/:orgId/leads/:leadId ───────────────────────────────────────
  fastify.patch<{ Params: { orgId: string; leadId: string } }>(
    '/orgs/:orgId/leads/:leadId',
    {
      schema: {
        tags: ['Leads'],
        summary: 'Update a lead (status, branch, assignment, or notes)',
        params: leadIdParamsSchema,
        body: updateLeadBodySchema,
        response: {
          200: okResponseSchema,
          400: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { orgId, leadId } = request.params
      const member = await requireOrgMember(request, reply, orgId)
      if (reply.sent) return

      const parse = updateLeadSchema.safeParse(request.body)
      if (!parse.success) {
        return reply.code(400).send({ error: 'Invalid input', details: parse.error.issues })
      }

      const ref = db.doc(`organizations/${orgId}/leads/${leadId}`)
      const snap = await ref.get()
      if (!snap.exists) return reply.code(404).send({ error: 'Lead not found' })

      const scope = memberBranchScope(member)
      if (scope) {
        const existingBranchId = (snap.data()?.branchId as string | null) ?? null
        if (existingBranchId !== scope) {
          return reply.code(403).send({ error: 'Lead belongs to a different branch' })
        }
        // Can't move a lead they manage out of their own branch.
        if (parse.data.branchId !== undefined && parse.data.branchId !== scope) {
          return reply.code(403).send({ error: 'Cannot reassign lead outside your branch' })
        }
      }

      const updates: Record<string, unknown> = {
        updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
      }
      if (parse.data.status !== undefined) updates.status = parse.data.status
      if (parse.data.branchId !== undefined) updates.branchId = parse.data.branchId || null
      if (parse.data.assignedTo !== undefined) updates.assignedTo = parse.data.assignedTo || null
      if (parse.data.notes !== undefined) updates.notes = parse.data.notes || null

      await ref.update(updates)
      return { ok: true }
    }
  )

  // ── DELETE /orgs/:orgId/leads/:leadId ──────────────────────────────────────
  fastify.delete<{ Params: { orgId: string; leadId: string } }>(
    '/orgs/:orgId/leads/:leadId',
    {
      schema: {
        tags: ['Leads'],
        summary: 'Delete a lead (org admins only)',
        params: leadIdParamsSchema,
        response: {
          200: okResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { orgId, leadId } = request.params
      const member = await requireOrgMember(request, reply, orgId)
      if (reply.sent) return
      if (member.role !== 'org_admin') {
        return reply.code(403).send({ error: 'Only org admins can delete leads' })
      }

      const ref = db.doc(`organizations/${orgId}/leads/${leadId}`)
      const snap = await ref.get()
      if (!snap.exists) return reply.code(404).send({ error: 'Lead not found' })

      const scope = memberBranchScope(member)
      if (scope && ((snap.data()?.branchId as string | null) ?? null) !== scope) {
        return reply.code(403).send({ error: 'Lead belongs to a different branch' })
      }

      await ref.delete()
      return { ok: true }
    }
  )
}

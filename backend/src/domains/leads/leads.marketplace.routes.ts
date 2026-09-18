import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'crypto'
import admin from 'firebase-admin'
import { z } from 'zod'
import { getFirestore } from '../../infrastructure/database/firebase.js'

const RATE = { max: 10, timeWindow: '1 minute' }

const publicLeadSchema = z.object({
  branchId: z.string().max(200).optional().nullable(),
  parentName: z.string().min(1).max(200),
  phone: z.string().min(5).max(30),
  email: z.string().email().max(200).optional().nullable(),
  childName: z.string().max(200).optional().nullable(),
  childAge: z.string().max(50).optional().nullable(),
  programInterest: z.string().max(300).optional().nullable(),
  message: z.string().max(1000).optional().nullable(),
})

/**
 * Public "admission request" form — no auth required.
 * Used from an org's marketplace profile (and its branch cards) so a parent
 * can leave a lead without creating a Nuroo account first.
 */
export const leadsMarketplaceRoute: FastifyPluginAsync = async (fastify) => {
  const db = getFirestore()

  fastify.post<{ Params: { orgId: string } }>(
    '/marketplace/orgs/:orgId/leads',
    { config: { rateLimit: RATE } },
    async (request, reply) => {
      const { orgId } = request.params
      const orgSnap = await db.doc(`organizations/${orgId}`).get()
      if (!orgSnap.exists) return reply.code(404).send({ error: 'Organization not found' })

      const parse = publicLeadSchema.safeParse(request.body)
      if (!parse.success) {
        return reply.code(400).send({ error: 'Invalid input', details: parse.error.issues })
      }
      const body = parse.data

      if (body.branchId) {
        const branchSnap = await db.doc(`organizations/${orgId}/branches/${body.branchId}`).get()
        if (!branchSnap.exists) return reply.code(404).send({ error: 'Branch not found' })
      }

      const id = randomUUID()
      const now = admin.firestore.Timestamp.fromDate(new Date())
      const lead = {
        orgId,
        branchId: body.branchId || null,
        parentName: body.parentName.trim(),
        phone: body.phone.trim(),
        email: body.email?.trim() || null,
        childName: body.childName?.trim() || null,
        childAge: body.childAge?.trim() || null,
        programInterest: body.programInterest?.trim() || null,
        message: body.message?.trim() || null,
        source: 'marketplace' as const,
        status: 'new' as const,
        assignedTo: null,
        notes: null,
        createdAt: now,
        updatedAt: now,
      }

      await db.doc(`organizations/${orgId}/leads/${id}`).set(lead)

      return reply.code(201).send({ ok: true, leadId: id })
    }
  )
}

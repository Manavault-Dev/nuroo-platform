import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { getFirestore } from '../../infrastructure/database/firebase.js'
import { requireOrgMember } from '../../infrastructure/auth/rbac.js'
import type { BlockedPeriod } from './types.js'

const RATE = { max: 60, timeWindow: '1 minute' }

const blockSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  reason: z.string().max(200).nullable().optional(),
})

const orgSpecialistParamsSchema = {
  type: 'object',
  required: ['orgId', 'specialistId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    specialistId: { type: 'string', description: 'Specialist user ID' },
  },
} as const

const blockParamsSchema = {
  type: 'object',
  required: ['orgId', 'specialistId', 'blockId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    specialistId: { type: 'string', description: 'Specialist user ID' },
    blockId: { type: 'string', description: 'Blocked period ID' },
  },
} as const

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' } },
} as const

const okResponseSchema = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
} as const

const blockedPeriodResponseSchema = {
  type: 'object',
  required: ['id', 'specialistId', 'orgId', 'startDate', 'endDate', 'createdAt'],
  properties: {
    id: { type: 'string' },
    specialistId: { type: 'string' },
    orgId: { type: 'string' },
    startDate: { type: 'string' },
    endDate: { type: 'string' },
    startTime: { type: ['string', 'null'] },
    endTime: { type: ['string', 'null'] },
    reason: { type: ['string', 'null'] },
    createdAt: { type: 'string' },
  },
} as const

export const blockingRoute: FastifyPluginAsync = async (fastify) => {
  const db = getFirestore()

  const col = (orgId: string, specialistId: string) =>
    db
      .collection(`organizations/${orgId}/specialistBlocking`)
      .where('specialistId', '==', specialistId)

  /** GET /orgs/:orgId/specialists/:specialistId/blocking */
  fastify.get<{ Params: { orgId: string; specialistId: string } }>(
    '/orgs/:orgId/specialists/:specialistId/blocking',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Booking'],
        summary: "List a specialist's blocked (unavailable) periods",
        params: orgSpecialistParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'blocks'],
            properties: {
              ok: { type: 'boolean' },
              blocks: { type: 'array', items: blockedPeriodResponseSchema },
            },
          },
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const { orgId, specialistId } = request.params
      await requireOrgMember(request, reply, orgId)
      if (reply.sent) return

      const snap = await col(orgId, specialistId).orderBy('startDate', 'asc').get()
      const blocks = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as BlockedPeriod[]
      return { ok: true, blocks }
    }
  )

  /** POST /orgs/:orgId/specialists/:specialistId/blocking */
  fastify.post<{ Params: { orgId: string; specialistId: string } }>(
    '/orgs/:orgId/specialists/:specialistId/blocking',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Booking'],
        summary: 'Create a blocked (unavailable) period for a specialist',
        params: orgSpecialistParamsSchema,
        body: {
          type: 'object',
          required: ['startDate', 'endDate'],
          additionalProperties: true,
          properties: {
            startDate: { type: 'string', description: 'YYYY-MM-DD' },
            endDate: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
            startTime: { type: ['string', 'null'], description: 'HH:MM, omit for full-day block' },
            endTime: { type: ['string', 'null'], description: 'HH:MM, omit for full-day block' },
            reason: { type: ['string', 'null'], maxLength: 200 },
          },
        },
        response: {
          201: {
            type: 'object',
            required: ['ok', 'block'],
            properties: { ok: { type: 'boolean' }, block: blockedPeriodResponseSchema },
          },
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const { orgId, specialistId } = request.params
      const member = await requireOrgMember(request, reply, orgId)
      if (reply.sent) return

      const uid = request.user.uid
      if (member.role !== 'org_admin' && uid !== specialistId) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      const parse = blockSchema.safeParse(request.body)
      if (!parse.success) {
        return reply.code(400).send({ error: 'Invalid block', issues: parse.error.issues })
      }

      const { startDate, endDate, startTime, endTime, reason } = parse.data

      if (endDate < startDate) {
        return reply.code(400).send({ error: 'endDate must be >= startDate' })
      }
      if ((startTime && !endTime) || (!startTime && endTime)) {
        return reply.code(400).send({ error: 'Provide both startTime and endTime, or neither' })
      }

      const id = randomUUID()
      const doc: Omit<BlockedPeriod, 'id'> = {
        specialistId,
        orgId,
        startDate,
        endDate,
        startTime: startTime ?? null,
        endTime: endTime ?? null,
        reason: reason ?? null,
        createdAt: new Date().toISOString(),
      }

      await db.doc(`organizations/${orgId}/specialistBlocking/${id}`).set(doc)
      return reply.code(201).send({ ok: true, block: { id, ...doc } })
    }
  )

  /** DELETE /orgs/:orgId/specialists/:specialistId/blocking/:blockId */
  fastify.delete<{ Params: { orgId: string; specialistId: string; blockId: string } }>(
    '/orgs/:orgId/specialists/:specialistId/blocking/:blockId',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Booking'],
        summary: 'Delete a blocked period for a specialist',
        params: blockParamsSchema,
        response: {
          200: okResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const { orgId, specialistId, blockId } = request.params
      const member = await requireOrgMember(request, reply, orgId)
      if (reply.sent) return

      const uid = request.user.uid
      if (member.role !== 'org_admin' && uid !== specialistId) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      const ref = db.doc(`organizations/${orgId}/specialistBlocking/${blockId}`)
      const snap = await ref.get()
      if (!snap.exists || snap.data()?.specialistId !== specialistId) {
        return reply.code(404).send({ error: 'Block not found' })
      }

      await ref.delete()
      return { ok: true }
    }
  )
}

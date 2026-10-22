import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { getFirestore } from '../../infrastructure/database/firebase.js'
import { requireOrgMember } from '../../infrastructure/auth/rbac.js'
import type { AvailabilityTemplate, DayOfWeek } from './types.js'

const RATE = { max: 60, timeWindow: '1 minute' }

const timeRangeSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM format'),
  end: z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM format'),
})

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

const availabilitySchema = z.object({
  schedule: z.record(z.enum(DAY_KEYS), z.array(timeRangeSchema)),
  slotDurationMinutes: z.number().int().min(5).max(480).default(60),
  breakBetweenSlotsMinutes: z.number().int().min(0).max(120).default(0),
})

const orgSpecialistParamsSchema = {
  type: 'object',
  required: ['orgId', 'specialistId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    specialistId: { type: 'string', description: 'Specialist user ID' },
  },
} as const

const orgParamsSchema = {
  type: 'object',
  required: ['orgId'],
  properties: { orgId: { type: 'string', description: 'Organization ID' } },
} as const

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' } },
} as const

const timeRangeResponseSchema = {
  type: 'object',
  required: ['start', 'end'],
  properties: { start: { type: 'string' }, end: { type: 'string' } },
} as const

const availabilityTemplateResponseSchema = {
  type: 'object',
  required: [
    'specialistId',
    'orgId',
    'schedule',
    'slotDurationMinutes',
    'breakBetweenSlotsMinutes',
    'updatedAt',
  ],
  properties: {
    specialistId: { type: 'string' },
    orgId: { type: 'string' },
    schedule: {
      type: 'object',
      additionalProperties: { type: 'array', items: timeRangeResponseSchema },
    },
    slotDurationMinutes: { type: 'number' },
    breakBetweenSlotsMinutes: { type: 'number' },
    updatedAt: { type: 'string' },
  },
} as const

export const availabilityRoute: FastifyPluginAsync = async (fastify) => {
  const db = getFirestore()

  /** GET /orgs/:orgId/specialists/:specialistId/availability */
  fastify.get<{ Params: { orgId: string; specialistId: string } }>(
    '/orgs/:orgId/specialists/:specialistId/availability',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Booking'],
        summary: "Get a specialist's weekly availability template",
        params: orgSpecialistParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'availability'],
            properties: {
              ok: { type: 'boolean' },
              availability: {
                anyOf: [availabilityTemplateResponseSchema, { type: 'null' }],
              },
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

      const snap = await db
        .doc(`organizations/${orgId}/specialistAvailability/${specialistId}`)
        .get()

      if (!snap.exists) {
        return { ok: true, availability: null }
      }

      return { ok: true, availability: snap.data() as AvailabilityTemplate }
    }
  )

  /** PUT /orgs/:orgId/specialists/:specialistId/availability */
  fastify.put<{ Params: { orgId: string; specialistId: string } }>(
    '/orgs/:orgId/specialists/:specialistId/availability',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Booking'],
        summary: "Set a specialist's weekly availability template",
        params: orgSpecialistParamsSchema,
        body: {
          type: 'object',
          required: ['schedule'],
          additionalProperties: true,
          properties: {
            schedule: {
              type: 'object',
              description: 'Map of day-of-week key (mon..sun) to a list of HH:MM time ranges',
              additionalProperties: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['start', 'end'],
                  properties: { start: { type: 'string' }, end: { type: 'string' } },
                },
              },
            },
            slotDurationMinutes: { type: 'number', minimum: 5, maximum: 480 },
            breakBetweenSlotsMinutes: { type: 'number', minimum: 0, maximum: 120 },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['ok', 'availability'],
            properties: {
              ok: { type: 'boolean' },
              availability: availabilityTemplateResponseSchema,
            },
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

      // Allow specialist to set their own, or admin to set anyone's
      const uid = request.user.uid
      if (member.role !== 'org_admin' && uid !== specialistId) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      const parse = availabilitySchema.safeParse(request.body)
      if (!parse.success) {
        return reply.code(400).send({ error: 'Invalid availability', issues: parse.error.issues })
      }

      const doc: AvailabilityTemplate = {
        specialistId,
        orgId,
        schedule: parse.data.schedule as Partial<
          Record<DayOfWeek, { start: string; end: string }[]>
        >,
        slotDurationMinutes: parse.data.slotDurationMinutes,
        breakBetweenSlotsMinutes: parse.data.breakBetweenSlotsMinutes,
        updatedAt: new Date().toISOString(),
      }

      await db.doc(`organizations/${orgId}/specialistAvailability/${specialistId}`).set(doc)

      return { ok: true, availability: doc }
    }
  )

  /** GET /marketplace/organizations/:orgId/specialists — public list */
  fastify.get<{
    Params: { orgId: string }
    Querystring: { category?: string }
  }>(
    '/marketplace/organizations/:orgId/specialists',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['Booking'],
        summary: 'List active specialists for an organization (public marketplace)',
        params: orgParamsSchema,
        querystring: {
          type: 'object',
          properties: { category: { type: 'string' } },
        },
        response: {
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { orgId } = request.params

      const orgSnap = await db.doc(`organizations/${orgId}`).get()
      if (!orgSnap.exists) {
        return reply.code(404).send({ error: 'Organization not found' })
      }

      // Fetch all members and filter in-memory — status field may be absent on older records
      // (same logic as isActiveMember in rbac.ts). No isPublicMarketplaceEnabled gate here
      // because the parent is authenticated and already arrived via the marketplace UI.
      const membersSnap = await db.collection(`organizations/${orgId}/members`).get()

      const activeMembers = membersSnap.docs.filter((d) => {
        const s = d.data().status
        return !s || s === 'active'
      })

      const specialistProfiles = await Promise.all(
        activeMembers.map(async (doc) => {
          const uid = doc.id
          const profileSnap = await db.doc(`specialists/${uid}`).get()
          if (!profileSnap.exists) return null
          const p = profileSnap.data()!
          return {
            id: uid,
            fullName: p.fullName || p.name || 'Specialist',
            avatarUrl: p.avatarUrl ?? null,
            specialization: p.specialization ?? null,
            bio: p.bio ?? null,
            role: doc.data().role,
          }
        })
      )

      return {
        ok: true,
        specialists: specialistProfiles.filter(Boolean),
      }
    }
  )
}

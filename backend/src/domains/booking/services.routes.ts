import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { getFirestore } from '../../infrastructure/database/firebase.js'
import { requireOrgMember } from '../../infrastructure/auth/rbac.js'
import type { SpecialistService } from './types.js'

const RATE = { max: 60, timeWindow: '1 minute' }

const serviceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional().nullable(),
  durationMinutes: z.number().int().min(5).max(480),
  price: z.number().min(0),
  currency: z.string().trim().length(3).default('KGS'),
  specialistId: z.string().trim().min(1),
  intakeFormId: z.string().trim().min(1).optional().nullable(),
})

const updateServiceSchema = serviceSchema.partial().refine((b) => Object.keys(b).length > 0)

function sortByCreatedAtDesc<T extends Record<string, unknown>>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))
  )
}

const orgParamsSchema = {
  type: 'object',
  required: ['orgId'],
  properties: { orgId: { type: 'string', description: 'Organization ID' } },
} as const

const serviceParamsSchema = {
  type: 'object',
  required: ['orgId', 'serviceId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    serviceId: { type: 'string', description: 'Service ID' },
  },
} as const

const specialistServicesParamsSchema = {
  type: 'object',
  required: ['orgId', 'specialistId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    specialistId: { type: 'string', description: 'Specialist user ID' },
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

const serviceBodySchema = {
  type: 'object',
  required: ['name', 'durationMinutes', 'price', 'specialistId'],
  additionalProperties: true,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: ['string', 'null'], maxLength: 1000 },
    durationMinutes: { type: 'number', minimum: 5, maximum: 480 },
    price: { type: 'number', minimum: 0 },
    currency: { type: 'string', minLength: 3, maxLength: 3, description: 'Defaults to KGS' },
    specialistId: { type: 'string', minLength: 1 },
    intakeFormId: { type: ['string', 'null'] },
  },
} as const

const updateServiceBodySchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: ['string', 'null'], maxLength: 1000 },
    durationMinutes: { type: 'number', minimum: 5, maximum: 480 },
    price: { type: 'number', minimum: 0 },
    currency: { type: 'string', minLength: 3, maxLength: 3 },
    specialistId: { type: 'string', minLength: 1 },
    intakeFormId: { type: ['string', 'null'] },
  },
} as const

const serviceResponseSchema = {
  type: 'object',
  required: [
    'id',
    'orgId',
    'specialistId',
    'name',
    'durationMinutes',
    'price',
    'currency',
    'isActive',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string' },
    orgId: { type: 'string' },
    specialistId: { type: 'string' },
    name: { type: 'string' },
    description: { type: ['string', 'null'] },
    durationMinutes: { type: 'number' },
    price: { type: 'number' },
    currency: { type: 'string' },
    isActive: { type: 'boolean' },
    intakeFormId: { type: ['string', 'null'] },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const

export const servicesRoute: FastifyPluginAsync = async (fastify) => {
  const db = getFirestore()

  /** GET /orgs/:orgId/services — list services */
  fastify.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId/services',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Booking'],
        summary: 'List active services for an organization',
        params: orgParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'services'],
            properties: {
              ok: { type: 'boolean' },
              services: { type: 'array', items: serviceResponseSchema },
            },
          },
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const { orgId } = request.params
      await requireOrgMember(request, reply, orgId)
      if (reply.sent) return

      const snap = await db
        .collection(`organizations/${orgId}/specialistServices`)
        .where('isActive', '==', true)
        .get()

      return {
        ok: true,
        services: sortByCreatedAtDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      }
    }
  )

  /** POST /orgs/:orgId/services — create service */
  fastify.post<{ Params: { orgId: string } }>(
    '/orgs/:orgId/services',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Booking'],
        summary: 'Create a new service for a specialist',
        params: orgParamsSchema,
        body: serviceBodySchema,
        response: {
          201: {
            type: 'object',
            required: ['ok', 'service'],
            properties: { ok: { type: 'boolean' }, service: serviceResponseSchema },
          },
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const { orgId } = request.params
      const member = await requireOrgMember(request, reply, orgId)
      if (reply.sent) return
      if (member.role !== 'org_admin') return reply.code(403).send({ error: 'Forbidden' })

      const parse = serviceSchema.safeParse(request.body)
      if (!parse.success)
        return reply.code(400).send({ error: 'Invalid input', issues: parse.error.issues })

      const now = new Date().toISOString()
      const doc = {
        orgId,
        ...parse.data,
        description: parse.data.description ?? null,
        intakeFormId: parse.data.intakeFormId ?? null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }

      const ref = db.collection(`organizations/${orgId}/specialistServices`).doc()
      await ref.set(doc)

      return reply.code(201).send({ ok: true, service: { id: ref.id, ...doc } })
    }
  )

  /** PATCH /orgs/:orgId/services/:serviceId — update service */
  fastify.patch<{ Params: { orgId: string; serviceId: string } }>(
    '/orgs/:orgId/services/:serviceId',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Booking'],
        summary: 'Update a service',
        params: serviceParamsSchema,
        body: updateServiceBodySchema,
        response: {
          200: okResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const { orgId, serviceId } = request.params
      const member = await requireOrgMember(request, reply, orgId)
      if (reply.sent) return
      if (member.role !== 'org_admin') return reply.code(403).send({ error: 'Forbidden' })

      const parse = updateServiceSchema.safeParse(request.body)
      if (!parse.success) return reply.code(400).send({ error: 'Invalid input' })

      const ref = db.doc(`organizations/${orgId}/specialistServices/${serviceId}`)
      const snap = await ref.get()
      if (!snap.exists) return reply.code(404).send({ error: 'Service not found' })

      await ref.update({ ...parse.data, updatedAt: new Date().toISOString() })

      return { ok: true }
    }
  )

  /** DELETE /orgs/:orgId/services/:serviceId — soft delete */
  fastify.delete<{ Params: { orgId: string; serviceId: string } }>(
    '/orgs/:orgId/services/:serviceId',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Booking'],
        summary: 'Soft-delete (deactivate) a service',
        params: serviceParamsSchema,
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
      const { orgId, serviceId } = request.params
      const member = await requireOrgMember(request, reply, orgId)
      if (reply.sent) return
      if (member.role !== 'org_admin') return reply.code(403).send({ error: 'Forbidden' })

      const ref = db.doc(`organizations/${orgId}/specialistServices/${serviceId}`)
      const snap = await ref.get()
      if (!snap.exists) return reply.code(404).send({ error: 'Service not found' })

      await ref.update({ isActive: false, updatedAt: new Date().toISOString() })

      return { ok: true }
    }
  )

  /** GET /marketplace/organizations/:orgId/specialists/:specialistId/services — public */
  fastify.get<{ Params: { orgId: string; specialistId: string } }>(
    '/marketplace/organizations/:orgId/specialists/:specialistId/services',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['Booking'],
        summary: "List a specialist's active services (public marketplace)",
        params: specialistServicesParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'services'],
            properties: {
              ok: { type: 'boolean' },
              services: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'name', 'durationMinutes', 'price', 'currency'],
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    description: { type: ['string', 'null'] },
                    durationMinutes: { type: 'number' },
                    price: { type: 'number' },
                    currency: { type: 'string' },
                  },
                },
              },
            },
          },
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { orgId, specialistId } = request.params

      const orgSnap = await db.doc(`organizations/${orgId}`).get()
      if (!orgSnap.exists) {
        return reply.code(404).send({ error: 'Organization not found' })
      }

      const snap = await db
        .collection(`organizations/${orgId}/specialistServices`)
        .where('specialistId', '==', specialistId)
        .get()

      return {
        ok: true,
        services: snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as SpecialistService)
          .filter((data) => data.isActive)
          .map((data) => ({
            id: data.id,
            name: data.name,
            description: data.description,
            durationMinutes: data.durationMinutes,
            price: data.price,
            currency: data.currency,
          })),
      }
    }
  )
}

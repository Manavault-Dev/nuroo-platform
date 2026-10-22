import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { getFirestore } from '../../infrastructure/database/firebase.js'
import { requireOrgMember } from '../../infrastructure/auth/rbac.js'
import type { EventDoc } from './events.types.js'

const RATE = { max: 60, timeWindow: '1 minute' }

const eventSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().min(2).max(5000),
  coverUrl: z.string().max(2_000_000).nullable().optional(), // accepts https:// URLs or data: base64
  date: z.string().datetime(),
  endDate: z.string().datetime().nullable().optional(),
  location: z.string().min(1).max(300),
  address: z.string().max(300).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  format: z.enum(['online', 'offline', 'hybrid']),
  price: z.number().int().min(0).default(0),
  currency: z.string().default('KGS'),
  spotsTotal: z.number().int().min(0).default(0),
  category: z.string().max(100).nullable().optional(),
  ageMin: z.number().int().min(0).nullable().optional(),
  ageMax: z.number().int().min(0).nullable().optional(),
  status: z.enum(['draft', 'published', 'cancelled']).default('draft'),
})

const orgIdParamsSchema = {
  type: 'object',
  required: ['orgId'],
  properties: { orgId: { type: 'string', description: 'Organization ID' } },
} as const

const eventParamsSchema = {
  type: 'object',
  required: ['orgId', 'eventId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    eventId: { type: 'string', description: 'Event ID' },
  },
} as const

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  additionalProperties: true,
  properties: { error: { type: 'string' }, code: { type: 'string' } },
} as const

const okResponseSchema = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
} as const

const eventSchemaResponse = {
  type: 'object',
  required: ['id', 'orgId', 'title', 'date', 'format', 'status'],
  additionalProperties: true,
  properties: {
    id: { type: 'string' },
    orgId: { type: 'string' },
    orgName: { type: 'string' },
    orgLogoUrl: { type: ['string', 'null'] },
    title: { type: 'string' },
    description: { type: 'string' },
    coverUrl: { type: ['string', 'null'] },
    date: { type: 'string' },
    endDate: { type: ['string', 'null'] },
    location: { type: 'string' },
    address: { type: ['string', 'null'] },
    city: { type: ['string', 'null'] },
    format: { type: 'string', enum: ['online', 'offline', 'hybrid'] },
    price: { type: 'integer' },
    currency: { type: 'string' },
    spotsTotal: { type: 'integer' },
    registeredCount: { type: 'integer' },
    category: { type: ['string', 'null'] },
    ageMin: { type: ['integer', 'null'] },
    ageMax: { type: ['integer', 'null'] },
    status: { type: 'string', enum: ['draft', 'published', 'cancelled'] },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const

const eventBodySchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    title: { type: 'string', minLength: 2, maxLength: 200 },
    description: { type: 'string', minLength: 2, maxLength: 5000 },
    coverUrl: { type: ['string', 'null'] },
    date: { type: 'string', description: 'ISO datetime' },
    endDate: { type: ['string', 'null'], description: 'ISO datetime' },
    location: { type: 'string', minLength: 1, maxLength: 300 },
    address: { type: ['string', 'null'], maxLength: 300 },
    city: { type: ['string', 'null'], maxLength: 100 },
    format: { type: 'string', enum: ['online', 'offline', 'hybrid'] },
    price: { type: 'integer', minimum: 0 },
    currency: { type: 'string' },
    spotsTotal: { type: 'integer', minimum: 0 },
    category: { type: ['string', 'null'], maxLength: 100 },
    ageMin: { type: ['integer', 'null'], minimum: 0 },
    ageMax: { type: ['integer', 'null'], minimum: 0 },
    status: { type: 'string', enum: ['draft', 'published', 'cancelled'] },
  },
} as const

export const eventsRoute: FastifyPluginAsync = async (fastify) => {
  const db = getFirestore()

  fastify.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId/events',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Events'],
        summary: "List an organization's events",
        params: orgIdParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'events'],
            properties: {
              ok: { type: 'boolean' },
              events: { type: 'array', items: eventSchemaResponse },
            },
          },
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      await requireOrgMember(request, reply, request.params.orgId)
      if (reply.sent) return

      const snap = await db
        .collection('events')
        .where('orgId', '==', request.params.orgId)
        .limit(200)
        .get()

      const events = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => (b.date > a.date ? 1 : -1))
      return { ok: true, events }
    }
  )

  fastify.post<{ Params: { orgId: string } }>(
    '/orgs/:orgId/events',
    {
      config: { rateLimit: RATE },
      bodyLimit: 10 * 1024 * 1024,
      schema: {
        tags: ['Events'],
        summary: 'Create a new event for an organization',
        params: orgIdParamsSchema,
        body: {
          ...eventBodySchema,
          required: ['title', 'description', 'date', 'location', 'format'],
        },
        response: {
          201: {
            type: 'object',
            required: ['ok', 'id', 'event'],
            properties: {
              ok: { type: 'boolean' },
              id: { type: 'string' },
              event: eventSchemaResponse,
            },
          },
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      await requireOrgMember(request, reply, request.params.orgId)
      if (reply.sent) return

      const body = eventSchema.parse(request.body)
      const orgSnap = await db.doc(`organizations/${request.params.orgId}`).get()
      const orgData = orgSnap.data() ?? {}

      const now = new Date().toISOString()
      const id = randomUUID()
      const coverUrl =
        body.coverUrl && Buffer.byteLength(body.coverUrl, 'utf8') < 700_000 ? body.coverUrl : null

      const doc: Omit<EventDoc, 'id'> = {
        orgId: request.params.orgId,
        orgName: orgData.name ?? orgData.orgName ?? '',
        orgLogoUrl: orgData.logoUrl ?? null,
        title: body.title,
        description: body.description,
        coverUrl,
        date: body.date,
        endDate: body.endDate ?? null,
        location: body.location,
        address: body.address ?? null,
        city: body.city ?? null,
        format: body.format,
        price: body.price,
        currency: body.currency,
        spotsTotal: body.spotsTotal,
        registeredCount: 0,
        category: body.category ?? null,
        ageMin: body.ageMin ?? null,
        ageMax: body.ageMax ?? null,
        status: body.status,
        createdAt: now,
        updatedAt: now,
      }

      await db.doc(`events/${id}`).set(doc)
      return reply.code(201).send({ ok: true, id, event: { id, ...doc } })
    }
  )

  fastify.put<{ Params: { orgId: string; eventId: string } }>(
    '/orgs/:orgId/events/:eventId',
    {
      config: { rateLimit: RATE },
      bodyLimit: 10 * 1024 * 1024,
      schema: {
        tags: ['Events'],
        summary: 'Replace/update an event',
        params: eventParamsSchema,
        body: eventBodySchema,
        response: {
          200: okResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      await requireOrgMember(request, reply, request.params.orgId)
      if (reply.sent) return

      const { orgId, eventId } = request.params
      const ref = db.doc(`events/${eventId}`)
      const snap = await ref.get()
      if (!snap.exists || snap.data()?.orgId !== orgId) {
        return reply.code(404).send({ error: 'Event not found' })
      }

      const body = eventSchema.partial().parse(request.body)
      const patch = { ...body, updatedAt: new Date().toISOString() }
      if (patch.coverUrl && Buffer.byteLength(patch.coverUrl, 'utf8') >= 700_000) {
        patch.coverUrl = null
      }
      await ref.update(patch)
      return { ok: true }
    }
  )

  fastify.delete<{ Params: { orgId: string; eventId: string } }>(
    '/orgs/:orgId/events/:eventId',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Events'],
        summary: 'Delete an event',
        params: eventParamsSchema,
        response: {
          200: okResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      await requireOrgMember(request, reply, request.params.orgId)
      if (reply.sent) return

      const { orgId, eventId } = request.params
      const ref = db.doc(`events/${eventId}`)
      const snap = await ref.get()
      if (!snap.exists || snap.data()?.orgId !== orgId) {
        return reply.code(404).send({ error: 'Event not found' })
      }

      await ref.delete()
      return { ok: true }
    }
  )

  fastify.get<{ Params: { orgId: string; eventId: string } }>(
    '/orgs/:orgId/events/:eventId/registrations',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Events'],
        summary: 'List registrations for an event',
        params: eventParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'registrations'],
            properties: {
              ok: { type: 'boolean' },
              registrations: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['uid'],
                  additionalProperties: true,
                  properties: {
                    uid: { type: 'string' },
                    email: { type: ['string', 'null'] },
                    displayName: { type: ['string', 'null'] },
                    phone: { type: ['string', 'null'] },
                    registeredAt: { type: 'string' },
                  },
                },
              },
            },
          },
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      await requireOrgMember(request, reply, request.params.orgId)
      if (reply.sent) return

      const { orgId, eventId } = request.params
      const eventSnap = await db.doc(`events/${eventId}`).get()
      if (!eventSnap.exists || eventSnap.data()?.orgId !== orgId) {
        return reply.code(404).send({ error: 'Event not found' })
      }

      const snap = await db
        .collection(`events/${eventId}/registrations`)
        .orderBy('registeredAt', 'desc')
        .limit(500)
        .get()

      const registrations = snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
      return { ok: true, registrations }
    }
  )
}

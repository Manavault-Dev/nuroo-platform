import { z } from 'zod'

import { getFirestore } from '../../infrastructure/database/firebase.js'
import { requireOrgMember, requireChildAccess } from '../../infrastructure/auth/rbac.js'
import {
  getChildGuardians,
  addGuardian,
  updateGuardian,
  deleteGuardian,
} from './children.service.js'

const guardianCreateSchema = z.object({
  fullName: z.string().min(1).max(200),
  relationship: z.enum(['mother', 'father', 'guardian', 'other']),
  phone: z.string().max(50).optional(),
  whatsapp: z.string().max(50).optional(),
  email: z.string().email().optional().or(z.literal('')),
  preferredContactMethod: z.enum(['phone', 'whatsapp', 'email']).optional(),
  isPrimaryContact: z.boolean().optional().default(false),
  isEmergencyContact: z.boolean().optional().default(false),
  appUserId: z.string().optional(),
})

const guardianUpdateSchema = guardianCreateSchema.partial()

const orgIdChildIdParamsSchema = {
  type: 'object',
  required: ['orgId', 'childId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    childId: { type: 'string', description: 'Child ID' },
  },
} as const

const orgIdChildIdGuardianIdParamsSchema = {
  type: 'object',
  required: ['orgId', 'childId', 'guardianId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    childId: { type: 'string', description: 'Child ID' },
    guardianId: { type: 'string', description: 'Guardian ID' },
  },
} as const

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' } },
  additionalProperties: true,
} as const

const guardianCreateBodySchema = {
  type: 'object',
  required: ['fullName', 'relationship'],
  properties: {
    fullName: { type: 'string' },
    relationship: { type: 'string', enum: ['mother', 'father', 'guardian', 'other'] },
    phone: { type: 'string' },
    whatsapp: { type: 'string' },
    email: { type: 'string' },
    preferredContactMethod: { type: 'string', enum: ['phone', 'whatsapp', 'email'] },
    isPrimaryContact: { type: 'boolean' },
    isEmergencyContact: { type: 'boolean' },
    appUserId: { type: 'string' },
  },
  additionalProperties: true,
} as const

const guardianUpdateBodySchema = {
  type: 'object',
  properties: {
    fullName: { type: 'string' },
    relationship: { type: 'string', enum: ['mother', 'father', 'guardian', 'other'] },
    phone: { type: 'string' },
    whatsapp: { type: 'string' },
    email: { type: 'string' },
    preferredContactMethod: { type: 'string', enum: ['phone', 'whatsapp', 'email'] },
    isPrimaryContact: { type: 'boolean' },
    isEmergencyContact: { type: 'boolean' },
    appUserId: { type: 'string' },
  },
  additionalProperties: true,
} as const

const guardianSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string' },
    fullName: { type: 'string' },
    relationship: { type: 'string' },
    phone: { type: ['string', 'null'] },
    whatsapp: { type: ['string', 'null'] },
    email: { type: ['string', 'null'] },
    preferredContactMethod: { type: ['string', 'null'] },
    isPrimaryContact: { type: 'boolean' },
    isEmergencyContact: { type: 'boolean' },
    appUserId: { type: ['string', 'null'] },
    createdAt: { type: ['string', 'null'] },
    updatedAt: { type: ['string', 'null'] },
  },
  additionalProperties: true,
} as const

export const childrenGuardiansRoute: import('fastify').FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { orgId: string; childId: string } }>(
    '/orgs/:orgId/children/:childId/guardians',
    {
      schema: {
        tags: ['Children'],
        summary: "Get a child's guardians",
        params: orgIdChildIdParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'guardians'],
            properties: {
              ok: { type: 'boolean' },
              guardians: { type: 'array', items: guardianSchema },
            },
          },
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, childId } = request.params
        await requireOrgMember(request, reply, orgId)
        const resolvedChildId = await requireChildAccess(request, reply, orgId, childId)

        const db = getFirestore()
        const guardians = await getChildGuardians(db, orgId, resolvedChildId)
        return { ok: true, guardians }
      } catch (error: unknown) {
        fastify.log.error({ err: error }, 'Route handler failed')
        return reply.code(500).send({
          error: 'Failed to fetch guardians',
          details: error instanceof Error ? error.message : '',
        })
      }
    }
  )

  fastify.post<{
    Params: { orgId: string; childId: string }
    Body: z.infer<typeof guardianCreateSchema>
  }>(
    '/orgs/:orgId/children/:childId/guardians',
    {
      schema: {
        tags: ['Children'],
        summary: 'Add a guardian to a child',
        params: orgIdChildIdParamsSchema,
        body: guardianCreateBodySchema,
        response: {
          201: {
            type: 'object',
            required: ['ok', 'guardian'],
            properties: { ok: { type: 'boolean' }, guardian: guardianSchema },
          },
          400: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, childId } = request.params
        await requireOrgMember(request, reply, orgId)
        const resolvedChildId = await requireChildAccess(request, reply, orgId, childId)

        const parse = guardianCreateSchema.safeParse(request.body)
        if (!parse.success) {
          return reply
            .code(400)
            .send({ error: 'Invalid guardian data', details: parse.error.errors })
        }

        const db = getFirestore()
        const { id, now } = await addGuardian(db, resolvedChildId, parse.data)

        return reply.code(201).send({
          ok: true,
          guardian: {
            id,
            ...parse.data,
            createdAt: now.toDate().toISOString(),
            updatedAt: now.toDate().toISOString(),
          },
        })
      } catch (error: unknown) {
        fastify.log.error({ err: error }, 'Route handler failed')
        return reply.code(500).send({
          error: 'Failed to create guardian',
          details: error instanceof Error ? error.message : '',
        })
      }
    }
  )

  fastify.patch<{
    Params: { orgId: string; childId: string; guardianId: string }
    Body: z.infer<typeof guardianUpdateSchema>
  }>(
    '/orgs/:orgId/children/:childId/guardians/:guardianId',
    {
      schema: {
        tags: ['Children'],
        summary: 'Update a guardian contact info',
        params: orgIdChildIdGuardianIdParamsSchema,
        body: guardianUpdateBodySchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'guardian'],
            properties: { ok: { type: 'boolean' }, guardian: guardianSchema },
          },
          400: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, childId, guardianId } = request.params
        await requireOrgMember(request, reply, orgId)
        const resolvedChildId = await requireChildAccess(request, reply, orgId, childId)

        const parse = guardianUpdateSchema.safeParse(request.body)
        if (!parse.success) {
          return reply
            .code(400)
            .send({ error: 'Invalid guardian data', details: parse.error.errors })
        }

        const db = getFirestore()
        try {
          const { updated, now } = await updateGuardian(db, resolvedChildId, guardianId, parse.data)
          return {
            ok: true,
            guardian: {
              id: guardianId,
              ...updated,
              createdAt: updated?.createdAt?.toDate()?.toISOString() ?? null,
              updatedAt: now.toDate().toISOString(),
            },
          }
        } catch (err: unknown) {
          if (err instanceof Error && (err as any).statusCode === 404) {
            return reply.code(404).send({ error: 'Guardian not found' })
          }
          throw err
        }
      } catch (error: unknown) {
        fastify.log.error({ err: error }, 'Route handler failed')
        return reply.code(500).send({
          error: 'Failed to update guardian',
          details: error instanceof Error ? error.message : '',
        })
      }
    }
  )
  fastify.delete<{ Params: { orgId: string; childId: string; guardianId: string } }>(
    '/orgs/:orgId/children/:childId/guardians/:guardianId',
    {
      schema: {
        tags: ['Children'],
        summary: 'Delete a guardian from a child',
        params: orgIdChildIdGuardianIdParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok'],
            properties: { ok: { type: 'boolean' } },
          },
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, childId, guardianId } = request.params
        await requireOrgMember(request, reply, orgId)
        const resolvedChildId = await requireChildAccess(request, reply, orgId, childId)

        const db = getFirestore()
        try {
          await deleteGuardian(db, resolvedChildId, guardianId)
          return { ok: true }
        } catch (err: unknown) {
          if (err instanceof Error && (err as any).statusCode === 404) {
            return reply.code(404).send({ error: 'Guardian not found' })
          }
          throw err
        }
      } catch (error: unknown) {
        fastify.log.error({ err: error }, 'Route handler failed')
        return reply.code(500).send({
          error: 'Failed to delete guardian',
          details: error instanceof Error ? error.message : '',
        })
      }
    }
  )
}

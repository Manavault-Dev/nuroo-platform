import { getFirestore } from '../../infrastructure/database/firebase.js'
import { requireOrgMember } from '../../infrastructure/auth/rbac.js'
import {
  fetchAssignedChildren,
  groupChildrenByParent,
  enrichChildrenWithDetails,
  buildParentConnection,
  disconnectParentFromOrg,
} from './children.service.js'

const orgIdParamsSchema = {
  type: 'object',
  required: ['orgId'],
  properties: { orgId: { type: 'string', description: 'Organization ID' } },
} as const

const orgIdParentUserIdParamsSchema = {
  type: 'object',
  required: ['orgId', 'parentUserId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    parentUserId: { type: 'string', description: 'Parent user ID' },
  },
} as const

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' } },
  additionalProperties: true,
} as const

const childInfoSchema = {
  type: 'object',
  required: ['childId', 'childName', 'assignedAt'],
  properties: {
    childId: { type: 'string' },
    childName: { type: 'string' },
    childAge: { type: 'number' },
    assignedAt: { type: ['string', 'null'] },
  },
} as const

const parentConnectionSchema = {
  type: 'object',
  required: ['parentUserId', 'parentName', 'parentEmail', 'specialistId', 'joinedAt', 'children'],
  properties: {
    parentUserId: { type: 'string' },
    parentName: { type: 'string' },
    parentEmail: { type: ['string', 'null'] },
    specialistId: { type: ['string', 'null'] },
    joinedAt: { type: ['string', 'null'] },
    children: { type: 'array', items: childInfoSchema },
  },
} as const

export const childrenConnectionsRoute: import('fastify').FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId/connections',
    {
      schema: {
        tags: ['Children'],
        summary: "List parent connections for an organization's children",
        params: orgIdParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'connections', 'count'],
            properties: {
              ok: { type: 'boolean' },
              connections: { type: 'array', items: parentConnectionSchema },
              count: { type: 'number' },
            },
          },
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId } = request.params
        const member = await requireOrgMember(request, reply, orgId)
        const { uid } = request.user!
        const role = member.role

        const db = getFirestore()
        const assignedChildrenSnap = await fetchAssignedChildren(db, orgId, role, uid)
        const { parentMap, orgLinkByChildId } = groupChildrenByParent(assignedChildrenSnap.docs)

        await enrichChildrenWithDetails(db, parentMap, orgLinkByChildId)

        const connections = await Promise.all(
          Array.from(parentMap.entries()).map(([parentUserId, children]) =>
            buildParentConnection(db, orgId, parentUserId, children)
          )
        )

        return {
          ok: true,
          connections,
          count: connections.length,
        }
      } catch (error: unknown) {
        fastify.log.error({ err: error }, 'Route handler failed')
        return reply.code(500).send({
          error: 'Failed to fetch connections',
          details: error instanceof Error ? error.message : '',
        })
      }
    }
  )
  fastify.delete<{ Params: { orgId: string; parentUserId: string } }>(
    '/orgs/:orgId/connections/:parentUserId',
    {
      schema: {
        tags: ['Children'],
        summary: 'Disconnect a parent from an organization',
        params: orgIdParentUserIdParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'childrenUnlinked', 'groupsUpdated'],
            properties: {
              ok: { type: 'boolean' },
              childrenUnlinked: { type: 'number' },
              groupsUpdated: { type: 'number' },
            },
          },
          403: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, parentUserId } = request.params
        const member = await requireOrgMember(request, reply, orgId)
        if (member.role !== 'org_admin') {
          return reply.code(403).send({ error: 'Only org admins can disconnect parents' })
        }

        const db = getFirestore()
        const result = await disconnectParentFromOrg(db, orgId, parentUserId)
        return { ok: true, ...result }
      } catch (error: unknown) {
        fastify.log.error({ err: error }, 'Route handler failed')
        return reply.code(500).send({
          error: 'Failed to disconnect parent',
          details: error instanceof Error ? error.message : '',
        })
      }
    }
  )
}

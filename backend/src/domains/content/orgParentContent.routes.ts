import { getFirestore } from '../../infrastructure/database/firebase.js'
import {
  requireParentOrgAccess,
  listParentRoadmaps,
  getParentRoadmap,
  listParentTasks,
  getParentTask,
  completeParentTask,
  getRoadmapAssignmentsForParent,
  listAllParentTasks,
  listParentChildTasks,
  updateParentChildTask,
  getChildRoadmapAssignments,
  submitParentChildTask,
} from './orgContentParent.service.js'

const orgIdParamsSchema = {
  type: 'object',
  required: ['orgId'],
  properties: { orgId: { type: 'string', description: 'Organization ID' } },
} as const

const orgRoadmapParamsSchema = {
  type: 'object',
  required: ['orgId', 'roadmapId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    roadmapId: { type: 'string', description: 'Content roadmap ID' },
  },
} as const

const orgTaskParamsSchema = {
  type: 'object',
  required: ['orgId', 'taskId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    taskId: { type: 'string', description: 'Content task ID' },
  },
} as const

const orgChildParamsSchema = {
  type: 'object',
  required: ['orgId', 'childId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    childId: { type: 'string', description: 'Child ID' },
  },
} as const

const orgChildTaskParamsSchema = {
  type: 'object',
  required: ['orgId', 'childId', 'taskId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    childId: { type: 'string', description: 'Child ID' },
    taskId: { type: 'string', description: 'Task ID' },
  },
} as const

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' }, message: { type: 'string' } },
} as const

const contentItemSchema = {
  type: 'object',
  additionalProperties: true,
} as const

export const orgParentContentRoute: import('fastify').FastifyPluginAsync = async (fastify) => {
  async function checkParentAccess(
    request: any,
    reply: any,
    orgId: string
  ): Promise<{ parentUid: string; childIds: string[] } | false> {
    if (!request.user) {
      reply.code(401).send({ error: 'Unauthorized' })
      return false
    }
    const db = getFirestore()
    const result = await requireParentOrgAccess(db, request.user.uid, orgId)
    if (!result) {
      reply.code(401).send({
        error: 'Organization access invalid',
        message: 'You are not linked to this organization',
      })
      return false
    }
    return result
  }

  fastify.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId/parent/content/roadmaps',
    {
      schema: {
        tags: ['Content'],
        summary: 'List content roadmaps visible to the authenticated parent',
        params: orgIdParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'roadmaps', 'count'],
            properties: {
              ok: { type: 'boolean' },
              roadmaps: { type: 'array', items: contentItemSchema },
              count: { type: 'integer' },
            },
          },
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId } = request.params
        const access = await checkParentAccess(request, reply, orgId)
        if (!access) return
        const db = getFirestore()
        const result = await listParentRoadmaps(db, orgId)
        return { ok: true, ...result }
      } catch (e: any) {
        return reply.code(500).send({ error: e?.message || 'Failed to list roadmaps' })
      }
    }
  )

  fastify.get<{ Params: { orgId: string; roadmapId: string } }>(
    '/orgs/:orgId/parent/content/roadmaps/:roadmapId',
    {
      schema: {
        tags: ['Content'],
        summary: 'Get a content roadmap and its tasks for the authenticated parent',
        params: orgRoadmapParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'roadmap'],
            properties: { ok: { type: 'boolean' }, roadmap: contentItemSchema },
          },
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, roadmapId } = request.params
        const access = await checkParentAccess(request, reply, orgId)
        if (!access) return
        const db = getFirestore()
        try {
          const roadmap = await getParentRoadmap(db, orgId, roadmapId)
          return { ok: true, roadmap }
        } catch (e: any) {
          if (e.statusCode === 404) return reply.code(404).send({ error: e.message })
          throw e
        }
      } catch (e: any) {
        return reply.code(500).send({ error: e?.message || 'Failed to get roadmap' })
      }
    }
  )

  fastify.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId/parent/content/tasks',
    {
      schema: {
        tags: ['Content'],
        summary: 'List content tasks visible to the authenticated parent',
        params: orgIdParamsSchema,
        querystring: {
          type: 'object',
          properties: { ids: { type: 'string', description: 'Comma-separated task IDs' } },
        },
        response: {
          200: {
            type: 'object',
            required: ['ok', 'tasks', 'count'],
            properties: {
              ok: { type: 'boolean' },
              tasks: { type: 'array', items: contentItemSchema },
              count: { type: 'integer' },
            },
          },
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId } = request.params
        const access = await checkParentAccess(request, reply, orgId)
        if (!access) return
        const db = getFirestore()
        const { ids } = request.query as { ids?: string }
        const result = await listParentTasks(db, orgId, ids)
        return { ok: true, ...result }
      } catch (e: any) {
        return reply.code(500).send({ error: e?.message || 'Failed to list tasks' })
      }
    }
  )

  fastify.get<{ Params: { orgId: string; taskId: string } }>(
    '/orgs/:orgId/parent/content/tasks/:taskId',
    {
      schema: {
        tags: ['Content'],
        summary: 'Get a single content task for the authenticated parent',
        params: orgTaskParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'task'],
            properties: { ok: { type: 'boolean' }, task: contentItemSchema },
          },
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, taskId } = request.params
        const access = await checkParentAccess(request, reply, orgId)
        if (!access) return
        const db = getFirestore()
        try {
          const task = await getParentTask(db, orgId, taskId)
          return { ok: true, task }
        } catch (e: any) {
          if (e.statusCode === 404) return reply.code(404).send({ error: e.message })
          throw e
        }
      } catch (e: any) {
        return reply.code(500).send({ error: e?.message || 'Failed to get task' })
      }
    }
  )

  fastify.post<{ Params: { orgId: string; taskId: string } }>(
    '/orgs/:orgId/parent/content/tasks/:taskId/complete',
    {
      schema: {
        tags: ['Content'],
        summary: "Set the authenticated parent's completion status for a content task",
        params: orgTaskParamsSchema,
        body: {
          type: 'object',
          properties: {
            completed: { type: 'boolean' },
            childId: { type: 'string' },
            roadmapId: { type: 'string' },
          },
          additionalProperties: true,
        },
        response: {
          200: {
            type: 'object',
            required: ['ok', 'message'],
            properties: { ok: { type: 'boolean' }, message: { type: 'string' } },
          },
          401: errorResponseSchema,
          404: {
            type: 'object',
            required: ['ok', 'error'],
            properties: { ok: { type: 'boolean' }, error: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, taskId } = request.params
        const access = await checkParentAccess(request, reply, orgId)
        if (!access) return
        if (!request.user) return
        const db = getFirestore()
        const body =
          (request.body as { completed?: boolean; childId?: string; roadmapId?: string }) || {}
        const completed = body.completed !== false
        const childId = body.childId || access.childIds[0] || request.user.uid
        const roadmapId = body.roadmapId
        try {
          await completeParentTask(
            db,
            orgId,
            taskId,
            access.parentUid,
            childId,
            completed,
            roadmapId
          )
          return { ok: true, message: 'Task completion status updated' }
        } catch (e: any) {
          if (e.statusCode === 404) return reply.code(404).send({ ok: false, error: e.message })
          throw e
        }
      } catch (e: any) {
        return reply.code(500).send({ error: e?.message || 'Failed to update task completion' })
      }
    }
  )

  fastify.get<{
    Params: { orgId: string }
    Querystring: { roadmapId?: string }
  }>(
    '/orgs/:orgId/parent/roadmap-assignments',
    {
      schema: {
        tags: ['Content'],
        summary: "List roadmap assignments for the authenticated parent's children",
        params: orgIdParamsSchema,
        querystring: {
          type: 'object',
          properties: { roadmapId: { type: 'string' } },
        },
        response: {
          200: {
            type: 'object',
            required: ['ok'],
            additionalProperties: true,
            properties: {
              ok: { type: 'boolean' },
              roadmapAssignments: { type: 'array', items: contentItemSchema },
            },
          },
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId } = request.params
        const filterRoadmapId = (request.query as { roadmapId?: string }).roadmapId
        const access = await checkParentAccess(request, reply, orgId)
        if (!access) return

        const db = getFirestore()
        const { childIds, parentUid } = access

        fastify.log.info(
          `[roadmap-assignments] orgId=${orgId} parentUid=${parentUid} childIds=${JSON.stringify(childIds)}`
        )

        const result = await getRoadmapAssignmentsForParent(
          db,
          orgId,
          childIds,
          parentUid,
          filterRoadmapId
        )
        return { ok: true, ...result }
      } catch (e: any) {
        return reply.code(500).send({ error: e?.message || 'Failed to list roadmap assignments' })
      }
    }
  )

  fastify.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId/parent/tasks',
    {
      schema: {
        tags: ['Content'],
        summary: "List all of the authenticated parent's children's tasks",
        params: orgIdParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'tasks', 'count'],
            properties: {
              ok: { type: 'boolean' },
              tasks: { type: 'array', items: contentItemSchema },
              count: { type: 'integer' },
            },
          },
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId } = request.params
        const access = await checkParentAccess(request, reply, orgId)
        if (!access) return
        const db = getFirestore()
        const result = await listAllParentTasks(db, orgId, access.childIds)
        return { ok: true, ...result }
      } catch (e: any) {
        return reply.code(500).send({ error: e?.message || 'Failed to list tasks' })
      }
    }
  )

  fastify.get<{ Params: { orgId: string; childId: string } }>(
    '/orgs/:orgId/parent/children/:childId/tasks',
    {
      schema: {
        tags: ['Content'],
        summary: "List a specific child's tasks",
        params: orgChildParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'tasks', 'count'],
            properties: {
              ok: { type: 'boolean' },
              tasks: { type: 'array', items: contentItemSchema },
              count: { type: 'integer' },
            },
          },
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, childId } = request.params
        const access = await checkParentAccess(request, reply, orgId)
        if (!access) return

        if (!access.childIds.includes(childId)) {
          return reply.code(403).send({ error: 'Child does not belong to you' })
        }

        const db = getFirestore()
        const result = await listParentChildTasks(db, orgId, childId)
        return { ok: true, ...result }
      } catch (e: any) {
        return reply.code(500).send({ error: e?.message || 'Failed to list child tasks' })
      }
    }
  )

  fastify.patch<{ Params: { orgId: string; childId: string; taskId: string } }>(
    '/orgs/:orgId/parent/children/:childId/tasks/:taskId',
    {
      schema: {
        tags: ['Content'],
        summary: "Mark a child's task completed or pending",
        params: orgChildTaskParamsSchema,
        body: {
          type: 'object',
          properties: { completed: { type: 'boolean' } },
          additionalProperties: true,
        },
        response: {
          200: {
            type: 'object',
            required: ['ok', 'status'],
            properties: { ok: { type: 'boolean' }, status: { type: 'string' } },
          },
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, childId, taskId } = request.params
        const access = await checkParentAccess(request, reply, orgId)
        if (!access) return

        if (!access.childIds.includes(childId)) {
          return reply.code(403).send({ error: 'Child does not belong to you' })
        }

        const db = getFirestore()
        const body = (request.body as { completed?: boolean }) || {}
        const completed = body.completed !== false

        try {
          const status = await updateParentChildTask(db, childId, taskId, completed)
          return { ok: true, status }
        } catch (e: any) {
          if (e.statusCode === 404) return reply.code(404).send({ error: e.message })
          throw e
        }
      } catch (e: any) {
        return reply.code(500).send({ error: e?.message || 'Failed to update task' })
      }
    }
  )

  fastify.get<{ Params: { orgId: string; childId: string } }>(
    '/orgs/:orgId/parent/children/:childId/roadmap-assignments',
    {
      schema: {
        tags: ['Content'],
        summary: "List a specific child's roadmap assignments",
        params: orgChildParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'roadmapAssignments'],
            properties: {
              ok: { type: 'boolean' },
              roadmapAssignments: { type: 'array', items: contentItemSchema },
            },
          },
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, childId } = request.params
        const access = await checkParentAccess(request, reply, orgId)
        if (!access) return

        if (!access.childIds.includes(childId)) {
          return reply.code(403).send({ error: 'Child does not belong to you' })
        }

        const db = getFirestore()
        const roadmapAssignments = await getChildRoadmapAssignments(db, orgId, childId)
        return { ok: true, roadmapAssignments }
      } catch (e: any) {
        return reply.code(500).send({ error: e?.message || 'Failed to list roadmap assignments' })
      }
    }
  )

  fastify.patch<{ Params: { orgId: string; childId: string; taskId: string } }>(
    '/orgs/:orgId/parent/children/:childId/tasks/:taskId/submit',
    {
      schema: {
        tags: ['Content'],
        summary: "Submit a child's homework for a task",
        params: orgChildTaskParamsSchema,
        body: {
          type: 'object',
          properties: {
            submissionText: { type: 'string' },
            fileUrl: { type: 'string' },
          },
          additionalProperties: true,
        },
        response: {
          200: {
            type: 'object',
            required: ['ok', 'taskId', 'submittedAt'],
            properties: {
              ok: { type: 'boolean' },
              taskId: { type: 'string' },
              submittedAt: { type: 'string', format: 'date-time' },
            },
          },
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, childId, taskId } = request.params
        const access = await checkParentAccess(request, reply, orgId)
        if (!access) return

        if (!access.childIds.includes(childId)) {
          return reply.code(403).send({ error: 'Child does not belong to you' })
        }

        const db = getFirestore()
        const body = (request.body as { submissionText?: string; fileUrl?: string }) || {}

        try {
          const now = await submitParentChildTask(
            db,
            childId,
            taskId,
            body.submissionText,
            body.fileUrl
          )
          return { ok: true, taskId, submittedAt: now.toDate().toISOString() }
        } catch (e: any) {
          if (e.statusCode === 404) return reply.code(404).send({ error: e.message })
          throw e
        }
      } catch (e: any) {
        return reply.code(500).send({ error: e?.message || 'Failed to submit homework' })
      }
    }
  )
}

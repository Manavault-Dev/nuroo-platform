import { z } from 'zod'
import admin from 'firebase-admin'

import { getFirestore } from '../../infrastructure/database/firebase.js'
import { requireOrgMember } from '../../infrastructure/auth/rbac.js'
import { checkOrgHasFeature } from '../payments/planLimits.js'
import {
  COLLECTIONS,
  verifyGroupOwnership,
  fetchAllOrgGroups,
  fetchAssignmentHistory,
  assignTasksToGroup,
  getAssignmentDetail,
  deleteAssignment,
  getAssignmentComments,
  addComment,
  reviewSubmission,
} from './groups.service.js'

const addCommentSchema = z.object({
  text: z.string().min(1).max(2000),
})

const reviewSubmissionSchema = z.object({
  grade: z.enum(['approved', 'needs_revision']),
  feedback: z.string().max(2000).optional(),
})

const updateAssignmentSchema = z.object({
  status: z.enum(['active', 'closed']).optional(),
  dueDate: z.string().nullable().optional(),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).nullable().optional(),
})

const assignGroupTasksSchema = z.object({
  contentTaskIds: z.array(z.string().min(1)).max(50).default([]),
  contentRoadmapIds: z.array(z.string().min(1)).max(20).default([]),
  dueDate: z.string().nullable().optional(),
})

function adminTimestamp(date: Date) {
  return admin.firestore.Timestamp.fromDate(date)
}

const orgGroupParamsSchema = {
  type: 'object',
  required: ['orgId', 'groupId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    groupId: { type: 'string', description: 'Group ID' },
  },
} as const

const assignmentParamsSchema = {
  type: 'object',
  required: ['orgId', 'groupId', 'assignmentId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    groupId: { type: 'string', description: 'Group ID' },
    assignmentId: { type: 'string', description: 'Assignment ID' },
  },
} as const

const submissionParamsSchema = {
  type: 'object',
  required: ['orgId', 'groupId', 'assignmentId', 'childId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    groupId: { type: 'string', description: 'Group ID' },
    assignmentId: { type: 'string', description: 'Assignment ID' },
    childId: { type: 'string', description: 'Child ID' },
  },
} as const

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' }, details: {} },
  additionalProperties: true,
} as const

const assignmentHistoryItemSchema = {
  type: 'object',
  required: ['id', 'groupId', 'title', 'taskTitles', 'childCount', 'tasksCreated'],
  properties: {
    id: { type: 'string' },
    groupId: { type: 'string' },
    groupName: { type: 'string' },
    title: { type: 'string' },
    taskTitles: { type: 'array', items: { type: 'string' } },
    contentTaskIds: { type: 'array', items: { type: 'string' } },
    contentRoadmapIds: { type: 'array', items: { type: 'string' } },
    roadmapNames: { type: 'array', items: { type: 'string' } },
    childCount: { type: 'number' },
    tasksCreated: { type: 'number' },
    assignedBy: { type: 'string' },
    assignedAt: { type: ['string', 'null'] },
  },
} as const

const assignmentHistoryResponseSchema = {
  type: 'object',
  required: ['ok', 'assignments', 'count'],
  properties: {
    ok: { type: 'boolean' },
    assignments: { type: 'array', items: assignmentHistoryItemSchema },
    count: { type: 'number' },
  },
} as const

const assignGroupTasksBodySchema = {
  type: 'object',
  properties: {
    contentTaskIds: { type: 'array', items: { type: 'string' }, maxItems: 50 },
    contentRoadmapIds: { type: 'array', items: { type: 'string' }, maxItems: 20 },
    dueDate: { type: ['string', 'null'] },
  },
  additionalProperties: true,
} as const

const assignGroupTasksResponseSchema = {
  type: 'object',
  required: ['ok', 'tasksCreated', 'childCount', 'taskCount', 'message'],
  properties: {
    ok: { type: 'boolean' },
    tasksCreated: { type: 'number' },
    childCount: { type: 'number' },
    taskCount: { type: 'number' },
    message: { type: 'string' },
  },
} as const

const submissionTaskSchema = {
  type: 'object',
  required: ['taskId', 'title'],
  properties: {
    taskId: { type: 'string' },
    title: { type: 'string' },
    submissionText: { type: ['string', 'null'] },
    fileUrl: { type: ['string', 'null'] },
    submittedAt: { type: ['string', 'null'] },
  },
} as const

const submissionSchema = {
  type: 'object',
  required: ['childId', 'childName', 'tasks', 'status'],
  properties: {
    childId: { type: 'string' },
    childName: { type: 'string' },
    age: {},
    tasks: { type: 'array', items: submissionTaskSchema },
    status: { type: 'string', enum: ['pending', 'submitted', 'graded'] },
    submittedAt: { type: ['string', 'null'] },
    grade: { type: ['string', 'null'] },
    feedback: { type: ['string', 'null'] },
    feedbackAt: { type: ['string', 'null'] },
  },
} as const

const assignmentRoadmapSchema = {
  type: 'object',
  required: ['id', 'name', 'taskTitles', 'taskIds'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    taskTitles: { type: 'array', items: { type: 'string' } },
    taskIds: { type: 'array', items: { type: 'string' } },
  },
} as const

const assignmentDetailResponseSchema = {
  type: 'object',
  required: ['ok', 'assignment'],
  properties: {
    ok: { type: 'boolean' },
    assignment: {
      type: 'object',
      required: ['id', 'groupId', 'ownerId', 'title', 'childCount', 'status', 'submissions'],
      properties: {
        id: { type: 'string' },
        groupId: { type: 'string' },
        groupName: { type: 'string' },
        ownerId: { type: 'string' },
        title: { type: 'string' },
        description: { type: ['string', 'null'] },
        // Not normalized to ISO string by the handler — may be a raw Firestore
        // Timestamp object, so no strict type here to avoid stripping/mis-serializing it.
        dueDate: {},
        taskTitles: { type: 'array', items: { type: 'string' } },
        contentTaskIds: { type: 'array', items: { type: 'string' } },
        contentRoadmapIds: { type: 'array', items: { type: 'string' } },
        roadmapNames: { type: 'array', items: { type: 'string' } },
        roadmaps: { type: 'array', items: assignmentRoadmapSchema },
        childCount: { type: 'number' },
        status: { type: 'string' },
        assignedAt: { type: ['string', 'null'] },
        submissions: { type: 'array', items: submissionSchema },
      },
    },
  },
} as const

const updateAssignmentBodySchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['active', 'closed'] },
    dueDate: { type: ['string', 'null'] },
    title: { type: 'string', minLength: 1, maxLength: 500 },
    description: { type: ['string', 'null'], maxLength: 2000 },
  },
  additionalProperties: true,
} as const

const okResponseSchema = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
} as const

const commentItemSchema = {
  type: 'object',
  required: ['id', 'authorId', 'authorName', 'authorRole', 'text'],
  properties: {
    id: { type: 'string' },
    authorId: { type: 'string' },
    authorName: { type: 'string' },
    authorRole: { type: 'string' },
    text: { type: 'string' },
    createdAt: { type: ['string', 'null'] },
  },
} as const

const commentsResponseSchema = {
  type: 'object',
  required: ['ok', 'comments'],
  properties: {
    ok: { type: 'boolean' },
    comments: { type: 'array', items: commentItemSchema },
  },
} as const

const addCommentBodySchema = {
  type: 'object',
  required: ['text'],
  properties: {
    text: { type: 'string', minLength: 1, maxLength: 2000 },
  },
  additionalProperties: true,
} as const

const addCommentResponseSchema = {
  type: 'object',
  required: ['ok', 'comment'],
  properties: {
    ok: { type: 'boolean' },
    comment: {
      type: 'object',
      required: ['id', 'authorId', 'authorName', 'authorRole', 'text', 'createdAt'],
      properties: {
        id: { type: 'string' },
        authorId: { type: 'string' },
        authorName: { type: 'string' },
        authorRole: { type: 'string' },
        text: { type: 'string' },
        createdAt: { type: 'string' },
      },
    },
  },
} as const

const reviewSubmissionBodySchema = {
  type: 'object',
  required: ['grade'],
  properties: {
    grade: { type: 'string', enum: ['approved', 'needs_revision'] },
    feedback: { type: 'string', maxLength: 2000 },
  },
  additionalProperties: true,
} as const

const reviewSubmissionResponseSchema = {
  type: 'object',
  required: ['ok', 'childId', 'grade'],
  properties: {
    ok: { type: 'boolean' },
    childId: { type: 'string' },
    grade: { type: 'string', enum: ['approved', 'needs_revision'] },
  },
} as const

async function resolveGroupForAssignment(
  db: admin.firestore.Firestore,
  orgId: string,
  groupId: string,
  ownerId: string,
  canSearchOrgGroups: boolean
) {
  const directSnap = await db.doc(`${COLLECTIONS.SPECIALIST_GROUPS(ownerId)}/${groupId}`).get()
  if (directSnap.exists) return { ownerId, groupSnap: directSnap }

  if (!canSearchOrgGroups) return null

  const groups = await fetchAllOrgGroups(db, orgId)
  const match = groups.find(({ doc }) => doc.id === groupId)
  if (!match) return null

  return { ownerId: match.ownerId, groupSnap: match.doc }
}

export const groupAssignmentsRoute: import('fastify').FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Params: { orgId: string; groupId: string }
    Querystring: { ownerId?: string }
  }>(
    '/orgs/:orgId/groups/:groupId/assignments',
    {
      schema: {
        tags: ['Groups'],
        summary: 'List assignment history for a group',
        params: orgGroupParamsSchema,
        querystring: {
          type: 'object',
          properties: { ownerId: { type: 'string' } },
        },
        response: {
          200: assignmentHistoryResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, groupId } = request.params
        // Only verify org membership — any member can read all group assignments.
        // ownerId filtering was removed: it caused specialists to see zero
        // assignments when those assignments were created by an org admin.
        await requireOrgMember(request, reply, orgId)

        const db = getFirestore()
        const assignments = await fetchAssignmentHistory(db, orgId, groupId)
        return { ok: true, assignments, count: assignments.length }
      } catch (error: any) {
        fastify.log.error({ err: error }, 'Route handler failed')
        return reply
          .code(500)
          .send({ error: 'Failed to fetch assignment history', details: error.message })
      }
    }
  )

  fastify.post<{
    Params: { orgId: string; groupId: string }
    Querystring: { ownerId?: string }
    Body: z.infer<typeof assignGroupTasksSchema>
  }>(
    '/orgs/:orgId/groups/:groupId/assign',
    {
      schema: {
        tags: ['Groups'],
        summary: 'Assign content tasks/roadmaps to every child in a group',
        params: orgGroupParamsSchema,
        querystring: {
          type: 'object',
          properties: { ownerId: { type: 'string' } },
        },
        body: assignGroupTasksBodySchema,
        response: {
          200: assignGroupTasksResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, groupId } = request.params
        const member = await requireOrgMember(request, reply, orgId)
        if (reply.sent) return

        const featureCheck = await checkOrgHasFeature(orgId, 'assignmentsProgress')
        if (!featureCheck.ok) {
          return reply.code(403).send({ error: featureCheck.error, upgradeRequired: true })
        }

        const { uid } = request.user!
        const ownerId =
          member.role === 'org_admin' && (request.query as any)?.ownerId
            ? (request.query as any).ownerId
            : uid
        const body = assignGroupTasksSchema.parse(request.body)

        const db = getFirestore()

        const resolvedGroup = await resolveGroupForAssignment(
          db,
          orgId,
          groupId,
          ownerId,
          member.role === 'org_admin'
        )
        if (!resolvedGroup) return reply.code(404).send({ error: 'Group not found' })

        const { ownerId: resolvedOwnerId, groupSnap } = resolvedGroup
        if (!verifyGroupOwnership(groupSnap.data()!, orgId)) {
          return reply.code(403).send({ error: 'Group does not belong to this organization' })
        }

        if (body.contentTaskIds.length === 0 && body.contentRoadmapIds.length === 0) {
          return reply.code(400).send({ error: 'At least one task or roadmap must be selected' })
        }

        try {
          const result = await assignTasksToGroup(db, orgId, groupId, resolvedOwnerId, uid, {
            contentTaskIds: body.contentTaskIds,
            contentRoadmapIds: body.contentRoadmapIds,
            dueDate: body.dueDate,
          })
          return {
            ok: true,
            ...result,
            message: `${result.taskCount} task(s) assigned to ${result.childCount} children`,
          }
        } catch (err: any) {
          if (err.statusCode === 400) {
            return reply.code(400).send({ error: err.message })
          }
          throw err
        }
      } catch (error: any) {
        fastify.log.error({ err: error }, 'Route handler failed')
        return reply
          .code(500)
          .send({ error: 'Failed to assign group tasks', details: error.message })
      }
    }
  )

  fastify.get<{
    Params: { orgId: string; groupId: string; assignmentId: string }
    Querystring: { ownerId?: string }
  }>(
    '/orgs/:orgId/groups/:groupId/assignments/:assignmentId',
    {
      schema: {
        tags: ['Groups'],
        summary: 'Get an assignment with per-child submission status',
        params: assignmentParamsSchema,
        querystring: {
          type: 'object',
          properties: { ownerId: { type: 'string' } },
        },
        response: {
          200: assignmentDetailResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, assignmentId } = request.params
        const member = await requireOrgMember(request, reply, orgId)
        const { uid } = request.user!
        const db = getFirestore()

        try {
          const { aData, childIds, submissions, contentRoadmapIds, roadmaps } =
            await getAssignmentDetail(db, orgId, assignmentId)

          if (member.role === 'specialist' && aData.ownerId !== uid) {
            return reply.code(403).send({ error: 'You can only view your own assignments' })
          }

          return {
            ok: true,
            assignment: {
              id: assignmentId,
              groupId: aData.groupId,
              groupName: aData.groupName,
              ownerId: aData.ownerId,
              title: aData.title || (aData.taskTitles?.[0] ?? 'Задание'),
              description: aData.description ?? null,
              dueDate: aData.dueDate ?? null,
              taskTitles: aData.taskTitles || [],
              contentTaskIds: aData.contentTaskIds || [],
              contentRoadmapIds,
              roadmapNames: aData.roadmapNames || [],
              roadmaps,
              childCount: aData.childCount || childIds.length,
              status: aData.status || 'active',
              assignedAt: aData.assignedAt?.toDate?.()?.toISOString() ?? null,
              submissions,
            },
          }
        } catch (err: any) {
          if (err.statusCode === 404) {
            return reply.code(404).send({ error: 'Assignment not found' })
          }
          throw err
        }
      } catch (error: any) {
        fastify.log.error({ err: error }, 'Route handler failed')
        return reply
          .code(500)
          .send({ error: 'Failed to fetch assignment detail', details: error.message })
      }
    }
  )

  fastify.patch<{
    Params: { orgId: string; groupId: string; assignmentId: string }
    Body: z.infer<typeof updateAssignmentSchema>
  }>(
    '/orgs/:orgId/groups/:groupId/assignments/:assignmentId',
    {
      schema: {
        tags: ['Groups'],
        summary: 'Update an assignment (status, due date, title, description)',
        params: assignmentParamsSchema,
        body: updateAssignmentBodySchema,
        response: {
          200: okResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, assignmentId } = request.params
        const member = await requireOrgMember(request, reply, orgId)
        const { uid } = request.user!
        const body = updateAssignmentSchema.parse(request.body)
        const db = getFirestore()

        const assignmentRef = db.doc(`organizations/${orgId}/groupAssignments/${assignmentId}`)
        const assignmentSnap = await assignmentRef.get()
        if (!assignmentSnap.exists) return reply.code(404).send({ error: 'Assignment not found' })

        const aData = assignmentSnap.data()!
        if (member.role === 'specialist' && aData.ownerId !== uid) {
          return reply.code(403).send({ error: 'You can only update your own assignments' })
        }

        const updates: Record<string, any> = {
          updatedAt: adminTimestamp(new Date()),
        }
        if (body.status) updates.status = body.status
        if (body.dueDate !== undefined) updates.dueDate = body.dueDate
        if (body.title) updates.title = body.title
        if (body.description !== undefined) updates.description = body.description

        await assignmentRef.update(updates)
        return { ok: true }
      } catch (error: any) {
        return reply
          .code(500)
          .send({ error: 'Failed to update assignment', details: error.message })
      }
    }
  )

  fastify.delete<{ Params: { orgId: string; groupId: string; assignmentId: string } }>(
    '/orgs/:orgId/groups/:groupId/assignments/:assignmentId',
    {
      schema: {
        tags: ['Groups'],
        summary: 'Delete an assignment and its generated child tasks',
        params: assignmentParamsSchema,
        response: {
          200: okResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, assignmentId } = request.params
        const member = await requireOrgMember(request, reply, orgId)
        const { uid } = request.user!
        const db = getFirestore()

        const assignmentRef = db.doc(`organizations/${orgId}/groupAssignments/${assignmentId}`)
        const assignmentSnap = await assignmentRef.get()
        if (!assignmentSnap.exists) return reply.code(404).send({ error: 'Assignment not found' })

        const aData = assignmentSnap.data()!
        if (member.role === 'specialist' && aData.ownerId !== uid) {
          return reply.code(403).send({ error: 'You can only delete your own assignments' })
        }

        await deleteAssignment(db, orgId, assignmentId, aData.childIds || [])
        return { ok: true }
      } catch (error: any) {
        return reply
          .code(500)
          .send({ error: 'Failed to delete assignment', details: error.message })
      }
    }
  )

  fastify.get<{ Params: { orgId: string; groupId: string; assignmentId: string } }>(
    '/orgs/:orgId/groups/:groupId/assignments/:assignmentId/comments',
    {
      schema: {
        tags: ['Groups'],
        summary: 'List comments on an assignment',
        params: assignmentParamsSchema,
        response: {
          200: commentsResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, assignmentId } = request.params
        await requireOrgMember(request, reply, orgId)
        const db = getFirestore()
        const comments = await getAssignmentComments(db, orgId, assignmentId)
        return { ok: true, comments }
      } catch (error: any) {
        return reply.code(500).send({ error: 'Failed to fetch comments', details: error.message })
      }
    }
  )

  fastify.post<{
    Params: { orgId: string; groupId: string; assignmentId: string }
    Body: z.infer<typeof addCommentSchema>
  }>(
    '/orgs/:orgId/groups/:groupId/assignments/:assignmentId/comments',
    {
      schema: {
        tags: ['Groups'],
        summary: 'Add a comment to an assignment',
        params: assignmentParamsSchema,
        body: addCommentBodySchema,
        response: {
          200: addCommentResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, assignmentId } = request.params
        const member = await requireOrgMember(request, reply, orgId)
        const { uid } = request.user!
        const body = addCommentSchema.parse(request.body)
        const db = getFirestore()

        const { id, authorName, now } = await addComment(
          db,
          orgId,
          assignmentId,
          uid,
          member.role,
          body.text
        )

        return {
          ok: true,
          comment: {
            id,
            authorId: uid,
            authorName,
            authorRole: member.role,
            text: body.text,
            createdAt: now.toDate().toISOString(),
          },
        }
      } catch (error: any) {
        return reply.code(500).send({ error: 'Failed to add comment', details: error.message })
      }
    }
  )

  fastify.patch<{
    Params: { orgId: string; groupId: string; assignmentId: string; childId: string }
    Body: z.infer<typeof reviewSubmissionSchema>
  }>(
    '/orgs/:orgId/groups/:groupId/assignments/:assignmentId/submissions/:childId',
    {
      schema: {
        tags: ['Groups'],
        summary: "Grade a child's submission for an assignment",
        params: submissionParamsSchema,
        body: reviewSubmissionBodySchema,
        response: {
          200: reviewSubmissionResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, assignmentId, childId } = request.params
        const member = await requireOrgMember(request, reply, orgId)
        const { uid } = request.user!
        const body = reviewSubmissionSchema.parse(request.body)
        const db = getFirestore()

        const assignmentSnap = await db
          .doc(`organizations/${orgId}/groupAssignments/${assignmentId}`)
          .get()
        if (!assignmentSnap.exists) return reply.code(404).send({ error: 'Assignment not found' })
        const aData = assignmentSnap.data()!
        if (member.role === 'specialist' && aData.ownerId !== uid) {
          return reply
            .code(403)
            .send({ error: 'You can only review submissions for your own assignments' })
        }

        try {
          await reviewSubmission(db, orgId, assignmentId, childId, uid, body.grade, body.feedback)
          return { ok: true, childId, grade: body.grade }
        } catch (err: any) {
          if (err.statusCode === 404) {
            return reply.code(404).send({ error: err.message })
          }
          throw err
        }
      } catch (error: any) {
        return reply
          .code(500)
          .send({ error: 'Failed to review submission', details: error.message })
      }
    }
  )
}

import admin from 'firebase-admin'

import { getFirestore } from '../../infrastructure/database/firebase.js'
import { requireOrgMember, requireChildAccess } from '../../infrastructure/auth/rbac.js'
import type { TimelineResponse } from '../../shared/types/domain.js'
import {
  parseTimelineDays,
  buildActivityMap,
  buildFeedbackMap,
  buildTimelineDays,
  COLLECTIONS,
} from './children.service.js'

const orgIdChildIdParamsSchema = {
  type: 'object',
  required: ['orgId', 'childId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    childId: { type: 'string', description: 'Child ID' },
  },
} as const

const timelineQuerystringSchema = {
  type: 'object',
  properties: {
    days: { type: 'string', description: 'Number of days to look back (7-90, default 30)' },
  },
  additionalProperties: true,
} as const

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' } },
  additionalProperties: true,
} as const

const activityDaySchema = {
  type: 'object',
  required: ['date', 'tasksAttempted', 'tasksCompleted'],
  properties: {
    date: { type: 'string' },
    tasksAttempted: { type: 'number' },
    tasksCompleted: { type: 'number' },
    feedback: {
      type: 'object',
      required: ['mood', 'timestamp'],
      properties: {
        mood: { type: 'string', enum: ['good', 'ok', 'hard'] },
        comment: { type: 'string' },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const

export const childrenTimelineRoute: import('fastify').FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Params: { orgId: string; childId: string }
    Querystring: { days?: string }
  }>(
    '/orgs/:orgId/children/:childId/timeline',
    {
      schema: {
        tags: ['Children'],
        summary: "Get a child's activity timeline",
        params: orgIdChildIdParamsSchema,
        querystring: timelineQuerystringSchema,
        response: {
          200: {
            type: 'object',
            required: ['days'],
            properties: { days: { type: 'array', items: activityDaySchema } },
          },
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, childId } = request.params
        const days = parseTimelineDays(request.query.days)

        await requireOrgMember(request, reply, orgId)
        const resolvedChildId = await requireChildAccess(request, reply, orgId, childId)

        const db = getFirestore()
        const now = new Date()
        const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
        const startTimestamp = admin.firestore.Timestamp.fromDate(startDate)

        const tasksRef = db.collection(COLLECTIONS.CHILD_TASKS(resolvedChildId))
        const tasksSnapshot = await tasksRef
          .where('updatedAt', '>=', startTimestamp)
          .orderBy('updatedAt', 'desc')
          .get()

        const feedbackRef = db.collection(COLLECTIONS.CHILD_FEEDBACK(resolvedChildId))
        const feedbackSnapshot = await feedbackRef.where('timestamp', '>=', startTimestamp).get()

        const activityMap = buildActivityMap(tasksSnapshot.docs)
        const feedbackMap = buildFeedbackMap(feedbackSnapshot.docs)
        const timelineDaysData = buildTimelineDays(days, activityMap, feedbackMap)

        const response: TimelineResponse = { days: timelineDaysData }
        return response
      } catch (error: unknown) {
        fastify.log.error({ err: error }, 'Route handler failed')
        return reply.code(500).send({
          error: 'Failed to fetch timeline',
          details: error instanceof Error ? error.message : '',
        })
      }
    }
  )
}

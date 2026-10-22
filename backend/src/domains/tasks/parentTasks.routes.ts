import { FastifyPluginAsync } from 'fastify'
import admin from 'firebase-admin'
import { z } from 'zod'

import { getFirestore } from '../../infrastructure/database/firebase.js'
import { dispatch } from '../../modules/notifications/index.js'
import { createFeedItem } from '../activity/activity.service.js'

const COLLECTIONS = {
  CHILDREN: 'children',
  CHILD_TASKS: (childId: string) => `children/${childId}/tasks`,
  ORG_CHILDREN: (orgId: string) => `organizations/${orgId}/children`,
  ORG_MONTHLY_FEES: (orgId: string) => `organizations/${orgId}/monthlyFees`,
} as const

function currentMonthStr(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

async function getParentName(db: admin.firestore.Firestore, uid: string): Promise<string> {
  const userSnap = await db.doc(`users/${uid}`).get()
  if (userSnap.exists) {
    const data = userSnap.data()
    return data?.displayName || data?.fullName || data?.name || 'Parent'
  }
  return 'Parent'
}

const completeBodySchema = z.object({
  completed: z.boolean(),
})

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  additionalProperties: true,
  properties: { error: { type: 'string' } },
} as const

const errorWithDetailsResponseSchema = {
  type: 'object',
  required: ['error'],
  additionalProperties: true,
  properties: { error: { type: 'string' }, details: { type: 'string' } },
} as const

const childIdParamsSchema = {
  type: 'object',
  required: ['childId'],
  properties: { childId: { type: 'string', description: 'Child ID' } },
} as const

const childTaskParamsSchema = {
  type: 'object',
  required: ['childId', 'taskId'],
  properties: {
    childId: { type: 'string', description: 'Child ID' },
    taskId: { type: 'string', description: 'Task ID' },
  },
} as const

const completeBodyJsonSchema = {
  type: 'object',
  required: ['completed'],
  properties: { completed: { type: 'boolean' } },
} as const

const submitBodyJsonSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    submissionText: { type: 'string' },
    fileUrl: { type: 'string' },
  },
} as const

const billingQuerystringSchema = {
  type: 'object',
  properties: {
    orgId: { type: 'string', description: 'Organization ID (resolved from child if omitted)' },
    month: { type: 'string', description: 'Month in YYYY-MM format (defaults to current month)' },
  },
} as const

export const parentTasksRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { childId: string } }>(
    '/api/parent/children/:childId/tasks',
    {
      schema: {
        tags: ['Tasks'],
        summary: "List a parent's view of a child's tasks",
        params: childIdParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['tasks'],
            properties: {
              tasks: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'title', 'status'],
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    description: { type: ['string', 'null'] },
                    status: { type: 'string' },
                    createdAt: { type: ['string', 'null'], format: 'date-time' },
                    updatedAt: { type: ['string', 'null'], format: 'date-time' },
                    completedAt: { type: ['string', 'null'], format: 'date-time' },
                  },
                },
              },
            },
          },
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          500: errorWithDetailsResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
        const uid = request.user.uid
        const { childId } = request.params

        const db = getFirestore()
        const childRef = db.doc(`${COLLECTIONS.CHILDREN}/${childId}`)
        const childSnap = await childRef.get()
        if (!childSnap.exists) {
          return reply.code(404).send({ error: 'Child not found' })
        }
        const orgId = childSnap.data()?.organizationId
        if (!orgId) {
          return reply.code(403).send({ error: 'Child is not linked to an organization' })
        }

        const orgChildRef = db.doc(`${COLLECTIONS.ORG_CHILDREN(orgId)}/${childId}`)
        const orgChildSnap = await orgChildRef.get()
        if (!orgChildSnap.exists || orgChildSnap.data()?.parentUserId !== uid) {
          return reply.code(403).send({ error: 'Only the parent can list this child’s tasks' })
        }

        const snapshot = await db
          .collection(COLLECTIONS.CHILD_TASKS(childId))
          .orderBy('updatedAt', 'desc')
          .get()

        const tasks = snapshot.docs.map((doc) => {
          const d = doc.data()
          return {
            id: doc.id,
            title: d.title || 'Untitled Task',
            description: d.description ?? null,
            status: d.status || 'pending',
            createdAt: d.createdAt?.toDate() ?? null,
            updatedAt: d.updatedAt?.toDate() ?? null,
            completedAt: d.completedAt?.toDate() ?? null,
          }
        })
        return { tasks }
      } catch (error: any) {
        console.error('[PARENT_TASKS] Error listing tasks:', error)
        return reply.code(500).send({
          error: 'Failed to list tasks',
          details: error.message,
        })
      }
    }
  )

  fastify.post<{
    Params: { childId: string; taskId: string }
    Body: z.infer<typeof completeBodySchema>
  }>(
    '/api/parent/children/:childId/tasks/:taskId/complete',
    {
      schema: {
        tags: ['Tasks'],
        summary: 'Mark a child task as completed or pending',
        params: childTaskParamsSchema,
        body: completeBodyJsonSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'taskId', 'status'],
            properties: {
              ok: { type: 'boolean' },
              taskId: { type: 'string' },
              status: { type: 'string', enum: ['completed', 'pending'] },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
          400: {
            type: 'object',
            required: ['error'],
            additionalProperties: true,
            properties: { error: { type: 'string' }, message: { type: 'string' } },
          },
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          500: errorWithDetailsResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        if (!request.user) {
          return reply.code(401).send({ error: 'Unauthorized' })
        }
        const uid = request.user.uid
        const { childId, taskId } = request.params

        const parse = completeBodySchema.safeParse(request.body)
        if (!parse.success) {
          return reply.code(400).send({
            error: 'Bad Request',
            message: 'Body must include { completed: boolean }',
          })
        }
        const { completed } = parse.data

        const db = getFirestore()

        const childRef = db.doc(`${COLLECTIONS.CHILDREN}/${childId}`)
        const childSnap = await childRef.get()
        if (!childSnap.exists) {
          return reply.code(404).send({ error: 'Child not found' })
        }
        const orgId = childSnap.data()?.organizationId
        if (!orgId) {
          return reply.code(403).send({ error: 'Child is not linked to an organization' })
        }

        const orgChildRef = db.doc(`${COLLECTIONS.ORG_CHILDREN(orgId)}/${childId}`)
        const orgChildSnap = await orgChildRef.get()
        if (!orgChildSnap.exists) {
          return reply.code(404).send({ error: 'Child not found in organization' })
        }
        const parentUserId = orgChildSnap.data()?.parentUserId
        if (parentUserId !== uid) {
          return reply.code(403).send({ error: 'Only the parent of this child can complete tasks' })
        }

        const taskRef = db.doc(`${COLLECTIONS.CHILD_TASKS(childId)}/${taskId}`)
        const taskSnap = await taskRef.get()
        if (!taskSnap.exists) {
          return reply.code(404).send({ error: 'Task not found' })
        }

        const now = admin.firestore.Timestamp.fromDate(new Date())
        const taskTitle = taskSnap.data()?.title || 'Task'
        const childName = childSnap.data()?.name || 'Child'

        await taskRef.update({
          status: completed ? 'completed' : 'pending',
          completedAt: completed ? now : null,
          updatedAt: now,
        })

        if (completed) {
          const specialistId = orgChildSnap.data()?.assignedSpecialistId
          try {
            await createFeedItem(db, orgId, childId, uid, 'parent', await getParentName(db, uid), {
              type: 'assignment_completed',
              title: taskTitle,
              body: `${childName} completed: ${taskTitle}`,
              visibility: 'parent_visible',
              relatedEntityType: 'assignment',
              relatedEntityId: taskId,
              unreadBy: specialistId ? [specialistId] : [],
              metadata: { taskId },
            })
          } catch (feedErr) {
            console.error('[PARENT_TASKS] Failed to write completion to activity feed:', feedErr)
          }

          if (specialistId) {
            dispatch({
              userId: specialistId,
              orgId,
              role: 'specialist',
              type: 'task_completed',
              category: 'assignments',
              title: '✅ Task completed',
              body: 'A task has been marked as completed.',
              metadata: { childId, taskId, orgId },
              dedupKey: `task_completed:${taskId}`,
              channel: 'both',
            }).catch(() => {})
          }
        }

        return {
          ok: true,
          taskId,
          status: completed ? 'completed' : 'pending',
          updatedAt: now.toDate(),
        }
      } catch (error: any) {
        console.error('[PARENT_TASKS] Error completing task:', error)
        return reply.code(500).send({
          error: 'Failed to update task',
          details: error.message,
        })
      }
    }
  )

  fastify.patch<{
    Params: { childId: string; taskId: string }
    Body: { submissionText?: string; fileUrl?: string }
  }>(
    '/api/parent/children/:childId/tasks/:taskId/submit',
    {
      schema: {
        tags: ['Tasks'],
        summary: 'Submit homework for a child task',
        params: childTaskParamsSchema,
        body: submitBodyJsonSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'taskId', 'status', 'submittedAt'],
            properties: {
              ok: { type: 'boolean' },
              taskId: { type: 'string' },
              status: { type: 'string', enum: ['submitted'] },
              submittedAt: { type: 'string', format: 'date-time' },
            },
          },
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          500: errorWithDetailsResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
        const uid = request.user.uid
        const { childId, taskId } = request.params
        const db = getFirestore()

        const childRef = db.doc(`${COLLECTIONS.CHILDREN}/${childId}`)
        const childSnap = await childRef.get()
        if (!childSnap.exists) return reply.code(404).send({ error: 'Child not found' })

        const orgId = childSnap.data()?.organizationId
        if (!orgId) return reply.code(403).send({ error: 'Child not linked to an organization' })

        const orgChildRef = db.doc(`${COLLECTIONS.ORG_CHILDREN(orgId)}/${childId}`)
        const orgChildSnap = await orgChildRef.get()
        if (!orgChildSnap.exists || orgChildSnap.data()?.parentUserId !== uid) {
          return reply
            .code(403)
            .send({ error: 'Only the parent of this child can submit homework' })
        }

        const taskRef = db.doc(`${COLLECTIONS.CHILD_TASKS(childId)}/${taskId}`)
        const taskSnap = await taskRef.get()
        if (!taskSnap.exists) return reply.code(404).send({ error: 'Task not found' })

        const body = request.body as { submissionText?: string; fileUrl?: string }
        const now = admin.firestore.Timestamp.fromDate(new Date())
        const taskTitle = taskSnap.data()?.title || 'Task'
        const childName = childSnap.data()?.name || 'Child'

        await taskRef.update({
          status: 'submitted',
          submissionText: body.submissionText ?? null,
          fileUrl: body.fileUrl ?? null,
          submittedAt: now,
          updatedAt: now,
        })

        const specialistId = orgChildSnap.data()?.assignedSpecialistId
        try {
          const submissionBody =
            body.submissionText?.trim() ||
            (body.fileUrl
              ? `${childName} submitted an attachment for: ${taskTitle}`
              : `${childName} submitted: ${taskTitle}`)
          await createFeedItem(db, orgId, childId, uid, 'parent', await getParentName(db, uid), {
            type: 'parent_comment',
            title: taskTitle,
            body: submissionBody,
            visibility: 'parent_visible',
            relatedEntityType: 'assignment',
            relatedEntityId: taskId,
            unreadBy: specialistId ? [specialistId] : [],
            metadata: { taskId, fileUrl: body.fileUrl ?? null },
          })
        } catch (feedErr) {
          console.error('[PARENT_TASKS] Failed to write submission to activity feed:', feedErr)
        }

        if (specialistId) {
          dispatch({
            userId: specialistId,
            orgId,
            role: 'specialist',
            type: 'homework_submitted',
            category: 'assignments',
            title: '📎 New submission to review',
            body: 'A new submission is ready for review.',
            metadata: { childId, taskId, orgId },
            dedupKey: `homework_submitted:${taskId}`,
            channel: 'both',
            priority: 'high',
          }).catch(() => {})
        }

        return { ok: true, taskId, status: 'submitted', submittedAt: now.toDate() }
      } catch (error: any) {
        console.error('[PARENT_TASKS] Error submitting homework:', error)
        return reply.code(500).send({ error: 'Failed to submit homework', details: error.message })
      }
    }
  )

  fastify.get<{
    Params: { childId: string }
    Querystring: { orgId?: string; month?: string }
  }>(
    '/parent/children/:childId/billing',
    {
      schema: {
        tags: ['Tasks'],
        summary: "Get a child's billing status for a given month",
        params: childIdParamsSchema,
        querystring: billingQuerystringSchema,
        response: {
          200: {
            type: 'object',
            required: [
              'ok',
              'childId',
              'orgId',
              'month',
              'billingDay',
              'dueDate',
              'daysUntilDue',
              'billingStatus',
              'amount',
              'currency',
            ],
            properties: {
              ok: { type: 'boolean' },
              childId: { type: 'string' },
              orgId: { type: 'string' },
              month: { type: 'string' },
              billingDay: { type: 'number' },
              dueDate: { type: 'string' },
              daysUntilDue: { type: 'number' },
              billingStatus: {
                type: 'string',
                enum: ['paid', 'overdue', 'due_soon', 'upcoming'],
              },
              amount: { type: 'number' },
              currency: { type: 'string' },
              paidAt: { type: ['string', 'null'] },
              note: { type: ['string', 'null'] },
            },
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          500: errorWithDetailsResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
        const uid = request.user.uid
        const { childId } = request.params
        const { orgId: qOrgId, month: qMonth } = request.query as {
          orgId?: string
          month?: string
        }

        const db = getFirestore()

        let orgId = qOrgId
        if (!orgId) {
          const childSnap = await db.doc(`${COLLECTIONS.CHILDREN}/${childId}`).get()
          orgId = childSnap.data()?.organizationId
        }
        if (!orgId) return reply.code(400).send({ error: 'orgId is required' })

        // Resolve the actual child document — parent passes their own uid as childId,
        // so we look up by parentUserId if direct lookup fails or doesn't belong to uid.
        let orgChildSnap: FirebaseFirestore.DocumentSnapshot | null = null
        let resolvedChildId = childId

        const directSnap = await db.doc(`${COLLECTIONS.ORG_CHILDREN(orgId)}/${childId}`).get()
        if (directSnap.exists && directSnap.data()?.parentUserId === uid) {
          orgChildSnap = directSnap
        } else {
          const byParent = await db
            .collection(COLLECTIONS.ORG_CHILDREN(orgId))
            .where('parentUserId', '==', uid)
            .limit(1)
            .get()
          if (!byParent.empty) {
            orgChildSnap = byParent.docs[0]
            resolvedChildId = byParent.docs[0].id
          }
        }

        if (!orgChildSnap) {
          return reply.code(403).send({ error: 'Access denied' })
        }

        const month = qMonth || currentMonthStr()
        const assignedAt: FirebaseFirestore.Timestamp | undefined = orgChildSnap.data()?.assignedAt
        const billingDay = assignedAt ? assignedAt.toDate().getDate() : 1

        const [year, mon] = month.split('-').map(Number)
        const dueDate = new Date(year, mon - 1, billingDay)
        const today = new Date()
        const daysUntilDue = Math.ceil(
          (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        )

        const feeDocId = `${month}_${resolvedChildId}`
        const feeSnap = await db.doc(`${COLLECTIONS.ORG_MONTHLY_FEES(orgId)}/${feeDocId}`).get()
        const feeData = feeSnap.exists ? feeSnap.data()! : null
        const feeStatus = feeData?.status || 'pending'

        let billingStatus: 'paid' | 'overdue' | 'due_soon' | 'upcoming'
        if (feeStatus === 'paid') {
          billingStatus = 'paid'
        } else if (daysUntilDue < 0) {
          billingStatus = 'overdue'
        } else if (daysUntilDue <= 3) {
          billingStatus = 'due_soon'
        } else {
          billingStatus = 'upcoming'
        }

        return {
          ok: true,
          childId: resolvedChildId,
          orgId,
          month,
          billingDay,
          dueDate: dueDate.toISOString().split('T')[0],
          daysUntilDue,
          billingStatus,
          amount: feeData?.amount ?? 0,
          currency: feeData?.currency || 'KGS',
          paidAt: feeData?.paidAt?.toDate?.()?.toISOString() || null,
          note: feeData?.note || null,
        }
      } catch (error: any) {
        console.error('[PARENT_TASKS] Error getting billing:', error)
        return reply
          .code(500)
          .send({ error: 'Failed to get billing status', details: error.message })
      }
    }
  )
}

import { FastifyPluginAsync } from 'fastify'
import admin from 'firebase-admin'
import { z } from 'zod'
import multipart from '@fastify/multipart'

import {
  getFirestore,
  getStorage,
  getApp,
  getAuth,
} from '../../infrastructure/database/firebase.js'

const COLLECTIONS = {
  TASKS: 'content/tasks/items',
  ROADMAPS: 'content/roadmaps/items',
  CONTENT_TASK_COMPLETIONS: 'alphakidsTaskCompletions',
  PARENT_INVITES: 'parentInvites',
  ORG_TASKS: (orgId: string) => `organizations/${orgId}/contentTasks`,
  ORG_ROADMAPS: (orgId: string) => `organizations/${orgId}/contentRoadmaps`,
} as const

async function getParentInviteDoc(
  db: admin.firestore.Firestore,
  code: string
): Promise<{ orgId: string; specialistId: string; expiresAt: Date | null } | null> {
  const normalized = code.trim().toUpperCase()
  if (!normalized) return null
  const ref = db.collection(COLLECTIONS.PARENT_INVITES).doc(normalized)
  const snap = await ref.get()
  if (!snap.exists) return null
  const data = snap.data()!
  const expiresAt = data.expiresAt?.toDate?.() ?? null
  if (expiresAt !== null && expiresAt < new Date()) return null
  return {
    orgId: data.orgId as string,
    specialistId: data.specialistId as string,
    expiresAt,
  }
}

async function resolveAccessCode(
  db: admin.firestore.Firestore,
  code: string
): Promise<
  | { valid: true; type: 'org'; orgId: string; specialistId: string; expiresAt: Date | null }
  | { valid: false }
> {
  const orgInvite = await getParentInviteDoc(db, code)
  if (orgInvite)
    return {
      valid: true,
      type: 'org',
      orgId: orgInvite.orgId,
      specialistId: orgInvite.specialistId,
      expiresAt: orgInvite.expiresAt,
    }
  return { valid: false }
}

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' }, message: { type: 'string' } },
} as const

const okFalseErrorResponseSchema = {
  type: 'object',
  required: ['ok', 'error'],
  properties: { ok: { type: 'boolean' }, error: { type: 'string' } },
} as const

const roadmapIdParamsSchema = {
  type: 'object',
  required: ['roadmapId'],
  properties: { roadmapId: { type: 'string', description: 'Content roadmap ID' } },
} as const

const taskIdParamsSchema = {
  type: 'object',
  required: ['taskId'],
  properties: { taskId: { type: 'string', description: 'Content task ID' } },
} as const

const accessCodeQuerystringSchema = {
  type: 'object',
  properties: { code: { type: 'string', description: 'Parent organization access code' } },
} as const

const contentItemSchema = {
  type: 'object',
  additionalProperties: true,
} as const

const _taskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  category: z.string().optional(),
  ageRange: z.object({ min: z.number().min(0), max: z.number().max(18) }).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  estimatedDuration: z.number().optional(),
  instructions: z.array(z.string()).optional(),
  videoUrl: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
  mediaType: z.enum(['video', 'image', 'none']).optional(),
})

const _roadmapSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  category: z.string().optional(),
  ageRange: z.object({ min: z.number().min(0), max: z.number().max(18) }).optional(),
  taskIds: z.array(z.string()).default([]),
})

function toTimestamp(date = new Date()) {
  return admin.firestore.Timestamp.fromDate(date)
}

function transformDoc(doc: admin.firestore.DocumentSnapshot) {
  const data = doc.data()
  if (!data) return { id: doc.id }

  return {
    id: doc.id,
    ...data,
    createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
  }
}

function _buildUpdateData(body: Record<string, unknown>) {
  const data: Record<string, unknown> = { updatedAt: toTimestamp() }
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) data[key] = value
  }
  return data
}

async function _getStorageBucket() {
  const storage = getStorage()
  const app = getApp()
  const projectId = app.options.projectId
  const configuredBucket = app.options.storageBucket

  const candidates = [
    configuredBucket,
    `${projectId}.firebasestorage.app`,
    `${projectId}.appspot.com`,
  ].filter(Boolean) as string[]

  for (const name of candidates) {
    try {
      const bucket = storage.bucket(name)
      const [exists] = await bucket.exists()
      if (exists) return bucket
    } catch {
      continue
    }
  }

  throw new Error('Storage bucket not found. Check FIREBASE_STORAGE_BUCKET config.')
}

export const contentRoute: FastifyPluginAsync = async (fastify) => {
  await fastify.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } })

  fastify.post(
    '/api/parent/access/validate',
    {
      schema: {
        tags: ['Content'],
        summary: 'Validate a parent organization access code',
        body: {
          type: 'object',
          properties: { code: { type: 'string', description: 'Organization access code' } },
          additionalProperties: true,
        },
        response: {
          200: {
            type: 'object',
            required: ['ok', 'type', 'orgId', 'expiresAt'],
            properties: {
              ok: { type: 'boolean' },
              type: { type: 'string', enum: ['org'] },
              orgId: { type: 'string' },
              expiresAt: { type: ['string', 'null'], format: 'date-time' },
            },
          },
          400: okFalseErrorResponseSchema,
          401: okFalseErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const db = getFirestore()
      const body = (request.body as { code?: string }) || {}
      const code = body.code?.trim()
      if (!code) {
        return reply.code(400).send({ ok: false, error: 'code is required' })
      }
      const resolved = await resolveAccessCode(db, code)
      if (!resolved.valid) {
        return reply.code(401).send({ ok: false, error: 'Invalid or expired code' })
      }
      return reply.send({
        ok: true,
        type: 'org' as const,
        orgId: resolved.orgId,
        expiresAt: resolved.expiresAt?.toISOString() ?? null,
      })
    }
  )

  fastify.post(
    '/api/parent/alphakids/validate',
    {
      schema: {
        tags: ['Content'],
        summary: 'Return a deprecation notice for the retired AlphaKids validate endpoint',
        response: {
          410: {
            type: 'object',
            required: ['ok', 'error', 'message', 'successor'],
            properties: {
              ok: { type: 'boolean' },
              error: { type: 'string' },
              message: { type: 'string' },
              successor: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      return reply.code(410).send({
        ok: false,
        error: 'Gone',
        message:
          'Use POST /api/parent/access/validate with an organization invite code. AlphaKids is now an organization.',
        successor: '/api/parent/access/validate',
      })
    }
  )

  async function _requireAccessCode(
    request: { query?: { code?: string } },
    reply: { code: (n: number) => { send: (body: unknown) => unknown } }
  ): Promise<admin.firestore.Firestore | null> {
    const db = getFirestore()
    const code = request.query?.code
    if (!code) {
      reply.code(401).send({ error: 'Access code required. Use query param: ?code=YOUR_CODE' })
      return null
    }
    const resolved = await resolveAccessCode(db, code)
    if (!resolved.valid) {
      reply.code(401).send({ error: 'Invalid or expired access code' })
      return null
    }
    return db
  }

  async function requireAccessCodeWithSource(
    request: { query?: { code?: string } },
    reply: { code: (n: number) => { send: (body: unknown) => unknown } }
  ): Promise<{ db: admin.firestore.Firestore; orgId: string } | null> {
    const db = getFirestore()
    const code = request.query?.code
    if (!code) {
      reply.code(401).send({ error: 'Access code required. Use query param: ?code=YOUR_CODE' })
      return null
    }
    const resolved = await resolveAccessCode(db, code)
    if (!resolved.valid) {
      reply.code(401).send({ error: 'Invalid or expired access code' })
      return null
    }
    return { db, orgId: resolved.orgId }
  }

  async function requireAccessCodeAndAuth(
    request: { query?: { code?: string }; headers?: { authorization?: string } },
    reply: { code: (n: number) => { send: (body: unknown) => unknown } }
  ): Promise<{
    db: admin.firestore.Firestore
    parentId: string
    orgId: string
  } | null> {
    const db = getFirestore()
    const code = request.query?.code
    if (!code) {
      reply.code(401).send({ error: 'Access code required. Use query param: ?code=YOUR_CODE' })
      return null
    }
    const resolved = await resolveAccessCode(db, code)
    if (!resolved.valid) {
      reply.code(401).send({ error: 'Invalid or expired access code' })
      return null
    }
    const authHeader = request.headers?.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Unauthorized', message: 'Bearer token required' })
      return null
    }
    try {
      const token = authHeader.substring(7)
      const decoded = await getAuth().verifyIdToken(token)
      return {
        db,
        parentId: decoded.uid,
        orgId: resolved.orgId,
      }
    } catch {
      reply.code(401).send({ error: 'Unauthorized', message: 'Invalid token' })
      return null
    }
  }

  fastify.get(
    '/api/parent/content/roadmaps',
    {
      schema: {
        tags: ['Content'],
        summary: 'List content roadmaps for the organization bound to the access code',
        querystring: accessCodeQuerystringSchema,
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
      const ctx = await requireAccessCodeWithSource(request, reply)
      if (!ctx) return
      const { db, orgId } = ctx
      const collection = db.collection(COLLECTIONS.ORG_ROADMAPS(orgId))
      const snap = await collection.orderBy('createdAt', 'desc').get()
      return { ok: true, roadmaps: snap.docs.map(transformDoc), count: snap.size }
    }
  )

  fastify.get(
    '/api/parent/content/roadmaps/:roadmapId',
    {
      schema: {
        tags: ['Content'],
        summary: 'Get a content roadmap and its tasks by ID',
        params: roadmapIdParamsSchema,
        querystring: accessCodeQuerystringSchema,
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
      const ctx = await requireAccessCodeWithSource(request, reply)
      if (!ctx) return
      const { db, orgId } = ctx
      const { roadmapId } = request.params as { roadmapId: string }
      const ref = db.doc(`${COLLECTIONS.ORG_ROADMAPS(orgId)}/${roadmapId}`)
      const snap = await ref.get()
      if (!snap.exists) return reply.code(404).send({ error: 'Roadmap not found' })
      const roadmap = transformDoc(snap) as Record<string, unknown>
      const taskIds = (roadmap.taskIds as string[] | undefined) || []
      const tasksCollection = db.collection(COLLECTIONS.ORG_TASKS(orgId))
      if (taskIds.length > 0) {
        const taskSnaps = await Promise.all(taskIds.map((id) => tasksCollection.doc(id).get()))
        const tasks = taskSnaps.filter((s) => s.exists).map((s) => transformDoc(s))
        return { ok: true, roadmap: { ...roadmap, tasks } }
      }
      return { ok: true, roadmap: { ...roadmap, tasks: [] } }
    }
  )

  fastify.get(
    '/api/parent/content/tasks',
    {
      schema: {
        tags: ['Content'],
        summary: 'List content tasks for the organization bound to the access code',
        querystring: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Parent organization access code' },
            ids: { type: 'string', description: 'Comma-separated list of task IDs to fetch' },
          },
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
      const ctx = await requireAccessCodeWithSource(request, reply)
      if (!ctx) return
      const { db, orgId } = ctx
      const tasksCollection = db.collection(COLLECTIONS.ORG_TASKS(orgId))
      const { ids } = request.query as { ids?: string }
      if (ids) {
        const taskIds = ids
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        if (taskIds.length === 0) return { ok: true, tasks: [], count: 0 }
        const taskSnaps = await Promise.all(taskIds.map((id) => tasksCollection.doc(id).get()))
        const tasks = taskSnaps.filter((s) => s.exists).map((s) => transformDoc(s))
        return { ok: true, tasks, count: tasks.length }
      }
      const snap = await tasksCollection.orderBy('createdAt', 'desc').get()
      return { ok: true, tasks: snap.docs.map(transformDoc), count: snap.size }
    }
  )

  fastify.get(
    '/api/parent/content/tasks/completed',
    {
      schema: {
        tags: ['Content'],
        summary: "List the authenticated parent's completed content tasks",
        querystring: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Parent organization access code' },
            roadmapId: { type: 'string' },
            fromDate: { type: 'string' },
            toDate: { type: 'string' },
            orgId: { type: 'string' },
            childId: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['ok', 'tasks', 'count'],
            properties: {
              ok: { type: 'boolean' },
              tasks: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['taskId', 'completed'],
                  properties: {
                    taskId: { type: 'string' },
                    childId: { type: ['string', 'null'] },
                    orgId: { type: ['string', 'null'] },
                    completed: { type: 'boolean' },
                    completedAt: { type: ['string', 'null'], format: 'date-time' },
                    roadmapId: { type: ['string', 'null'] },
                  },
                },
              },
              count: { type: 'integer' },
            },
          },
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const ctx = await requireAccessCodeAndAuth(request, reply)
      if (!ctx) return
      const { db, parentId, orgId: ctxOrgId } = ctx
      const {
        roadmapId,
        fromDate,
        toDate,
        orgId: queryOrgId,
        childId,
      } = request.query as {
        roadmapId?: string
        fromDate?: string
        toDate?: string
        orgId?: string
        childId?: string
      }
      const snap = await db
        .collection(COLLECTIONS.CONTENT_TASK_COMPLETIONS)
        .where('parentId', '==', parentId)
        .where('completed', '==', true)
        .orderBy('completedAt', 'desc')
        .limit(200)
        .get()
      let items = snap.docs.map((d) => {
        const data = d.data()
        return {
          taskId: data.taskId,
          childId: data.childId ?? null,
          orgId: data.orgId ?? null,
          completed: true,
          completedAt: data.completedAt?.toDate?.()?.toISOString() ?? null,
          roadmapId: data.roadmapId ?? null,
        }
      })
      const filterOrgId = queryOrgId ?? ctxOrgId
      if (filterOrgId) items = items.filter((i) => i.orgId === filterOrgId)
      if (childId) items = items.filter((i) => i.childId === childId)
      if (roadmapId) items = items.filter((i) => i.roadmapId === roadmapId)
      if (fromDate) {
        const from = new Date(fromDate)
        if (!isNaN(from.getTime()))
          items = items.filter((i) => i.completedAt && new Date(i.completedAt) >= from)
      }
      if (toDate) {
        const to = new Date(toDate)
        if (!isNaN(to.getTime()))
          items = items.filter((i) => i.completedAt && new Date(i.completedAt) <= to)
      }
      return { ok: true, tasks: items, count: items.length }
    }
  )

  fastify.get(
    '/api/parent/content/tasks/:taskId/complete',
    {
      schema: {
        tags: ['Content'],
        summary: "Get the authenticated parent's completion status for a content task",
        params: taskIdParamsSchema,
        querystring: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Parent organization access code' },
            childId: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['ok', 'completed', 'completedAt', 'childId'],
            properties: {
              ok: { type: 'boolean' },
              completed: { type: 'boolean' },
              completedAt: { type: ['string', 'null'], format: 'date-time' },
              childId: { type: ['string', 'null'] },
            },
          },
          401: errorResponseSchema,
          404: {
            type: 'object',
            required: ['ok', 'error', 'message'],
            properties: {
              ok: { type: 'boolean' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = await requireAccessCodeAndAuth(request, reply)
      if (!ctx) return
      const { db, parentId, orgId } = ctx
      const { taskId } = request.params as { taskId: string }
      const { childId } = request.query as { childId?: string }

      const taskRef = db.doc(`${COLLECTIONS.ORG_TASKS(orgId)}/${taskId}`)
      if (!(await taskRef.get()).exists) {
        return reply
          .code(404)
          .send({ ok: false, error: 'Not Found', message: 'Task not found or not accessible' })
      }

      const docId = childId ? `${taskId}_${parentId}_${childId}` : `${taskId}_${parentId}`
      const compRef = db.collection(COLLECTIONS.CONTENT_TASK_COMPLETIONS).doc(docId)
      const compSnap = await compRef.get()
      if (!compSnap.exists) {
        return reply.send({
          ok: true,
          completed: false,
          completedAt: null,
          childId: childId ?? null,
        })
      }
      const data = compSnap.data()!
      return reply.send({
        ok: true,
        completed: data.completed === true,
        completedAt: data.completedAt?.toDate?.()?.toISOString() ?? null,
        childId: data.childId ?? null,
      })
    }
  )

  const completeBodySchema = z.object({
    completed: z.boolean(),
    childId: z.string().optional(),
    roadmapId: z.string().optional(),
  })

  fastify.post(
    '/api/parent/content/tasks/:taskId/complete',
    {
      schema: {
        tags: ['Content'],
        summary: "Set the authenticated parent's completion status for a content task",
        params: taskIdParamsSchema,
        querystring: accessCodeQuerystringSchema,
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
          400: {
            type: 'object',
            required: ['ok', 'error', 'message'],
            properties: {
              ok: { type: 'boolean' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
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
      const ctx = await requireAccessCodeAndAuth(request, reply)
      if (!ctx) return
      const { db, parentId, orgId } = ctx
      const { taskId } = request.params as { taskId: string }
      const parseResult = completeBodySchema.safeParse(request.body)
      if (!parseResult.success) {
        return reply.code(400).send({
          ok: false,
          error: 'Bad Request',
          message: "Missing 'completed' field in request body or invalid type",
        })
      }
      const { completed, childId, roadmapId } = parseResult.data
      const taskRef = db.doc(`${COLLECTIONS.ORG_TASKS(orgId)}/${taskId}`)
      const taskSnap = await taskRef.get()
      if (!taskSnap.exists) {
        return reply
          .code(404)
          .send({ ok: false, error: 'Not Found', message: 'Task not found or not accessible' })
      }
      const docId = childId ? `${taskId}_${parentId}_${childId}` : `${taskId}_${parentId}`
      const compRef = db.collection(COLLECTIONS.CONTENT_TASK_COMPLETIONS).doc(docId)
      const now = toTimestamp()
      const update: Record<string, unknown> = {
        taskId,
        parentId,
        completed,
        updatedAt: now,
        orgId,
      }
      if (childId) update.childId = childId
      if (roadmapId) update.roadmapId = roadmapId
      if (completed) {
        update.completedAt = now
      } else {
        update.completedAt = null
      }
      const existing = await compRef.get()
      if (existing.exists) {
        await compRef.update(update)
      } else {
        await compRef.set({ ...update, createdAt: now })
      }
      return reply.send({ ok: true, message: 'Task completion status updated' })
    }
  )

  fastify.get(
    '/api/parent/content/tasks/:taskId',
    {
      schema: {
        tags: ['Content'],
        summary: 'Get a single content task by ID',
        params: taskIdParamsSchema,
        querystring: accessCodeQuerystringSchema,
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
      const ctx = await requireAccessCodeWithSource(request, reply)
      if (!ctx) return
      const { db, orgId } = ctx
      const { taskId } = request.params as { taskId: string }
      const ref = db.doc(`${COLLECTIONS.ORG_TASKS(orgId)}/${taskId}`)
      const snap = await ref.get()
      if (!snap.exists) return reply.code(404).send({ error: 'Task not found' })
      return { ok: true, task: transformDoc(snap) }
    }
  )

  fastify.post(
    '/admin/content/alphakids-codes',
    {
      schema: {
        tags: ['Content'],
        summary: 'Return a deprecation notice for the retired AlphaKids admin codes endpoint',
        response: {
          410: {
            type: 'object',
            required: ['ok', 'error', 'message'],
            properties: {
              ok: { type: 'boolean' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      return reply.code(410).send({
        ok: false,
        error: 'Gone',
        message:
          'AlphaKids is now an organization. Use parent invite codes (POST /orgs/:orgId/parent-invites) for organization access.',
      })
    }
  )

  fastify.get(
    '/admin/content/alphakids-codes',
    {
      schema: {
        tags: ['Content'],
        summary: 'Return an empty, deprecated list of AlphaKids admin codes',
        response: {
          410: {
            type: 'object',
            required: ['ok', 'error', 'message', 'codes', 'count'],
            properties: {
              ok: { type: 'boolean' },
              error: { type: 'string' },
              message: { type: 'string' },
              codes: { type: 'array', items: {} },
              count: { type: 'integer' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      return reply.code(410).send({
        ok: false,
        error: 'Gone',
        message: 'AlphaKids is now an organization. List parent invites per org instead.',
        codes: [],
        count: 0,
      })
    }
  )
}

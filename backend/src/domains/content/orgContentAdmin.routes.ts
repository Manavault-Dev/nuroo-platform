import multipart from '@fastify/multipart'
import { z } from 'zod'

import { getFirestore, getStorageBucket } from '../../infrastructure/database/firebase.js'
import { requireOrgMember } from '../../infrastructure/auth/rbac.js'
import {
  listContentTasks,
  getContentTask,
  createContentTask,
  uploadContentTask,
  updateContentTask,
  deleteContentTask,
  listContentRoadmaps,
  createContentRoadmap,
  updateContentRoadmap,
  deleteContentRoadmap,
} from './orgContent.service.js'

const orgIdParamsSchema = {
  type: 'object',
  required: ['orgId'],
  properties: { orgId: { type: 'string', description: 'Organization ID' } },
} as const

const orgTaskParamsSchema = {
  type: 'object',
  required: ['orgId', 'taskId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    taskId: { type: 'string', description: 'Content task ID' },
  },
} as const

const orgRoadmapParamsSchema = {
  type: 'object',
  required: ['orgId', 'roadmapId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    roadmapId: { type: 'string', description: 'Content roadmap ID' },
  },
} as const

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' } },
} as const

const contentItemSchema = {
  type: 'object',
  additionalProperties: true,
} as const

const taskBodySchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    category: { type: 'string' },
    ageRange: {
      type: 'object',
      properties: { min: { type: 'number' }, max: { type: 'number' } },
    },
    difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
    estimatedDuration: { type: 'number' },
    instructions: { type: 'array', items: { type: 'string' } },
    videoUrl: { type: 'string' },
    imageUrl: { type: 'string' },
    mediaType: { type: 'string', enum: ['video', 'image', 'none'] },
  },
  additionalProperties: true,
} as const

const roadmapBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    category: { type: 'string' },
    ageRange: {
      type: 'object',
      properties: { min: { type: 'number' }, max: { type: 'number' } },
    },
    taskIds: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: true,
} as const

const taskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  category: z.string().optional(),
  ageRange: z.object({ min: z.number().min(0), max: z.number().max(18) }).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  estimatedDuration: z.number().optional(),
  instructions: z.array(z.string()).optional(),
  videoUrl: z.string().url().optional().or(z.literal('')),
  imageUrl: z.string().url().optional().or(z.literal('')),
  mediaType: z.enum(['video', 'image', 'none']).optional(),
})

const roadmapSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  category: z.string().optional(),
  ageRange: z.object({ min: z.number().min(0), max: z.number().max(18) }).optional(),
  taskIds: z.array(z.string()).default([]),
})

export const orgContentAdminRoute: import('fastify').FastifyPluginAsync = async (fastify) => {
  await fastify.register(multipart, { limits: { fileSize: 500 * 1024 * 1024 } })

  fastify.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId/content/tasks',
    {
      schema: {
        tags: ['Content'],
        summary: "List an organization's content tasks",
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
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId } = request.params
        await requireOrgMember(request, reply, orgId)
        const db = getFirestore()
        const result = await listContentTasks(db, orgId)
        return { ok: true, ...result }
      } catch (e: any) {
        return reply.code(500).send({ error: e?.message || 'Failed to list tasks' })
      }
    }
  )

  fastify.get<{ Params: { orgId: string; taskId: string } }>(
    '/orgs/:orgId/content/tasks/:taskId',
    {
      schema: {
        tags: ['Content'],
        summary: 'Get a single content task by ID',
        params: orgTaskParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'task'],
            properties: { ok: { type: 'boolean' }, task: contentItemSchema },
          },
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, taskId } = request.params
        await requireOrgMember(request, reply, orgId)
        const db = getFirestore()
        try {
          const task = await getContentTask(db, orgId, taskId)
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

  fastify.post<{ Params: { orgId: string }; Body: z.infer<typeof taskSchema> }>(
    '/orgs/:orgId/content/tasks',
    {
      schema: {
        tags: ['Content'],
        summary: 'Create a content task for an organization',
        params: orgIdParamsSchema,
        body: taskBodySchema,
        response: {
          201: {
            type: 'object',
            required: ['ok', 'task'],
            properties: { ok: { type: 'boolean' }, task: contentItemSchema },
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId } = request.params
        await requireOrgMember(request, reply, orgId)
        if (!request.user) return
        const db = getFirestore()
        const body = taskSchema.parse(request.body)
        const { id, doc } = await createContentTask(db, orgId, request.user.uid, body)
        return reply.code(201).send({ ok: true, task: { id, ...doc } })
      } catch (e: any) {
        return reply.code(400).send({ error: e?.message || 'Failed to create task' })
      }
    }
  )

  fastify.post<{ Params: { orgId: string } }>(
    '/orgs/:orgId/content/tasks/upload',
    {
      schema: {
        tags: ['Content'],
        summary: 'Upload a media file and create a content task from it (multipart/form-data)',
        params: orgIdParamsSchema,
        response: {
          201: {
            type: 'object',
            required: ['ok', 'task'],
            properties: { ok: { type: 'boolean' }, task: contentItemSchema },
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId } = request.params
        await requireOrgMember(request, reply, orgId)
        if (!request.user) return
        const parts = request.parts()
        const fields: Record<string, string> = {}
        let mediaBuffer: Buffer | null = null
        let mediaMimetype = ''
        let mediaFilename = 'file'
        for await (const part of parts) {
          if (part.type === 'file' && part.fieldname === 'media') {
            const chunks: Buffer[] = []
            for await (const chunk of part.file) chunks.push(chunk)
            mediaBuffer = Buffer.concat(chunks)
            mediaMimetype = part.mimetype || ''
            mediaFilename = part.filename || 'file'
          } else if (part.type === 'field') {
            fields[part.fieldname] = (part as any).value
          }
        }
        if (!mediaBuffer || mediaBuffer.length === 0) {
          return reply.code(400).send({ error: 'Media file is required' })
        }
        const db = getFirestore()
        const bucket = await getStorageBucket()
        const { id, doc } = await uploadContentTask(
          db,
          orgId,
          request.user.uid,
          bucket,
          mediaBuffer,
          mediaMimetype,
          mediaFilename,
          fields
        )
        return reply.code(201).send({ ok: true, task: { id, ...doc } })
      } catch (e: any) {
        return reply.code(400).send({ error: e?.message || 'Upload failed' })
      }
    }
  )

  fastify.patch<{
    Params: { orgId: string; taskId: string }
    Body: Partial<z.infer<typeof taskSchema>>
  }>(
    '/orgs/:orgId/content/tasks/:taskId',
    {
      schema: {
        tags: ['Content'],
        summary: 'Update a content task',
        params: orgTaskParamsSchema,
        body: taskBodySchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'task'],
            properties: { ok: { type: 'boolean' }, task: contentItemSchema },
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, taskId } = request.params
        await requireOrgMember(request, reply, orgId)
        const db = getFirestore()
        const body = taskSchema.partial().parse(request.body)
        try {
          const task = await updateContentTask(db, orgId, taskId, body)
          return { ok: true, task }
        } catch (e: any) {
          if (e.statusCode === 404) return reply.code(404).send({ error: e.message })
          throw e
        }
      } catch (e: any) {
        return reply.code(400).send({ error: e?.message || 'Failed to update task' })
      }
    }
  )

  fastify.delete<{ Params: { orgId: string; taskId: string } }>(
    '/orgs/:orgId/content/tasks/:taskId',
    {
      schema: {
        tags: ['Content'],
        summary: 'Delete a content task',
        params: orgTaskParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok'],
            properties: { ok: { type: 'boolean' } },
          },
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, taskId } = request.params
        await requireOrgMember(request, reply, orgId)
        const db = getFirestore()
        try {
          await deleteContentTask(db, orgId, taskId)
          return { ok: true }
        } catch (e: any) {
          if (e.statusCode === 404) return reply.code(404).send({ error: e.message })
          throw e
        }
      } catch (e: any) {
        return reply.code(500).send({ error: e?.message || 'Failed to delete task' })
      }
    }
  )

  fastify.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId/content/roadmaps',
    {
      schema: {
        tags: ['Content'],
        summary: "List an organization's content roadmaps",
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
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId } = request.params
        await requireOrgMember(request, reply, orgId)
        const db = getFirestore()
        const result = await listContentRoadmaps(db, orgId)
        return { ok: true, ...result }
      } catch (e: any) {
        return reply.code(500).send({ error: e?.message || 'Failed to list roadmaps' })
      }
    }
  )

  fastify.post<{ Params: { orgId: string }; Body: z.infer<typeof roadmapSchema> }>(
    '/orgs/:orgId/content/roadmaps',
    {
      schema: {
        tags: ['Content'],
        summary: 'Create a content roadmap for an organization',
        params: orgIdParamsSchema,
        body: roadmapBodySchema,
        response: {
          201: {
            type: 'object',
            required: ['ok', 'roadmap'],
            properties: { ok: { type: 'boolean' }, roadmap: contentItemSchema },
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId } = request.params
        await requireOrgMember(request, reply, orgId)
        if (!request.user) return
        const db = getFirestore()
        const body = roadmapSchema.parse(request.body)
        const { id, doc } = await createContentRoadmap(db, orgId, request.user.uid, body)
        return reply.code(201).send({ ok: true, roadmap: { id, ...doc } })
      } catch (e: any) {
        return reply.code(400).send({ error: e?.message || 'Failed to create roadmap' })
      }
    }
  )

  fastify.patch<{
    Params: { orgId: string; roadmapId: string }
    Body: Partial<z.infer<typeof roadmapSchema>>
  }>(
    '/orgs/:orgId/content/roadmaps/:roadmapId',
    {
      schema: {
        tags: ['Content'],
        summary: 'Update a content roadmap',
        params: orgRoadmapParamsSchema,
        body: roadmapBodySchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'roadmap'],
            properties: { ok: { type: 'boolean' }, roadmap: contentItemSchema },
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, roadmapId } = request.params
        await requireOrgMember(request, reply, orgId)
        if (!request.user) return
        const db = getFirestore()
        const body = roadmapSchema.partial().parse(request.body)
        try {
          const roadmap = await updateContentRoadmap(db, orgId, roadmapId, body, request.user.uid)
          return { ok: true, roadmap }
        } catch (e: any) {
          if (e.statusCode === 404) return reply.code(404).send({ error: e.message })
          throw e
        }
      } catch (e: any) {
        return reply.code(400).send({ error: e?.message || 'Failed to update roadmap' })
      }
    }
  )

  fastify.delete<{ Params: { orgId: string; roadmapId: string } }>(
    '/orgs/:orgId/content/roadmaps/:roadmapId',
    {
      schema: {
        tags: ['Content'],
        summary: 'Delete a content roadmap',
        params: orgRoadmapParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok'],
            properties: { ok: { type: 'boolean' } },
          },
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const { orgId, roadmapId } = request.params
        await requireOrgMember(request, reply, orgId)
        const db = getFirestore()
        try {
          await deleteContentRoadmap(db, orgId, roadmapId)
          return { ok: true }
        } catch (e: any) {
          if (e.statusCode === 404) return reply.code(404).send({ error: e.message })
          throw e
        }
      } catch (e: any) {
        return reply.code(500).send({ error: e?.message || 'Failed to delete roadmap' })
      }
    }
  )
}

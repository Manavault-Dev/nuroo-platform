import type { FastifyPluginAsync } from 'fastify'
import multipart from '@fastify/multipart'
import { getFirestore, getStorageBucket } from '../../infrastructure/database/firebase.js'
import { requireOrgMember } from '../../infrastructure/auth/rbac.js'
import { checkOrgHasFeature } from '../payments/planLimits.js'
import { canManageCohort, denyNotInstructor, isInMemberBranchScope } from './cohorts.auth.js'
import type { CohortDoc, AttendanceDoc } from './cohorts.types.js'
import { RATE, COL, attendanceSchema, nowIso } from './cohorts.helpers.js'

const sessionParamsSchema = {
  type: 'object',
  required: ['orgId', 'cohortId', 'sessionId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    cohortId: { type: 'string', description: 'Cohort ID' },
    sessionId: { type: 'string', description: 'Session ID' },
  },
} as const

const cohortParamsSchema = {
  type: 'object',
  required: ['orgId', 'cohortId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    cohortId: { type: 'string', description: 'Cohort ID' },
  },
} as const

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  additionalProperties: true,
  properties: { error: { type: 'string' }, code: { type: 'string' } },
} as const

const attendanceBodySchema = {
  type: 'object',
  required: ['records'],
  additionalProperties: true,
  properties: {
    records: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['childId', 'status'],
        properties: {
          childId: { type: 'string' },
          status: { type: 'string', enum: ['present', 'absent', 'late'] },
        },
      },
    },
  },
} as const

const attendanceRecordSchema = {
  type: 'object',
  required: ['childId', 'sessionId', 'cohortId', 'status'],
  additionalProperties: true,
  properties: {
    childId: { type: 'string' },
    sessionId: { type: 'string' },
    cohortId: { type: 'string' },
    status: { type: 'string', enum: ['present', 'absent', 'late'] },
    markedAt: { type: 'string' },
    markedBy: { type: 'string' },
  },
} as const

export const cohortsAttendanceRoute: FastifyPluginAsync = async (fastify) => {
  const db = getFirestore()

  // ── POST /orgs/:orgId/cohorts/:cohortId/sessions/:sessionId/attendance ────

  fastify.post<{ Params: { orgId: string; cohortId: string; sessionId: string } }>(
    '/orgs/:orgId/cohorts/:cohortId/sessions/:sessionId/attendance',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Cohorts'],
        summary: 'Record attendance for every child in a cohort session',
        params: sessionParamsSchema,
        body: attendanceBodySchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'count'],
            properties: { ok: { type: 'boolean' }, count: { type: 'integer' } },
          },
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const member = await requireOrgMember(request, reply, request.params.orgId)
      if (reply.sent) return

      const { orgId, cohortId, sessionId } = request.params
      const cohortSnap = await db.doc(COL.cohort(orgId, cohortId)).get()
      if (!cohortSnap.exists) return reply.code(404).send({ error: 'Cohort not found' })
      if (!canManageCohort(member, cohortSnap.data() as CohortDoc)) return denyNotInstructor(reply)

      const featureCheck = await checkOrgHasFeature(orgId, 'attendance')
      if (!featureCheck.ok) {
        return reply.code(403).send({ error: featureCheck.error, upgradeRequired: true })
      }

      const body = attendanceSchema.parse(request.body)
      const now = nowIso()

      const batch = db.batch()
      for (const record of body.records) {
        const doc: AttendanceDoc = {
          childId: record.childId,
          sessionId,
          cohortId,
          status: record.status,
          markedAt: now,
          markedBy: request.user.uid,
        }
        batch.set(db.doc(`${COL.attendance(orgId, cohortId, sessionId)}/${record.childId}`), doc)
      }
      await db
        .doc(COL.session(orgId, cohortId, sessionId))
        .update({ status: 'completed', updatedAt: now })
      await batch.commit()

      return { ok: true, count: body.records.length }
    }
  )

  // ── GET /orgs/:orgId/cohorts/:cohortId/sessions/:sessionId/attendance ─────

  fastify.get<{ Params: { orgId: string; cohortId: string; sessionId: string } }>(
    '/orgs/:orgId/cohorts/:cohortId/sessions/:sessionId/attendance',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Cohorts'],
        summary: 'Get recorded attendance for a cohort session',
        params: sessionParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'attendance'],
            properties: {
              ok: { type: 'boolean' },
              attendance: { type: 'array', items: attendanceRecordSchema },
            },
          },
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const member = await requireOrgMember(request, reply, request.params.orgId)
      if (reply.sent) return

      const { orgId, cohortId, sessionId } = request.params
      const cohortSnap = await db.doc(COL.cohort(orgId, cohortId)).get()
      if (!cohortSnap.exists) return reply.code(404).send({ error: 'Cohort not found' })
      if (!isInMemberBranchScope(member, cohortSnap.data() as CohortDoc)) {
        return reply.code(403).send({ error: 'Cohort belongs to a different branch' })
      }

      const featureCheck = await checkOrgHasFeature(orgId, 'attendance')
      if (!featureCheck.ok) {
        return reply.code(403).send({ error: featureCheck.error, upgradeRequired: true })
      }

      const snap = await db.collection(COL.attendance(orgId, cohortId, sessionId)).get()
      const attendance = snap.docs.map((d) => d.data()) as AttendanceDoc[]
      return { ok: true, attendance }
    }
  )

  // ── POST /orgs/:orgId/cohorts/:cohortId/cover ─────────────────────────────

  await fastify.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } })

  fastify.post<{ Params: { orgId: string; cohortId: string } }>(
    '/orgs/:orgId/cohorts/:cohortId/cover',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Cohorts'],
        summary: 'Upload a cover image for a cohort (multipart/form-data)',
        params: cohortParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'coverUrl'],
            properties: { ok: { type: 'boolean' }, coverUrl: { type: 'string' } },
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const member = await requireOrgMember(request, reply, request.params.orgId)
      if (reply.sent) return

      const { orgId, cohortId } = request.params
      const ref = db.doc(COL.cohort(orgId, cohortId))
      const snap = await ref.get()
      if (!snap.exists) return reply.code(404).send({ error: 'Cohort not found' })
      if (!canManageCohort(member, snap.data() as CohortDoc)) return denyNotInstructor(reply)

      let imageBuffer: Buffer | null = null
      let imageMimetype = ''
      let imageFilename = 'cover'

      const parts = request.parts()
      for await (const part of parts) {
        if (part.type === 'file' && part.fieldname === 'cover') {
          const chunks: Buffer[] = []
          for await (const chunk of part.file) chunks.push(chunk)
          imageBuffer = Buffer.concat(chunks)
          imageMimetype = part.mimetype || ''
          imageFilename = part.filename || 'cover'
        }
      }

      if (!imageBuffer || imageBuffer.length === 0)
        return reply.code(400).send({ error: 'Image file is required' })
      if (!imageMimetype.startsWith('image/'))
        return reply.code(400).send({ error: 'Only image uploads are allowed' })

      const bucket = await getStorageBucket()
      const safeName = imageFilename.replace(/[^a-zA-Z0-9._-]/g, '_')
      const storagePath = `orgs/${orgId}/cohorts/${cohortId}/cover/${Date.now()}-${safeName}`
      const file = bucket.file(storagePath)

      await file.save(imageBuffer, {
        contentType: imageMimetype,
        metadata: { cacheControl: 'public, max-age=31536000' },
      })
      await file.makePublic()

      const coverUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`
      await ref.update({ coverUrl, updatedAt: new Date().toISOString() })

      return reply.code(200).send({ ok: true, coverUrl })
    }
  )
}

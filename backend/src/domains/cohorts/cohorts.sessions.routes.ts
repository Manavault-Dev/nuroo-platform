import type { FastifyPluginAsync } from 'fastify'
import { getFirestore } from '../../infrastructure/database/firebase.js'
import { requireOrgMember } from '../../infrastructure/auth/rbac.js'
import { canManageCohort, denyNotInstructor, isInMemberBranchScope } from './cohorts.auth.js'
import { createUniqueLink } from '../../infrastructure/meetings/google-meet.js'
import type { CohortDoc, SessionDoc } from './cohorts.types.js'
import {
  RATE,
  COL,
  sessionCreateSchema,
  sessionUpdateSchema,
  nowIso,
  sortSessionsBySchedule,
  getSpecialistRefreshToken,
} from './cohorts.helpers.js'
import {
  syncSessionCreatedForEnrolledParents,
  syncSessionUpdatedForEnrolledParents,
  syncSessionCancelledForEnrolledParents,
} from './cohorts.calendarSync.js'

const cohortParamsSchema = {
  type: 'object',
  required: ['orgId', 'cohortId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    cohortId: { type: 'string', description: 'Cohort ID' },
  },
} as const

const sessionParamsSchema = {
  type: 'object',
  required: ['orgId', 'cohortId', 'sessionId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    cohortId: { type: 'string', description: 'Cohort ID' },
    sessionId: { type: 'string', description: 'Session ID' },
  },
} as const

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' }, code: { type: 'string' } },
} as const

const okResponseSchema = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
} as const

const sessionSchema = {
  type: 'object',
  required: ['id', 'cohortId', 'orgId', 'date', 'startTime', 'endTime', 'status'],
  additionalProperties: true,
  properties: {
    id: { type: 'string' },
    cohortId: { type: 'string' },
    orgId: { type: 'string' },
    date: { type: 'string' },
    startTime: { type: 'string' },
    endTime: { type: 'string' },
    format: { type: 'string', enum: ['online', 'offline'] },
    meetingUrl: { type: ['string', 'null'] },
    status: { type: 'string', enum: ['scheduled', 'completed', 'cancelled', 'postponed'] },
    topic: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    postponedFrom: { type: ['string', 'null'] },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const

const sessionCreateBodySchema = {
  type: 'object',
  required: ['date', 'startTime', 'endTime'],
  additionalProperties: true,
  properties: {
    date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
    startTime: { type: 'string', description: 'HH:MM' },
    endTime: { type: 'string', description: 'HH:MM' },
    format: { type: 'string', enum: ['online', 'offline'] },
    topic: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
  },
} as const

const sessionUpdateBodySchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    date: { type: 'string' },
    startTime: { type: 'string' },
    endTime: { type: 'string' },
    format: { type: 'string', enum: ['online', 'offline'] },
    topic: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    status: { type: 'string', enum: ['scheduled', 'completed', 'cancelled', 'postponed'] },
    meetingUrl: { type: ['string', 'null'] },
    postponedFrom: { type: ['string', 'null'] },
  },
} as const

export const cohortsSessionsRoute: FastifyPluginAsync = async (fastify) => {
  const db = getFirestore()

  // ── GET /orgs/:orgId/cohorts/:cohortId/sessions ──────────────────────────

  fastify.get<{ Params: { orgId: string; cohortId: string } }>(
    '/orgs/:orgId/cohorts/:cohortId/sessions',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Cohorts'],
        summary: 'List all sessions for a cohort',
        params: cohortParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'sessions'],
            properties: {
              ok: { type: 'boolean' },
              sessions: { type: 'array', items: sessionSchema },
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

      const { orgId, cohortId } = request.params
      const cohortSnap = await db.doc(COL.cohort(orgId, cohortId)).get()
      if (!cohortSnap.exists) return reply.code(404).send({ error: 'Cohort not found' })
      if (!isInMemberBranchScope(member, cohortSnap.data() as CohortDoc)) {
        return reply.code(403).send({ error: 'Cohort belongs to a different branch' })
      }

      const snap = await db.collection(COL.sessions(orgId, cohortId)).get()
      const sessions = sortSessionsBySchedule(
        snap.docs.map((d) => ({ id: d.id, ...d.data() })) as SessionDoc[]
      )
      return { ok: true, sessions }
    }
  )

  // ── POST /orgs/:orgId/cohorts/:cohortId/sessions ─────────────────────────

  fastify.post<{ Params: { orgId: string; cohortId: string } }>(
    '/orgs/:orgId/cohorts/:cohortId/sessions',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Cohorts'],
        summary: 'Create a new session (class meeting) for a cohort',
        params: cohortParamsSchema,
        body: sessionCreateBodySchema,
        response: {
          201: {
            type: 'object',
            required: ['ok', 'session'],
            properties: { ok: { type: 'boolean' }, session: sessionSchema },
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

      const { orgId, cohortId } = request.params
      const cohortSnap = await db.doc(COL.cohort(orgId, cohortId)).get()
      if (!cohortSnap.exists) return reply.code(404).send({ error: 'Cohort not found' })
      if (!canManageCohort(member, cohortSnap.data() as CohortDoc)) return denyNotInstructor(reply)

      const body = sessionCreateSchema.parse(request.body)
      const now = nowIso()
      const { randomUUID } = await import('crypto')
      const id = randomUUID()
      const cohortData = cohortSnap.data() as CohortDoc
      const sessionFormat = body.format ?? cohortData.format

      let meetingUrl: string | null = cohortData.meetingUrl ?? null
      if (sessionFormat === 'online' && !meetingUrl) {
        try {
          const refreshToken = await getSpecialistRefreshToken(db, cohortData.instructorId)
          const meet = await createUniqueLink({
            title: `${cohortData.title} · ${body.date}`,
            date: body.date,
            startTime: body.startTime,
            endTime: body.endTime,
            refreshToken,
          })
          meetingUrl = meet.meetingUrl
        } catch (err) {
          fastify.log.warn({ err }, 'Google Meet unique link creation failed')
        }
      }

      const doc: Omit<SessionDoc, 'id'> = {
        cohortId,
        orgId,
        date: body.date,
        startTime: body.startTime,
        endTime: body.endTime,
        format: sessionFormat,
        meetingUrl,
        status: 'scheduled',
        topic: body.topic ?? null,
        notes: body.notes ?? null,
        postponedFrom: null,
        createdAt: now,
        updatedAt: now,
      }

      await db.doc(COL.session(orgId, cohortId, id)).set(doc)

      // Fan out to already-enrolled parents' calendars (fire-and-forget)
      void syncSessionCreatedForEnrolledParents(db, { id: cohortId, ...cohortData }, { id, ...doc })

      return reply.code(201).send({ ok: true, session: { id, ...doc } })
    }
  )

  // ── PATCH /orgs/:orgId/cohorts/:cohortId/sessions/:sessionId ─────────────

  fastify.patch<{ Params: { orgId: string; cohortId: string; sessionId: string } }>(
    '/orgs/:orgId/cohorts/:cohortId/sessions/:sessionId',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Cohorts'],
        summary: 'Update a cohort session (reschedule, add notes, change status)',
        params: sessionParamsSchema,
        body: sessionUpdateBodySchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'session'],
            properties: { ok: { type: 'boolean' }, session: sessionSchema },
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

      const ref = db.doc(COL.session(orgId, cohortId, sessionId))
      const snap = await ref.get()
      if (!snap.exists) return reply.code(404).send({ error: 'Session not found' })

      const body = sessionUpdateSchema.parse(request.body)
      await ref.update({ ...body, updatedAt: nowIso() })
      const updatedSession = { id: sessionId, ...(snap.data() as Omit<SessionDoc, 'id'>), ...body }

      // Keep enrolled parents' calendars in sync (fire-and-forget)
      const cohortData = cohortSnap.data() as CohortDoc
      if (body.status === 'cancelled') {
        void syncSessionCancelledForEnrolledParents(
          db,
          { id: cohortId, ...cohortData },
          updatedSession
        )
      } else if (body.date || body.startTime || body.endTime) {
        void syncSessionUpdatedForEnrolledParents(
          db,
          { id: cohortId, ...cohortData },
          updatedSession
        )
      }

      return { ok: true, session: updatedSession }
    }
  )

  // ── DELETE /orgs/:orgId/cohorts/:cohortId/sessions/:sessionId ────────────

  fastify.delete<{ Params: { orgId: string; cohortId: string; sessionId: string } }>(
    '/orgs/:orgId/cohorts/:cohortId/sessions/:sessionId',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Cohorts'],
        summary: 'Cancel a cohort session',
        params: sessionParamsSchema,
        response: {
          200: okResponseSchema,
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

      const ref = db.doc(COL.session(orgId, cohortId, sessionId))
      const sessionSnap = await ref.get()
      if (!sessionSnap.exists) return reply.code(404).send({ error: 'Session not found' })

      await ref.update({ status: 'cancelled', updatedAt: nowIso() })

      // Remove this session from every enrolled parent's calendar (fire-and-forget)
      const cohortData = cohortSnap.data() as CohortDoc
      const cancelledSession = {
        id: sessionId,
        ...(sessionSnap.data() as Omit<SessionDoc, 'id'>),
        status: 'cancelled' as const,
      }
      void syncSessionCancelledForEnrolledParents(
        db,
        { id: cohortId, ...cohortData },
        cancelledSession
      )

      return { ok: true }
    }
  )
}

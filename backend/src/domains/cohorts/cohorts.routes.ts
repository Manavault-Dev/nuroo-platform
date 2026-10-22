import type { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'crypto'
import { getFirestore } from '../../infrastructure/database/firebase.js'
import { requireOrgMember, memberBranchScope } from '../../infrastructure/auth/rbac.js'
import {
  canCreateCohort,
  canManageCohort,
  canApproveCohort,
  isAdmin,
  validateStatusTransition,
  validateImmutableFields,
  denyNotInstructor,
  denyForbidden,
} from './cohorts.auth.js'
import { createPersistentRoom } from '../../infrastructure/meetings/google-meet.js'
import type { CohortDoc, RecurringTemplate } from './cohorts.types.js'
import {
  RATE,
  COL,
  cohortCreateSchema,
  cohortUpdateSchema,
  nowIso,
  generateSessionDates,
  getOrgMeta,
  getSpecialistName,
  getSpecialistRefreshToken,
  computeStatus,
} from './cohorts.helpers.js'
import type { SessionDoc } from './cohorts.types.js'

const orgIdParamsSchema = {
  type: 'object',
  required: ['orgId'],
  properties: { orgId: { type: 'string', description: 'Organization ID' } },
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
  properties: { error: { type: 'string' }, code: { type: 'string' } },
} as const

const okResponseSchema = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
} as const

const cohortSchema = {
  type: 'object',
  required: ['id', 'orgId', 'title', 'status'],
  additionalProperties: true,
  properties: {
    id: { type: 'string' },
    orgId: { type: 'string' },
    branchId: { type: ['string', 'null'] },
    title: { type: 'string' },
    description: { type: 'string' },
    instructorId: { type: ['string', 'null'] },
    instructorName: { type: ['string', 'null'] },
    category: { type: ['string', 'null'] },
    ageMin: { type: ['integer', 'null'] },
    ageMax: { type: ['integer', 'null'] },
    format: { type: 'string', enum: ['online', 'offline'] },
    targetAudience: { type: 'string' },
    startDate: { type: 'string' },
    endDate: { type: 'string' },
    price: { type: 'number' },
    currency: { type: 'string' },
    maxParticipants: { type: 'integer' },
    enrolledCount: { type: 'integer' },
    status: { type: 'string' },
    scheduleType: { type: 'string' },
    coverUrl: { type: ['string', 'null'] },
    meetingUrl: { type: ['string', 'null'] },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const

const cohortBodySchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    branchId: { type: ['string', 'null'] },
    title: { type: 'string', maxLength: 200 },
    description: { type: 'string', maxLength: 2000 },
    instructorId: { type: ['string', 'null'] },
    category: { type: ['string', 'null'] },
    ageMin: { type: ['integer', 'null'] },
    ageMax: { type: ['integer', 'null'] },
    format: { type: 'string', enum: ['online', 'offline'] },
    targetAudience: { type: 'string', enum: ['children', 'parents', 'specialists', 'all'] },
    startDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
    endDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
    price: { type: 'number' },
    currency: { type: 'string' },
    maxParticipants: { type: 'integer' },
    scheduleType: { type: 'string', enum: ['manual', 'recurring'] },
    recurringTemplate: {
      type: ['object', 'null'],
      additionalProperties: true,
      properties: {
        weekdays: { type: 'array', items: { type: 'integer' } },
        startTime: { type: 'string' },
        endTime: { type: 'string' },
        repeatUntil: { type: 'string' },
      },
    },
    coverUrl: { type: ['string', 'null'] },
  },
} as const

export const cohortsRoute: FastifyPluginAsync = async (fastify) => {
  const db = getFirestore()

  // ── GET /orgs/:orgId/cohorts ─────────────────────────────────────────────

  fastify.get<{ Params: { orgId: string }; Querystring: { branchId?: string } }>(
    '/orgs/:orgId/cohorts',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Cohorts'],
        summary: "List an organization's cohorts, optionally filtered by branch",
        params: orgIdParamsSchema,
        querystring: {
          type: 'object',
          properties: { branchId: { type: 'string', description: 'Filter by branch ID' } },
        },
        response: {
          200: {
            type: 'object',
            required: ['ok', 'cohorts'],
            properties: {
              ok: { type: 'boolean' },
              cohorts: { type: 'array', items: cohortSchema },
            },
          },
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const member = await requireOrgMember(request, reply, request.params.orgId)
      if (reply.sent) return

      const { orgId } = request.params
      // A branch-scoped member always sees only their branch; an HQ member may
      // optionally filter by branchId via the query string.
      const scope = memberBranchScope(member)
      const effectiveBranchId = scope ?? request.query.branchId
      let query = db.collection(COL.cohorts(orgId)) as FirebaseFirestore.Query
      if (effectiveBranchId) query = query.where('branchId', '==', effectiveBranchId)

      const snap = await query.orderBy('createdAt', 'desc').limit(200).get()
      const cohorts = snap.docs.map((d) => {
        const data = { id: d.id, ...d.data() } as CohortDoc
        return { ...data, status: computeStatus(data) }
      })
      return { ok: true, cohorts }
    }
  )

  // ── POST /orgs/:orgId/cohorts ────────────────────────────────────────────

  fastify.post<{ Params: { orgId: string } }>(
    '/orgs/:orgId/cohorts',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Cohorts'],
        summary: 'Create a new cohort for an organization',
        params: orgIdParamsSchema,
        body: { ...cohortBodySchema, required: ['title', 'startDate', 'endDate'] },
        response: {
          201: {
            type: 'object',
            required: ['ok', 'cohort'],
            properties: { ok: { type: 'boolean' }, cohort: cohortSchema },
          },
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const member = await requireOrgMember(request, reply, request.params.orgId)
      if (reply.sent) return
      if (!canCreateCohort(member))
        return denyForbidden(reply, 'Only org members can create groups')

      const { orgId } = request.params
      const body = cohortCreateSchema.parse(request.body)
      const now = nowIso()
      const id = randomUUID()

      const { orgName, orgLogoUrl } = await getOrgMeta(db, orgId)
      const resolvedInstructorId = isAdmin(member) ? (body.instructorId ?? member.uid) : member.uid
      const instructorName = await getSpecialistName(db, resolvedInstructorId)
      // A branch-scoped member always creates programs under their own branch.
      const scope = memberBranchScope(member)

      const doc: Omit<CohortDoc, 'id'> = {
        orgId,
        branchId: scope ?? body.branchId ?? null,
        title: body.title,
        description: body.description,
        instructorId: resolvedInstructorId,
        instructorName,
        category: body.category ?? null,
        ageMin: body.ageMin ?? null,
        ageMax: body.ageMax ?? null,
        format: body.format,
        targetAudience: body.targetAudience ?? 'children',
        startDate: body.startDate,
        endDate: body.endDate,
        price: body.price,
        currency: body.currency,
        maxParticipants: body.maxParticipants,
        enrolledCount: 0,
        status: 'draft',
        scheduleType: body.scheduleType,
        recurringTemplate: (body.recurringTemplate as RecurringTemplate) ?? null,
        coverUrl: body.coverUrl ?? null,
        meetingUrl: null,
        meetingEventId: null,
        approvalStatus: null,
        submittedForApprovalAt: null,
        submittedBy: null,
        approvedAt: null,
        approvedBy: null,
        rejectionComment: null,
        orgName,
        orgLogoUrl,
        createdBy: request.user.uid,
        updatedBy: null,
        createdAt: now,
        updatedAt: now,
        publishedAt: null,
      }

      await db.doc(COL.cohort(orgId, id)).set(doc)

      if (body.scheduleType === 'recurring' && body.recurringTemplate) {
        const dates = generateSessionDates(
          body.recurringTemplate as RecurringTemplate,
          body.startDate
        )
        const batch = db.batch()
        for (const date of dates) {
          const sessionId = randomUUID()
          const sessionDoc: Omit<SessionDoc, 'id'> = {
            cohortId: id,
            orgId,
            date,
            startTime: body.recurringTemplate.startTime,
            endTime: body.recurringTemplate.endTime,
            format: body.format,
            meetingUrl: null,
            status: 'scheduled',
            topic: null,
            notes: null,
            postponedFrom: null,
            createdAt: now,
            updatedAt: now,
          }
          batch.set(db.doc(COL.session(orgId, id, sessionId)), sessionDoc)
        }
        await batch.commit()
      }

      return reply.code(201).send({ ok: true, cohort: { id, ...doc } })
    }
  )

  // ── GET /orgs/:orgId/cohorts/:cohortId ───────────────────────────────────

  fastify.get<{ Params: { orgId: string; cohortId: string } }>(
    '/orgs/:orgId/cohorts/:cohortId',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Cohorts'],
        summary: 'Get a single cohort by ID',
        params: cohortParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'cohort'],
            properties: { ok: { type: 'boolean' }, cohort: cohortSchema },
          },
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      await requireOrgMember(request, reply, request.params.orgId)
      if (reply.sent) return

      const { orgId, cohortId } = request.params
      const snap = await db.doc(COL.cohort(orgId, cohortId)).get()
      if (!snap.exists) return reply.code(404).send({ error: 'Cohort not found' })
      const cohort = { id: snap.id, ...snap.data() } as CohortDoc
      return { ok: true, cohort: { ...cohort, status: computeStatus(cohort) } }
    }
  )

  // ── PATCH /orgs/:orgId/cohorts/:cohortId ─────────────────────────────────

  fastify.patch<{ Params: { orgId: string; cohortId: string } }>(
    '/orgs/:orgId/cohorts/:cohortId',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Cohorts'],
        summary: 'Update a cohort (fields, status transitions, approval flow)',
        params: cohortParamsSchema,
        body: {
          ...cohortBodySchema,
          properties: {
            ...cohortBodySchema.properties,
            status: {
              type: 'string',
              enum: [
                'draft',
                'pending_approval',
                'open',
                'full',
                'in_progress',
                'completed',
                'archived',
                'cancelled',
              ],
            },
            rejectionComment: { type: ['string', 'null'] },
            instructorId: { type: ['string', 'null'] },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['ok', 'cohort'],
            properties: { ok: { type: 'boolean' }, cohort: cohortSchema },
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
      const ref = db.doc(COL.cohort(orgId, cohortId))
      const snap = await ref.get()
      if (!snap.exists) return reply.code(404).send({ error: 'Cohort not found' })

      const cohort = snap.data() as CohortDoc
      if (!canManageCohort(member, cohort)) return denyNotInstructor(reply)

      const body = cohortUpdateSchema.parse(request.body)
      if (!validateImmutableFields({ member, body: body as Record<string, unknown>, reply })) return

      const { requireGroupApproval } = await getOrgMeta(db, orgId)
      const updates: Record<string, unknown> = {
        ...body,
        updatedAt: nowIso(),
        updatedBy: request.user.uid,
      }

      if (body.status && body.status !== cohort.status) {
        const valid = validateStatusTransition({
          member,
          cohort,
          nextStatus: body.status,
          requireGroupApproval,
          reply,
        })
        if (!valid) return

        if (body.status === 'pending_approval') {
          updates.approvalStatus = 'pending'
          updates.submittedForApprovalAt = nowIso()
          updates.submittedBy = request.user.uid
          updates.rejectionComment = null
        }
        if (body.status === 'open' && cohort.status === 'pending_approval') {
          if (!canApproveCohort(member))
            return denyForbidden(reply, 'Only admins can approve groups')
          updates.approvalStatus = 'approved'
          updates.approvedAt = nowIso()
          updates.approvedBy = request.user.uid
        }
        if (body.status === 'draft' && cohort.status === 'pending_approval') {
          updates.approvalStatus = 'rejected'
          updates.rejectionComment = body.rejectionComment ?? null
        }
        if (body.status === 'open' && !cohort.publishedAt) {
          updates.publishedAt = nowIso()

          if (cohort.format === 'online' && !cohort.meetingUrl) {
            const instructorToken = await getSpecialistRefreshToken(db, cohort.instructorId)
            const requesterToken =
              request.user!.uid !== cohort.instructorId
                ? await getSpecialistRefreshToken(db, request.user!.uid)
                : null
            const refreshToken = instructorToken ?? requesterToken

            if (!refreshToken) {
              fastify.log.info(
                { instructorId: cohort.instructorId, requesterId: request.user!.uid },
                'Google Meet skipped: no connected Google Calendar'
              )
            } else {
              try {
                const meet = await createPersistentRoom({
                  title: cohort.title,
                  description: cohort.description || undefined,
                  startDate: cohort.startDate,
                  endDate: cohort.endDate,
                  orgName: cohort.orgName ?? undefined,
                  refreshToken,
                })
                updates.meetingUrl = meet.meetingUrl
                updates.meetingEventId = meet.eventId
                fastify.log.info({ meetingUrl: meet.meetingUrl }, 'Google Meet room created ✅')

                const sessionsSnap = await db.collection(COL.sessions(orgId, cohortId)).get()
                if (!sessionsSnap.empty) {
                  const batch = db.batch()
                  for (const s of sessionsSnap.docs) {
                    batch.update(s.ref, { meetingUrl: meet.meetingUrl, updatedAt: nowIso() })
                  }
                  await batch.commit()
                }
              } catch (err) {
                fastify.log.warn({ err }, 'Google Meet room creation failed (non-fatal)')
              }
            }
          }
        }
      }

      if (body.instructorId && isAdmin(member)) {
        updates.instructorName = await getSpecialistName(db, body.instructorId)
      } else {
        delete updates.instructorId
      }

      await ref.update(updates)
      const updated = { id: cohortId, ...snap.data(), ...updates } as CohortDoc
      return { ok: true, cohort: { ...updated, status: computeStatus(updated) } }
    }
  )

  // ── DELETE /orgs/:orgId/cohorts/:cohortId ────────────────────────────────
  // ?force=true — permanently deletes (only allowed for cancelled/completed)
  // default     — soft-cancel (sets status to 'cancelled')

  fastify.delete<{ Params: { orgId: string; cohortId: string }; Querystring: { force?: string } }>(
    '/orgs/:orgId/cohorts/:cohortId',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Cohorts'],
        summary: 'Cancel a cohort, or permanently delete it with ?force=true',
        params: cohortParamsSchema,
        querystring: {
          type: 'object',
          properties: {
            force: { type: 'string', description: "Pass 'true' to permanently delete" },
          },
        },
        response: {
          200: okResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const member = await requireOrgMember(request, reply, request.params.orgId)
      if (reply.sent) return

      const { orgId, cohortId } = request.params
      const force = request.query.force === 'true'
      const ref = db.doc(COL.cohort(orgId, cohortId))
      const snap = await ref.get()
      if (!snap.exists) return reply.code(404).send({ error: 'Cohort not found' })
      if (!canManageCohort(member, snap.data() as CohortDoc)) return denyNotInstructor(reply)

      const cohort = snap.data() as CohortDoc
      if (force) {
        // Hard delete — only allowed for cancelled or completed cohorts (use computed status)
        const effectiveStatus = computeStatus(cohort)
        if (!['cancelled', 'completed'].includes(effectiveStatus)) {
          return reply.code(409).send({ error: 'Cancel the cohort before deleting it permanently' })
        }
        await ref.delete()
      } else {
        await ref.update({ status: 'cancelled', updatedAt: nowIso(), updatedBy: request.user!.uid })
      }
      return { ok: true }
    }
  )
}

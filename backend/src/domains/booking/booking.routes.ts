import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { getFirestore } from '../../infrastructure/database/firebase.js'
import { requireOrgMember, memberBranchScope } from '../../infrastructure/auth/rbac.js'
import { canTransition, buildStatusUpdate, validateBookingInput } from './booking.service.js'
import type { BookingDoc, Slot } from './types.js'
import { eventDispatcher } from '../../modules/notifications/event.dispatcher.js'
import { writeAudit } from '../../infrastructure/audit/audit.js'
import {
  getParentCalendarAuth,
  upsertCalendarEvent,
  deleteCalendarEvent,
} from '../../infrastructure/calendar/calendarSync.service.js'

const RATE = { max: 30, timeWindow: '1 minute' }
const RATE_READ = { max: 120, timeWindow: '1 minute' }

const createBookingSchema = z.object({
  specialistId: z.string().trim().min(1),
  serviceId: z.string().trim().min(1).optional().nullable(),
  slotId: z.string().trim().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  childId: z.string().trim().min(1).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
})

const statusUpdateSchema = z.object({
  status: z.enum(['confirmed', 'completed', 'cancelled', 'no_show']),
  cancelReason: z.string().trim().max(500).optional(),
})

function sortBookingsByDateDesc<T extends Pick<BookingDoc, 'date' | 'startTime'>>(
  bookings: T[]
): T[] {
  return [...bookings].sort((a, b) => {
    const dateCompare = b.date.localeCompare(a.date)
    return dateCompare || b.startTime.localeCompare(a.startTime)
  })
}

// Reads from userBookings index, then fetches fresh canonical data to avoid stale status
async function listParentBookings(db: FirebaseFirestore.Firestore, parentId: string) {
  const indexSnap = await db.collection(`userBookings/${parentId}/items`).limit(50).get()
  if (indexSnap.empty) return []

  const freshDocs = await Promise.all(
    indexSnap.docs.map(async (d) => {
      const cached = d.data() as BookingDoc
      const orgId = cached.orgId
      if (!orgId) return { id: d.id, ...cached }
      const fresh = await db.doc(`organizations/${orgId}/bookings/${d.id}`).get()
      if (!fresh.exists) return null
      return { id: d.id, ...(fresh.data() as BookingDoc) }
    })
  )

  const bookings = freshDocs.filter((b): b is NonNullable<typeof b> => b !== null)

  // Resolve org/specialist display names once per unique id — the card list
  // needs "who/where" as the headline, not just a date, and the booking doc
  // itself only stores ids.
  const orgIds = [...new Set(bookings.map((b) => b.orgId).filter(Boolean))]
  const specialistIds = [...new Set(bookings.map((b) => b.specialistId).filter(Boolean))]

  const [orgSnaps, specialistSnaps] = await Promise.all([
    Promise.all(orgIds.map((id) => db.doc(`organizations/${id}`).get())),
    Promise.all(specialistIds.map((id) => db.doc(`users/${id}`).get())),
  ])

  const orgNames = new Map(
    orgSnaps.map((snap, i) => [
      orgIds[i],
      (snap.data() as { name?: string } | undefined)?.name ?? null,
    ])
  )
  const specialistNames = new Map(
    specialistSnaps.map((snap, i) => [
      specialistIds[i],
      (snap.data() as { fullName?: string } | undefined)?.fullName ?? null,
    ])
  )

  const enriched = bookings.map((b) => ({
    ...b,
    orgName: orgNames.get(b.orgId) ?? null,
    specialistName: specialistNames.get(b.specialistId) ?? null,
  }))

  return sortBookingsByDateDesc(enriched)
}

const orgParamsSchema = {
  type: 'object',
  required: ['orgId'],
  properties: { orgId: { type: 'string', description: 'Organization ID' } },
} as const

const bookingParamsSchema = {
  type: 'object',
  required: ['orgId', 'bookingId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    bookingId: { type: 'string', description: 'Booking ID' },
  },
} as const

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' } },
} as const

const okResponseSchema = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
} as const

const createBookingBodySchema = {
  type: 'object',
  required: ['specialistId', 'slotId', 'date', 'startTime', 'endTime'],
  additionalProperties: true,
  properties: {
    specialistId: { type: 'string', minLength: 1 },
    serviceId: { type: ['string', 'null'] },
    slotId: { type: 'string', minLength: 1 },
    date: { type: 'string', description: 'YYYY-MM-DD' },
    startTime: { type: 'string', description: 'HH:MM' },
    endTime: { type: 'string', description: 'HH:MM' },
    childId: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'], maxLength: 1000 },
  },
} as const

const cancelBookingBodySchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    reason: { type: 'string', maxLength: 500 },
  },
} as const

const bookingsQuerystringSchema = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    specialistId: { type: 'string' },
    date: { type: 'string', description: 'YYYY-MM-DD' },
    branchId: { type: 'string' },
  },
} as const

const statusUpdateBodySchema = {
  type: 'object',
  required: ['status'],
  additionalProperties: true,
  properties: {
    status: { type: 'string', enum: ['confirmed', 'completed', 'cancelled', 'no_show'] },
    cancelReason: { type: 'string', maxLength: 500 },
  },
} as const

export const bookingRoute: FastifyPluginAsync = async (fastify) => {
  const db = getFirestore()

  // POST /marketplace/organizations/:orgId/bookings — parent creates a booking
  fastify.post<{ Params: { orgId: string } }>(
    '/marketplace/organizations/:orgId/bookings',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Booking'],
        summary: 'Create a new booking for a specialist slot',
        params: orgParamsSchema,
        body: createBookingBodySchema,
        response: {
          201: {
            type: 'object',
            required: ['ok', 'bookingId', 'intakeStatus', 'intakeFormId'],
            properties: {
              ok: { type: 'boolean' },
              bookingId: { type: 'string' },
              intakeStatus: { type: 'string', enum: ['not_required', 'pending'] },
              intakeFormId: { type: ['string', 'null'] },
            },
          },
          401: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const { orgId } = request.params
      const parentId = request.user.uid

      const parse = createBookingSchema.safeParse(request.body)
      if (!parse.success) {
        return reply.code(400).send({ error: 'Invalid input', issues: parse.error.issues })
      }

      const { specialistId, serviceId, slotId, date, startTime, endTime, childId, notes } =
        parse.data

      const inputError = validateBookingInput(specialistId, slotId, date)
      if (inputError) return reply.code(400).send({ error: inputError })

      const orgSnap = await db.doc(`organizations/${orgId}`).get()
      if (!orgSnap.exists) return reply.code(404).send({ error: 'Organization not found' })

      let intakeFormId: string | null = null
      if (serviceId) {
        const svcSnap = await db.doc(`organizations/${orgId}/specialistServices/${serviceId}`).get()
        if (svcSnap.exists) {
          intakeFormId = (svcSnap.data() as { intakeFormId?: string | null }).intakeFormId ?? null
        }
      }
      const intakeStatus = intakeFormId ? 'pending' : 'not_required'

      // Denormalize the specialist's branch onto the booking for enterprise scoping.
      const specialistMemberSnap = await db
        .doc(`organizations/${orgId}/members/${specialistId}`)
        .get()
      const branchId = (specialistMemberSnap.data()?.branchId as string | null | undefined) ?? null

      const now = new Date().toISOString()
      const bookingRef = db.collection(`organizations/${orgId}/bookings`).doc()
      const slotRef = db.doc(`organizations/${orgId}/slots/${slotId}`)

      try {
        await db.runTransaction(async (tx) => {
          const slotSnap = await tx.get(slotRef)

          if (slotSnap.exists && slotSnap.data()?.status === 'booked') {
            throw Object.assign(new Error('Slot already booked'), { code: 'SLOT_TAKEN' })
          }

          const conflictSnap = await db
            .collection(`organizations/${orgId}/bookings`)
            .where('parentId', '==', parentId)
            .get()

          const duplicateBooking = conflictSnap.docs.some((doc) => {
            const booking = doc.data() as BookingDoc
            return (
              booking.specialistId === specialistId &&
              booking.date === date &&
              booking.startTime === startTime &&
              ['pending', 'confirmed'].includes(booking.status)
            )
          })

          if (duplicateBooking) {
            throw Object.assign(new Error('Duplicate booking'), { code: 'DUPLICATE_BOOKING' })
          }

          const bookingDoc: BookingDoc = {
            orgId,
            specialistId,
            branchId,
            parentId,
            childId: childId ?? null,
            serviceId: serviceId ?? null,
            slotId,
            date,
            startTime,
            endTime,
            status: 'pending',
            intakeStatus,
            intakeFormId,
            notes: notes ?? null,
            cancelReason: null,
            attendanceStatus: null,
            rescheduledAt: null,
            rescheduledFrom: null,
            rescheduledFromDate: null,
            rescheduledFromTime: null,
            rescheduledBy: null,
            createdAt: now,
            updatedAt: now,
            confirmedAt: null,
            completedAt: null,
            cancelledAt: null,
            noShowAt: null,
          }

          tx.set(bookingRef, bookingDoc)
          // Mirror to userBookings for fast parent-facing queries
          tx.set(db.doc(`userBookings/${parentId}/items/${bookingRef.id}`), bookingDoc)
          // Mark slot as booked
          tx.set(slotRef, {
            id: slotId,
            orgId,
            specialistId,
            serviceId: serviceId ?? null,
            date,
            startTime,
            endTime,
            status: 'booked',
            bookingId: bookingRef.id,
            createdAt: now,
          } as Slot)
        })
      } catch (err: any) {
        if (err.code === 'SLOT_TAKEN')
          return reply.code(409).send({ error: 'This slot is no longer available' })
        if (err.code === 'DUPLICATE_BOOKING')
          return reply.code(409).send({ error: 'You already have a booking at this time' })
        throw err
      }

      // Fire push + email notification in background — non-blocking
      const orgData = orgSnap.data() as { name?: string } | undefined
      const parentUser = request.user
      void (async () => {
        let specialistName = 'Специалист'
        try {
          const [specialistSnap, parentSnap] = await Promise.all([
            db.doc(`users/${specialistId}`).get(),
            db.doc(`users/${parentId}`).get(),
          ])
          specialistName =
            (specialistSnap.data() as { fullName?: string } | undefined)?.fullName ?? 'Специалист'
          const parentData = parentSnap.data() as
            | { email?: string; fullName?: string; phoneNumber?: string }
            | undefined
          const parentEmail: string = parentData?.email ?? parentUser?.email ?? ''
          const parentPhone: string | null = parentData?.phoneNumber ?? null
          const parentName: string = parentData?.fullName ?? 'Родитель'

          console.log(
            `[Booking] Sending booking_confirmed notification — email: "${parentEmail}", phone: "${parentPhone ?? ''}"`
          )
          if (parentEmail || parentPhone) {
            eventDispatcher.dispatch({
              type: 'booking_confirmed',
              bookingId: bookingRef.id,
              orgId,
              orgName: orgData?.name ?? orgId,
              parentId,
              parentName,
              parentEmail: parentEmail || undefined,
              parentPhone,
              specialistName,
              date,
              startTime,
              endTime,
            })
          }
        } catch (err) {
          console.error('[Booking] Notification dispatch failed:', err)
        }

        try {
          const auth = await getParentCalendarAuth(parentId)
          if (auth.connected && auth.refreshToken) {
            const googleEventId = await upsertCalendarEvent(auth.refreshToken, {
              title: `${specialistName} — ${orgData?.name ?? 'Nuroo'}`,
              description: notes ?? undefined,
              location: orgData?.name ?? undefined,
              startDateTime: `${date}T${startTime}:00`,
              endDateTime: `${date}T${endTime}:00`,
            })
            await Promise.all([
              bookingRef.update({ googleCalendarEventId: googleEventId }),
              db
                .doc(`userBookings/${parentId}/items/${bookingRef.id}`)
                .update({ googleCalendarEventId: googleEventId }),
            ])
          }
        } catch (err) {
          console.error('[Booking] Calendar sync failed:', err)
        }
      })()

      return reply
        .code(201)
        .send({ ok: true, bookingId: bookingRef.id, intakeStatus, intakeFormId })
    }
  )

  // GET /marketplace/bookings — parent's own bookings
  fastify.get(
    '/marketplace/bookings',
    {
      config: { rateLimit: RATE_READ },
      schema: {
        tags: ['Booking'],
        summary: "List the authenticated parent's own bookings",
        response: {
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const bookings = await listParentBookings(db, request.user.uid)
      return { ok: true, bookings }
    }
  )

  // GET /marketplace/my/bookings — backwards-compatible alias
  fastify.get(
    '/marketplace/my/bookings',
    {
      config: { rateLimit: RATE_READ },
      schema: {
        tags: ['Booking'],
        summary: "List the authenticated parent's own bookings (legacy alias)",
        response: {
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const bookings = await listParentBookings(db, request.user.uid)
      return { ok: true, bookings }
    }
  )

  // GET /marketplace/organizations/:orgId/bookings/:bookingId — parent views own booking
  fastify.get<{ Params: { orgId: string; bookingId: string } }>(
    '/marketplace/organizations/:orgId/bookings/:bookingId',
    {
      config: { rateLimit: RATE_READ },
      schema: {
        tags: ['Booking'],
        summary: 'Get a single booking owned by the authenticated parent',
        params: bookingParamsSchema,
        response: {
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const { orgId, bookingId } = request.params

      const snap = await db.doc(`organizations/${orgId}/bookings/${bookingId}`).get()
      if (!snap.exists) return reply.code(404).send({ error: 'Booking not found' })

      const booking = snap.data() as BookingDoc
      if (booking.parentId !== request.user.uid) return reply.code(403).send({ error: 'Forbidden' })

      return { ok: true, booking: { id: snap.id, ...booking } }
    }
  )

  // PUT /marketplace/organizations/:orgId/bookings/:bookingId/cancel — parent cancels
  fastify.put<{ Params: { orgId: string; bookingId: string } }>(
    '/marketplace/organizations/:orgId/bookings/:bookingId/cancel',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Booking'],
        summary: 'Cancel a booking owned by the authenticated parent',
        params: bookingParamsSchema,
        body: cancelBookingBodySchema,
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
      const { orgId, bookingId } = request.params

      const ref = db.doc(`organizations/${orgId}/bookings/${bookingId}`)
      const snap = await ref.get()
      if (!snap.exists) return reply.code(404).send({ error: 'Booking not found' })

      const booking = snap.data() as BookingDoc
      if (booking.parentId !== request.user.uid) return reply.code(403).send({ error: 'Forbidden' })

      if (!canTransition(booking.status, 'cancelled')) {
        return reply
          .code(409)
          .send({ error: `Cannot cancel a booking with status '${booking.status}'` })
      }

      const body = z
        .object({ reason: z.string().trim().max(500).optional() })
        .safeParse(request.body)
      const update = buildStatusUpdate('cancelled', body.data?.reason)
      const parentId = booking.parentId

      await db.runTransaction(async (tx) => {
        tx.update(ref, update)
        tx.update(db.doc(`userBookings/${parentId}/items/${bookingId}`), update)
        if (booking.slotId) {
          tx.update(db.doc(`organizations/${orgId}/slots/${booking.slotId}`), {
            status: 'available',
            bookingId: null,
          })
        }
      })

      writeAudit({
        db,
        orgId,
        entityType: 'booking',
        entityId: bookingId,
        action: 'booking.cancelled',
        actorId: request.user.uid,
        actorRole: 'parent',
        before: { status: booking.status },
        after: { status: 'cancelled' },
        reason: body.data?.reason ?? null,
      })

      // Notify parent of cancellation (fire-and-forget)
      void (async () => {
        try {
          const [parentSnap, specialistSnap] = await Promise.all([
            db.doc(`users/${parentId}`).get(),
            db.doc(`users/${booking.specialistId}`).get(),
          ])
          const cancelParentData = parentSnap.data() as
            | { email?: string; fullName?: string; phoneNumber?: string }
            | undefined
          const parentEmail: string = cancelParentData?.email ?? request.user?.email ?? ''
          const parentPhone: string | null = cancelParentData?.phoneNumber ?? null
          const parentName: string = cancelParentData?.fullName ?? 'Родитель'
          const specialistName: string =
            (specialistSnap.data() as { fullName?: string } | undefined)?.fullName ?? 'Специалист'
          eventDispatcher.dispatch({
            type: 'booking_cancelled',
            bookingId,
            orgId,
            parentId,
            parentName,
            parentEmail: parentEmail || undefined,
            parentPhone,
            specialistName,
            date: booking.date,
            startTime: booking.startTime,
            reason: body.data?.reason ?? null,
          })
        } catch (err) {
          console.error('[Booking] Cancellation notification failed:', err)
        }

        if (booking.googleCalendarEventId) {
          try {
            const auth = await getParentCalendarAuth(parentId)
            if (auth.connected && auth.refreshToken) {
              await deleteCalendarEvent(auth.refreshToken, booking.googleCalendarEventId)
            }
          } catch (err) {
            console.error('[Booking] Calendar event delete failed:', err)
          }
        }
      })()

      return { ok: true }
    }
  )

  // GET /orgs/:orgId/bookings — org admin views all bookings
  fastify.get<{
    Params: { orgId: string }
    Querystring: { status?: string; specialistId?: string; date?: string; branchId?: string }
  }>(
    '/orgs/:orgId/bookings',
    {
      config: { rateLimit: RATE_READ },
      schema: {
        tags: ['Booking'],
        summary: 'List bookings for an organization (admin), with optional filters',
        params: orgParamsSchema,
        querystring: bookingsQuerystringSchema,
        response: {
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const { orgId } = request.params
      const member = await requireOrgMember(request, reply, orgId)
      if (reply.sent) return
      if (member.role !== 'org_admin') return reply.code(403).send({ error: 'Forbidden' })

      const { status, specialistId, date, branchId } = request.query as Record<string, string>
      const scope = memberBranchScope(member)
      const effectiveBranchId = scope ?? branchId

      let bookingsQuery = db.collection(
        `organizations/${orgId}/bookings`
      ) as FirebaseFirestore.Query
      if (effectiveBranchId)
        bookingsQuery = bookingsQuery.where('branchId', '==', effectiveBranchId)
      const snap = await bookingsQuery.limit(250).get()

      let bookings = snap.docs.map((d) => ({ id: d.id, ...(d.data() as BookingDoc) }))
      if (specialistId) bookings = bookings.filter((b) => b.specialistId === specialistId)
      if (date) bookings = bookings.filter((b) => b.date === date)
      if (status) bookings = bookings.filter((b) => b.status === status)
      bookings = sortBookingsByDateDesc(bookings).slice(0, 100)

      return { ok: true, bookings }
    }
  )

  // PUT /orgs/:orgId/bookings/:bookingId/status — org admin updates booking status
  fastify.put<{ Params: { orgId: string; bookingId: string } }>(
    '/orgs/:orgId/bookings/:bookingId/status',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Booking'],
        summary: 'Update the status of a booking (admin)',
        params: bookingParamsSchema,
        body: statusUpdateBodySchema,
        response: {
          200: okResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const { orgId, bookingId } = request.params
      const member = await requireOrgMember(request, reply, orgId)
      if (reply.sent) return
      if (member.role !== 'org_admin') return reply.code(403).send({ error: 'Forbidden' })

      const parse = statusUpdateSchema.safeParse(request.body)
      if (!parse.success) return reply.code(400).send({ error: 'Invalid status' })

      const ref = db.doc(`organizations/${orgId}/bookings/${bookingId}`)
      const snap = await ref.get()
      if (!snap.exists) return reply.code(404).send({ error: 'Booking not found' })

      const booking = snap.data() as BookingDoc
      const scope = memberBranchScope(member)
      if (scope && (booking.branchId ?? null) !== scope) {
        return reply.code(403).send({ error: 'Booking belongs to a different branch' })
      }
      if (!canTransition(booking.status, parse.data.status)) {
        return reply.code(409).send({
          error: `Cannot transition from '${booking.status}' to '${parse.data.status}'`,
        })
      }

      const update = buildStatusUpdate(parse.data.status, parse.data.cancelReason)
      await ref.update(update)

      // Keep userBookings mirror in sync (best-effort)
      await db
        .doc(`userBookings/${booking.parentId}/items/${bookingId}`)
        .update(update)
        .catch(() => {})

      // Free the slot on cancellation or no-show
      if (
        (parse.data.status === 'cancelled' || parse.data.status === 'no_show') &&
        booking.slotId
      ) {
        await db
          .doc(`organizations/${orgId}/slots/${booking.slotId}`)
          .update({ status: 'available', bookingId: null })
          .catch(() => {})
      }

      writeAudit({
        db,
        orgId,
        entityType: 'booking',
        entityId: bookingId,
        action: `booking.${parse.data.status}` as any,
        actorId: request.user.uid,
        actorRole: 'org_admin',
        before: { status: booking.status },
        after: { status: parse.data.status },
        reason: parse.data.cancelReason ?? null,
      })

      // Org-admin cancel/no-show also needs to remove the parent's calendar event
      // (fire-and-forget) — parent self-cancel handles its own path above.
      if (
        (parse.data.status === 'cancelled' || parse.data.status === 'no_show') &&
        booking.googleCalendarEventId
      ) {
        void (async () => {
          try {
            const auth = await getParentCalendarAuth(booking.parentId)
            if (auth.connected && auth.refreshToken) {
              await deleteCalendarEvent(auth.refreshToken, booking.googleCalendarEventId!)
            }
          } catch (err) {
            console.error('[Booking] Calendar event delete failed:', err)
          }
        })()
      }

      return { ok: true }
    }
  )
}

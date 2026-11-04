import type { FastifyPluginAsync } from 'fastify'
import { getFirestore } from '../../infrastructure/database/firebase.js'
import { generateSlotsForRange } from './booking.service.js'
import type { AvailabilityTemplate, BlockedPeriod, Slot } from './types.js'

const RATE_PUBLIC = { max: 120, timeWindow: '1 minute' }
const READINESS_WINDOW_DAYS = 30

const orgParamsSchema = {
  type: 'object',
  required: ['orgId'],
  properties: { orgId: { type: 'string' } },
} as const

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' } },
} as const

async function hasUpcomingSlot(
  db: FirebaseFirestore.Firestore,
  orgId: string,
  specialistId: string
): Promise<boolean> {
  const availSnap = await db
    .doc(`organizations/${orgId}/specialistAvailability/${specialistId}`)
    .get()
  if (!availSnap.exists) return false

  const template = availSnap.data() as AvailabilityTemplate
  const startDate = new Date().toISOString().split('T')[0]
  const generated = generateSlotsForRange(template, startDate, READINESS_WINDOW_DAYS, null)
  if (generated.length === 0) return false

  const endDate = new Date(startDate + 'T00:00:00Z')
  endDate.setUTCDate(endDate.getUTCDate() + READINESS_WINDOW_DAYS)
  const endDateStr = endDate.toISOString().split('T')[0]

  const [bookedSnap, blockedSnap] = await Promise.all([
    db
      .collection(`organizations/${orgId}/slots`)
      .where('date', '>=', startDate)
      .where('date', '<', endDateStr)
      .get(),
    db
      .collection(`organizations/${orgId}/specialistBlocking`)
      .where('specialistId', '==', specialistId)
      .get()
      .catch(() => ({ docs: [] }) as unknown as FirebaseFirestore.QuerySnapshot),
  ])
  const bookedKeys = new Set(
    bookedSnap.docs
      .map((d) => d.data() as Slot)
      .filter((slot) => slot.specialistId === specialistId && slot.status === 'booked')
      .map((slot) => `${slot.date}|${slot.startTime}`)
  )

  const blocks = blockedSnap.docs
    .map((d) => d.data() as BlockedPeriod)
    .filter((b) => b.endDate >= startDate && b.startDate <= endDateStr)
  const isBlocked = (date: string, start: string, end: string): boolean => {
    for (const b of blocks) {
      if (date < b.startDate || date > b.endDate) continue
      if (!b.startTime || !b.endTime) return true
      if (start < b.endTime && end > b.startTime) return true
    }
    return false
  }

  return generated.some(
    (s) => !bookedKeys.has(`${s.date}|${s.startTime}`) && !isBlocked(s.date, s.startTime, s.endTime)
  )
}

export const readinessRoute: FastifyPluginAsync = async (fastify) => {
  const db = getFirestore()

  /**
   * GET /marketplace/organizations/:orgId/booking-readiness — public
   *
   * Computes whether online booking should be enabled for this org:
   * at least one active specialist, with at least one active service,
   * with at least one open slot in the next 30 days. Three separate
   * reasons are returned so the client can show a precise disabled-state
   * explanation instead of a generic "not available."
   */
  fastify.get<{ Params: { orgId: string } }>(
    '/marketplace/organizations/:orgId/booking-readiness',
    {
      config: { rateLimit: RATE_PUBLIC },
      schema: {
        tags: ['Booking'],
        summary: 'Whether an organization currently meets the prerequisites for online booking',
        params: orgParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'isBookable', 'hasSpecialist', 'hasService', 'hasSlot'],
            properties: {
              ok: { type: 'boolean' },
              isBookable: { type: 'boolean' },
              hasSpecialist: { type: 'boolean' },
              hasService: { type: 'boolean' },
              hasSlot: { type: 'boolean' },
            },
          },
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { orgId } = request.params

      const orgSnap = await db.doc(`organizations/${orgId}`).get()
      if (!orgSnap.exists) {
        return reply.code(404).send({ error: 'Organization not found' })
      }

      const membersSnap = await db.collection(`organizations/${orgId}/members`).get()
      const activeMemberIds = membersSnap.docs
        .filter((d) => {
          const s = d.data().status
          return !s || s === 'active'
        })
        .map((d) => d.id)

      const hasSpecialist = activeMemberIds.length > 0
      if (!hasSpecialist) {
        return {
          ok: true,
          isBookable: false,
          hasSpecialist: false,
          hasService: false,
          hasSlot: false,
        }
      }

      const servicesSnap = await db.collection(`organizations/${orgId}/specialistServices`).get()
      const activeServicesBySpecialist = new Map<string, boolean>()
      for (const d of servicesSnap.docs) {
        const data = d.data()
        if (data.isActive && activeMemberIds.includes(data.specialistId)) {
          activeServicesBySpecialist.set(data.specialistId, true)
        }
      }
      const hasService = activeServicesBySpecialist.size > 0
      if (!hasService) {
        return {
          ok: true,
          isBookable: false,
          hasSpecialist: true,
          hasService: false,
          hasSlot: false,
        }
      }

      let hasSlot = false
      for (const specialistId of activeServicesBySpecialist.keys()) {
        if (await hasUpcomingSlot(db, orgId, specialistId)) {
          hasSlot = true
          break
        }
      }

      return {
        ok: true,
        isBookable: hasSpecialist && hasService && hasSlot,
        hasSpecialist: true,
        hasService: true,
        hasSlot,
      }
    }
  )
}

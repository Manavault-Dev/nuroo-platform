/**
 * Route-level tests for GET /marketplace/organizations/:orgId/booking-readiness.
 * Covers the three independent prerequisites (active specialist, active
 * service, open slot in the next 30 days) and that the endpoint reports
 * false/false/false as soon as an earlier prerequisite is missing, without
 * needing to probe further ones.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

let orgExists = true
let members: Array<{ id: string; status?: string }> = []
let services: Array<{ specialistId: string; isActive: boolean }> = []
let hasAvailabilityTemplate = false
let bookedSlots: Array<{ specialistId: string; date: string; startTime: string; status: string }> =
  []
let blockedPeriods: Array<{
  specialistId: string
  startDate: string
  endDate: string
  startTime?: string
  endTime?: string
}> = []

// Full-week template so, when present, it reliably yields a slot somewhere
// in the next 30 days regardless of what "today" happens to be.
const FULL_WEEK_TEMPLATE = {
  specialistId: 'sp1',
  orgId: 'org1',
  schedule: {
    mon: [{ start: '09:00', end: '12:00' }],
    tue: [{ start: '09:00', end: '12:00' }],
    wed: [{ start: '09:00', end: '12:00' }],
    thu: [{ start: '09:00', end: '12:00' }],
    fri: [{ start: '09:00', end: '12:00' }],
    sat: [{ start: '09:00', end: '12:00' }],
    sun: [{ start: '09:00', end: '12:00' }],
  },
  slotDurationMinutes: 60,
  breakBetweenSlotsMinutes: 0,
  updatedAt: '2025-01-01T00:00:00Z',
}

vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(() => ({
    doc: vi.fn((path: string) => {
      if (path.startsWith('organizations/') && path.split('/').length === 2) {
        return { get: vi.fn().mockResolvedValue({ exists: orgExists }) }
      }
      if (path.includes('/specialistAvailability/')) {
        return {
          get: vi.fn().mockResolvedValue({
            exists: hasAvailabilityTemplate,
            data: () => FULL_WEEK_TEMPLATE,
          }),
        }
      }
      return { get: vi.fn().mockResolvedValue({ exists: false }) }
    }),
    collection: vi.fn((path: string) => {
      if (path.endsWith('/specialistBlocking')) {
        return {
          get: vi.fn().mockResolvedValue({ docs: [] }),
          where: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({
              docs: blockedPeriods.map((b) => ({ data: () => b })),
            }),
          })),
        }
      }
      return {
        get: vi.fn().mockResolvedValue({
          docs: path.endsWith('/members')
            ? members.map((m) => ({ id: m.id, data: () => ({ status: m.status }) }))
            : path.endsWith('/specialistServices')
              ? services.map((s) => ({ data: () => s }))
              : [],
        }),
        where: vi.fn(() => ({
          where: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({
              docs: bookedSlots.map((s) => ({ data: () => s })),
            }),
          })),
        })),
      }
    }),
  })),
}))

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  const { readinessRoute } = await import('../readiness.routes.js')
  await app.register(readinessRoute)
  await app.ready()
  return app
}

describe('GET /marketplace/organizations/:orgId/booking-readiness', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    orgExists = true
    members = []
    services = []
    hasAvailabilityTemplate = false
    bookedSlots = []
    blockedPeriods = []
    app = await buildApp()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns 404 for a nonexistent organization', async () => {
    orgExists = false
    const res = await app.inject({
      method: 'GET',
      url: '/marketplace/organizations/missing/booking-readiness',
    })
    expect(res.statusCode).toBe(404)
  })

  it('is not bookable with zero active specialists', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/marketplace/organizations/org1/booking-readiness',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      isBookable: false,
      hasSpecialist: false,
      hasService: false,
      hasSlot: false,
    })
  })

  it('excludes inactive members from counting as a specialist', async () => {
    members = [{ id: 'sp1', status: 'inactive' }]
    const res = await app.inject({
      method: 'GET',
      url: '/marketplace/organizations/org1/booking-readiness',
    })
    expect(res.json()).toMatchObject({ hasSpecialist: false })
  })

  it('is not bookable when a specialist exists but has no active service', async () => {
    members = [{ id: 'sp1', status: 'active' }]
    const res = await app.inject({
      method: 'GET',
      url: '/marketplace/organizations/org1/booking-readiness',
    })
    expect(res.json()).toMatchObject({
      hasSpecialist: true,
      hasService: false,
      hasSlot: false,
      isBookable: false,
    })
  })

  it('ignores an inactive service', async () => {
    members = [{ id: 'sp1', status: 'active' }]
    services = [{ specialistId: 'sp1', isActive: false }]
    const res = await app.inject({
      method: 'GET',
      url: '/marketplace/organizations/org1/booking-readiness',
    })
    expect(res.json()).toMatchObject({ hasService: false })
  })

  it('is not bookable when specialist+service exist but no availability template', async () => {
    members = [{ id: 'sp1', status: 'active' }]
    services = [{ specialistId: 'sp1', isActive: true }]
    hasAvailabilityTemplate = false
    const res = await app.inject({
      method: 'GET',
      url: '/marketplace/organizations/org1/booking-readiness',
    })
    expect(res.json()).toMatchObject({
      hasSpecialist: true,
      hasService: true,
      hasSlot: false,
      isBookable: false,
    })
  })

  it('is bookable once specialist, service, and an open slot all exist', async () => {
    members = [{ id: 'sp1', status: 'active' }]
    services = [{ specialistId: 'sp1', isActive: true }]
    hasAvailabilityTemplate = true
    const res = await app.inject({
      method: 'GET',
      url: '/marketplace/organizations/org1/booking-readiness',
    })
    expect(res.json()).toMatchObject({
      hasSpecialist: true,
      hasService: true,
      hasSlot: true,
      isBookable: true,
    })
  })

  it('is not bookable when every generated slot in range is already booked', async () => {
    members = [{ id: 'sp1', status: 'active' }]
    services = [{ specialistId: 'sp1', isActive: true }]
    hasAvailabilityTemplate = true
    // Booking every 09:00 slot for the next 30 days blocks all generated slots
    // (the template only opens 09:00-12:00 with 60-min slots => 09:00,10:00,11:00 per day).
    const today = new Date()
    bookedSlots = Array.from({ length: 31 }, (_, i) => {
      const d = new Date(today)
      d.setDate(d.getDate() + i)
      const dateStr = d.toISOString().split('T')[0]
      return ['09:00', '10:00', '11:00'].map((startTime) => ({
        specialistId: 'sp1',
        date: dateStr,
        startTime,
        status: 'booked',
      }))
    }).flat()
    const res = await app.inject({
      method: 'GET',
      url: '/marketplace/organizations/org1/booking-readiness',
    })
    expect(res.json()).toMatchObject({ hasSlot: false, isBookable: false })
  })

  it('is not bookable when the specialist has a full-period vacation block covering the whole window', async () => {
    members = [{ id: 'sp1', status: 'active' }]
    services = [{ specialistId: 'sp1', isActive: true }]
    hasAvailabilityTemplate = true
    const today = new Date().toISOString().split('T')[0]
    const farFuture = new Date()
    farFuture.setDate(farFuture.getDate() + 60)
    blockedPeriods = [
      { specialistId: 'sp1', startDate: today, endDate: farFuture.toISOString().split('T')[0] },
    ]
    const res = await app.inject({
      method: 'GET',
      url: '/marketplace/organizations/org1/booking-readiness',
    })
    expect(res.json()).toMatchObject({ hasSlot: false, isBookable: false })
  })
})

/**
 * GET /marketplace/bookings — the parent's own booking list.
 * The response enriches each booking with orgName/specialistName (resolved
 * once per unique id) since the booking doc itself only stores ids, and the
 * mobile "Мои записи" card needs a "who/where" headline, not just a date.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

const TEST_UID = 'test-parent-uid'

const USER_BOOKINGS: Record<string, { orgId: string }[]> = {
  [TEST_UID]: [{ orgId: 'org_a' }, { orgId: 'org_a' }, { orgId: 'org_b' }],
}

const BOOKING_DOCS: Record<string, Record<string, unknown>> = {
  booking_1: {
    orgId: 'org_a',
    specialistId: 'specialist_1',
    parentId: TEST_UID,
    date: '2026-11-01',
    startTime: '10:00',
    endTime: '11:00',
    status: 'confirmed',
  },
  booking_2: {
    orgId: 'org_a',
    specialistId: 'specialist_1',
    parentId: TEST_UID,
    date: '2026-11-02',
    startTime: '10:00',
    endTime: '11:00',
    status: 'confirmed',
  },
  booking_3: {
    orgId: 'org_b',
    specialistId: 'specialist_2',
    parentId: TEST_UID,
    date: '2026-11-03',
    startTime: '10:00',
    endTime: '11:00',
    status: 'pending',
  },
}

const ORGS: Record<string, { name: string }> = {
  org_a: { name: 'Седеп' },
  org_b: { name: 'Реацентр' },
}

const SPECIALISTS: Record<string, { fullName: string }> = {
  specialist_1: { fullName: 'Айгуль Асанова' },
  specialist_2: { fullName: 'Бакыт Уулу' },
}

let orgReadCount = 0
let specialistReadCount = 0

vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn((path: string) => {
      const indexMatch = path.match(/^userBookings\/(.+)\/items$/)
      if (indexMatch) {
        const uid = indexMatch[1]
        return {
          limit: vi.fn(() => ({
            get: vi.fn(async () => ({
              empty: !(USER_BOOKINGS[uid]?.length > 0),
              docs: (USER_BOOKINGS[uid] ?? []).map((b, i) => ({
                id: `booking_${i + 1}`,
                data: () => b,
              })),
            })),
          })),
        }
      }
      throw new Error(`unexpected collection ${path}`)
    }),
    doc: vi.fn((path: string) => ({
      get: vi.fn(async () => {
        const bookingMatch = path.match(/^organizations\/(.+)\/bookings\/(.+)$/)
        if (bookingMatch) {
          const bookingId = bookingMatch[2]
          const data = BOOKING_DOCS[bookingId]
          return { exists: !!data, data: () => data }
        }
        const orgMatch = path.match(/^organizations\/(.+)$/)
        if (orgMatch) {
          orgReadCount++
          const data = ORGS[orgMatch[1]]
          return { exists: !!data, data: () => data }
        }
        const userMatch = path.match(/^users\/(.+)$/)
        if (userMatch) {
          specialistReadCount++
          const data = SPECIALISTS[userMatch[1]]
          return { exists: !!data, data: () => data }
        }
        throw new Error(`unexpected doc path ${path}`)
      }),
    })),
  })),
}))

async function buildApp(opts: { authenticated?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  if (opts.authenticated !== false) {
    app.addHook('onRequest', async (request) => {
      ;(request as unknown as { user: { uid: string } }).user = { uid: TEST_UID }
    })
  }
  const { bookingRoute } = await import('../booking.routes.js')
  await app.register(bookingRoute)
  await app.ready()
  return app
}

describe('GET /marketplace/bookings', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    orgReadCount = 0
    specialistReadCount = 0
    app = await buildApp()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('rejects an unauthenticated request', async () => {
    const unauthedApp = await buildApp({ authenticated: false })
    const res = await unauthedApp.inject({ method: 'GET', url: '/marketplace/bookings' })
    expect(res.statusCode).toBe(401)
  })

  it('enriches each booking with the org and specialist display name', async () => {
    const res = await app.inject({ method: 'GET', url: '/marketplace/bookings' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.bookings).toHaveLength(3)

    const byId = Object.fromEntries(body.bookings.map((b: { id: string }) => [b.id, b]))
    expect(byId.booking_1).toMatchObject({ orgName: 'Седеп', specialistName: 'Айгуль Асанова' })
    expect(byId.booking_2).toMatchObject({ orgName: 'Седеп', specialistName: 'Айгуль Асанова' })
    expect(byId.booking_3).toMatchObject({ orgName: 'Реацентр', specialistName: 'Бакыт Уулу' })
  })

  it('resolves each unique org/specialist only once, not per booking', async () => {
    await app.inject({ method: 'GET', url: '/marketplace/bookings' })

    // 3 bookings share only 2 orgs and 2 specialists — a naive per-booking
    // lookup would read 3 of each instead.
    expect(orgReadCount).toBe(2)
    expect(specialistReadCount).toBe(2)
  })
})

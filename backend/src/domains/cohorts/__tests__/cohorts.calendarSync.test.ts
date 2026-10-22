/**
 * Unit tests for cohorts.calendarSync.ts — the fan-out logic that keeps
 * enrolled parents' Google Calendars in sync with a cohort's sessions.
 * Mocks calendarSync.service.ts entirely (already covered by its own unit
 * tests) so these tests focus purely on the iteration/fan-out logic: the
 * right parents get the right calls, and tracking docs are written/removed
 * correctly against an in-memory Firestore fake.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CohortDoc, ParticipantDoc, SessionDoc } from '../cohorts.types.js'

// ─── In-memory Firestore fake (supports doc/collection + simple where/get) ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store = new Map<string, any>()

function pathSegments(path: string): string[] {
  return path.split('/')
}

function collectionDocs(
  collectionPath: string
): Array<{ id: string; data: Record<string, unknown> }> {
  const prefix = collectionPath.endsWith('/') ? collectionPath : `${collectionPath}/`
  const results: Array<{ id: string; data: Record<string, unknown> }> = []
  for (const [path, data] of store.entries()) {
    if (!path.startsWith(prefix)) continue
    const rest = path.slice(prefix.length)
    if (rest.includes('/')) continue // not a direct child doc
    results.push({ id: rest, data })
  }
  return results
}

function makeDocRef(path: string) {
  return {
    id: pathSegments(path).at(-1)!,
    get: vi.fn(async () => {
      const data = store.get(path)
      return { exists: data !== undefined, data: () => data, id: pathSegments(path).at(-1)! }
    }),
    set: vi.fn(async (data: Record<string, unknown>) => {
      store.set(path, data)
    }),
    delete: vi.fn(async () => {
      store.delete(path)
    }),
    ref: undefined as unknown, // set below once created, for parity with real QueryDocumentSnapshot
  }
}

function makeCollectionRef(collectionPath: string) {
  let whereFilter: ((data: Record<string, unknown>) => boolean) | null = null
  const api = {
    where: vi.fn((field: string, _op: string, value: unknown) => {
      whereFilter = (data: Record<string, unknown>) => data[field] === value
      return api
    }),
    get: vi.fn(async () => {
      const docs = collectionDocs(collectionPath).filter((d) => !whereFilter || whereFilter(d.data))
      return {
        docs: docs.map((d) => {
          const ref = makeDocRef(`${collectionPath}/${d.id}`)
          return { id: d.id, data: () => d.data, ref }
        }),
      }
    }),
  }
  return api
}

const fakeDb = {
  doc: vi.fn((path: string) => makeDocRef(path)),
  collection: vi.fn((path: string) => makeCollectionRef(path)),
} as unknown as FirebaseFirestore.Firestore

const mockGetParentCalendarAuth = vi.fn()
const mockUpsertCalendarEvent = vi.fn()
const mockUpdateCalendarEvent = vi.fn()
const mockDeleteCalendarEvent = vi.fn()

vi.mock('../../../infrastructure/calendar/calendarSync.service.js', () => ({
  getParentCalendarAuth: (...args: unknown[]) => mockGetParentCalendarAuth(...args),
  upsertCalendarEvent: (...args: unknown[]) => mockUpsertCalendarEvent(...args),
  updateCalendarEvent: (...args: unknown[]) => mockUpdateCalendarEvent(...args),
  deleteCalendarEvent: (...args: unknown[]) => mockDeleteCalendarEvent(...args),
}))

const COHORT: CohortDoc = {
  id: 'cohort_1',
  orgId: 'org_1',
  branchId: null,
  title: 'Speech Therapy Group',
  description: '',
  instructorId: null,
  instructorName: null,
  category: null,
  ageMin: null,
  ageMax: null,
  format: 'offline',
  targetAudience: 'children',
  startDate: '2026-11-01',
  endDate: '2026-12-01',
  price: 0,
  currency: 'KGS',
  maxParticipants: 20,
  enrolledCount: 2,
  status: 'open',
  scheduleType: 'manual',
  recurringTemplate: null,
  coverUrl: null,
  meetingUrl: null,
  meetingEventId: null,
  approvalStatus: null,
  submittedForApprovalAt: null,
  submittedBy: null,
  approvedAt: null,
  approvedBy: null,
  rejectionComment: null,
  orgName: 'Nuroo Center',
  orgLogoUrl: null,
  createdBy: 'admin_1',
  updatedBy: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  publishedAt: null,
}

function session(overrides: Partial<SessionDoc> = {}): SessionDoc {
  return {
    id: 'session_1',
    cohortId: 'cohort_1',
    orgId: 'org_1',
    date: '2026-11-05',
    startTime: '10:00',
    endTime: '11:00',
    format: 'offline',
    meetingUrl: null,
    status: 'scheduled',
    topic: null,
    notes: null,
    postponedFrom: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

function participant(id: string, parentId: string): ParticipantDoc {
  return {
    id,
    cohortId: 'cohort_1',
    orgId: 'org_1',
    childId: `child_${id}`,
    childName: 'Child',
    parentId,
    parentName: 'Parent',
    parentPhone: null,
    status: 'active',
    paymentStatus: 'paid',
    amountPaid: 0,
    totalAmount: 0,
    currency: 'KGS',
    enrolledAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }
}

beforeEach(() => {
  store.clear()
  vi.clearAllMocks()
})

describe('syncSessionCreatedForEnrolledParents', () => {
  it('creates an event only for enrolled parents with calendar connected, skips dropped participants', async () => {
    store.set(
      'organizations/org_1/cohorts/cohort_1/participants/p1',
      participant('p1', 'parent_connected')
    )
    store.set(
      'organizations/org_1/cohorts/cohort_1/participants/p2',
      participant('p2', 'parent_not_connected')
    )
    store.set('organizations/org_1/cohorts/cohort_1/participants/p3', {
      ...participant('p3', 'parent_dropped'),
      status: 'dropped',
    })

    mockGetParentCalendarAuth.mockImplementation(async (parentId: string) =>
      parentId === 'parent_connected'
        ? { connected: true, refreshToken: 'rt-connected' }
        : { connected: false, refreshToken: null }
    )
    mockUpsertCalendarEvent.mockResolvedValue('evt_new')

    const { syncSessionCreatedForEnrolledParents } = await import('../cohorts.calendarSync.js')
    await syncSessionCreatedForEnrolledParents(fakeDb, COHORT, session())

    expect(mockGetParentCalendarAuth).toHaveBeenCalledWith('parent_connected')
    expect(mockGetParentCalendarAuth).not.toHaveBeenCalledWith('parent_dropped')
    expect(mockUpsertCalendarEvent).toHaveBeenCalledTimes(1)
    expect(
      store.get(
        'organizations/org_1/cohorts/cohort_1/sessions/session_1/calendarSync/parent_connected'
      )
    ).toMatchObject({ googleEventId: 'evt_new' })
    expect(
      store.get(
        'organizations/org_1/cohorts/cohort_1/sessions/session_1/calendarSync/parent_not_connected'
      )
    ).toBeUndefined()
  })
})

describe('syncSessionUpdatedForEnrolledParents', () => {
  it('patches the tracked event for every parent with a sync doc for this session', async () => {
    store.set('organizations/org_1/cohorts/cohort_1/sessions/session_1/calendarSync/parent_a', {
      googleEventId: 'evt_a',
    })
    store.set('organizations/org_1/cohorts/cohort_1/sessions/session_1/calendarSync/parent_b', {
      googleEventId: 'evt_b',
    })
    mockGetParentCalendarAuth.mockResolvedValue({ connected: true, refreshToken: 'rt' })

    const { syncSessionUpdatedForEnrolledParents } = await import('../cohorts.calendarSync.js')
    await syncSessionUpdatedForEnrolledParents(
      fakeDb,
      COHORT,
      session({ date: '2026-11-10', startTime: '14:00', endTime: '15:00' })
    )

    expect(mockUpdateCalendarEvent).toHaveBeenCalledTimes(2)
    expect(mockUpdateCalendarEvent).toHaveBeenCalledWith('rt', 'evt_a', {
      startDateTime: '2026-11-10T14:00:00',
      endDateTime: '2026-11-10T15:00:00',
    })
  })
})

describe('syncSessionCancelledForEnrolledParents', () => {
  it('deletes every tracked event and removes the tracking docs', async () => {
    store.set('organizations/org_1/cohorts/cohort_1/sessions/session_1/calendarSync/parent_a', {
      googleEventId: 'evt_a',
    })
    mockGetParentCalendarAuth.mockResolvedValue({ connected: true, refreshToken: 'rt' })

    const { syncSessionCancelledForEnrolledParents } = await import('../cohorts.calendarSync.js')
    await syncSessionCancelledForEnrolledParents(fakeDb, COHORT, session({ status: 'cancelled' }))

    expect(mockDeleteCalendarEvent).toHaveBeenCalledWith('rt', 'evt_a')
    expect(
      store.get('organizations/org_1/cohorts/cohort_1/sessions/session_1/calendarSync/parent_a')
    ).toBeUndefined()
  })

  it('still removes the tracking doc even if the parent disconnected calendar in the meantime', async () => {
    store.set('organizations/org_1/cohorts/cohort_1/sessions/session_1/calendarSync/parent_a', {
      googleEventId: 'evt_a',
    })
    mockGetParentCalendarAuth.mockResolvedValue({ connected: false, refreshToken: null })

    const { syncSessionCancelledForEnrolledParents } = await import('../cohorts.calendarSync.js')
    await syncSessionCancelledForEnrolledParents(fakeDb, COHORT, session({ status: 'cancelled' }))

    expect(mockDeleteCalendarEvent).not.toHaveBeenCalled()
    expect(
      store.get('organizations/org_1/cohorts/cohort_1/sessions/session_1/calendarSync/parent_a')
    ).toBeUndefined()
  })
})

describe('syncNewParticipantAcrossSessions', () => {
  it('creates an event for every non-cancelled session, skips cancelled ones', async () => {
    store.set(
      'organizations/org_1/cohorts/cohort_1/sessions/s1',
      session({ id: 's1', status: 'scheduled' })
    )
    store.set(
      'organizations/org_1/cohorts/cohort_1/sessions/s2',
      session({ id: 's2', status: 'cancelled' })
    )
    mockGetParentCalendarAuth.mockResolvedValue({ connected: true, refreshToken: 'rt' })
    mockUpsertCalendarEvent.mockResolvedValue('evt_new')

    const { syncNewParticipantAcrossSessions } = await import('../cohorts.calendarSync.js')
    await syncNewParticipantAcrossSessions(fakeDb, COHORT, 'new_parent')

    expect(mockUpsertCalendarEvent).toHaveBeenCalledTimes(1)
    expect(
      store.get('organizations/org_1/cohorts/cohort_1/sessions/s1/calendarSync/new_parent')
    ).toMatchObject({ googleEventId: 'evt_new' })
    expect(
      store.get('organizations/org_1/cohorts/cohort_1/sessions/s2/calendarSync/new_parent')
    ).toBeUndefined()
  })

  it('does nothing when the parent has no calendar connected', async () => {
    store.set('organizations/org_1/cohorts/cohort_1/sessions/s1', session({ id: 's1' }))
    mockGetParentCalendarAuth.mockResolvedValue({ connected: false, refreshToken: null })

    const { syncNewParticipantAcrossSessions } = await import('../cohorts.calendarSync.js')
    await syncNewParticipantAcrossSessions(fakeDb, COHORT, 'new_parent')

    expect(mockUpsertCalendarEvent).not.toHaveBeenCalled()
  })
})

describe('syncDroppedParticipantAcrossSessions', () => {
  it('deletes the parent events across every non-cancelled session and clears tracking docs', async () => {
    store.set(
      'organizations/org_1/cohorts/cohort_1/sessions/s1',
      session({ id: 's1', status: 'scheduled' })
    )
    store.set('organizations/org_1/cohorts/cohort_1/sessions/s1/calendarSync/dropping_parent', {
      googleEventId: 'evt_s1',
    })
    mockGetParentCalendarAuth.mockResolvedValue({ connected: true, refreshToken: 'rt' })

    const { syncDroppedParticipantAcrossSessions } = await import('../cohorts.calendarSync.js')
    await syncDroppedParticipantAcrossSessions(fakeDb, 'org_1', 'cohort_1', 'dropping_parent')

    expect(mockDeleteCalendarEvent).toHaveBeenCalledWith('rt', 'evt_s1')
    expect(
      store.get('organizations/org_1/cohorts/cohort_1/sessions/s1/calendarSync/dropping_parent')
    ).toBeUndefined()
  })

  it('skips a session the parent was never synced for', async () => {
    store.set(
      'organizations/org_1/cohorts/cohort_1/sessions/s1',
      session({ id: 's1', status: 'scheduled' })
    )
    // no calendarSync doc for this parent on s1

    const { syncDroppedParticipantAcrossSessions } = await import('../cohorts.calendarSync.js')
    await syncDroppedParticipantAcrossSessions(fakeDb, 'org_1', 'cohort_1', 'never_synced_parent')

    expect(mockDeleteCalendarEvent).not.toHaveBeenCalled()
  })
})

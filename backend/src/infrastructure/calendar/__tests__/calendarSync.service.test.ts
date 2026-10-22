/**
 * Unit tests for calendarSync.service.ts — the Google Calendar event
 * create/update/delete wrapper used by booking/cohort/event sync. Mocks
 * `googleapis` (no mock existed for it anywhere in this codebase before)
 * and the Firestore `users/{uid}/integrations/google_calendar` lookup.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const store = new Map<string, Record<string, unknown> | undefined>()

vi.mock('../../database/firebase.js', () => ({
  getFirestore: vi.fn(() => ({
    doc: vi.fn((path: string) => ({
      get: vi.fn(async () => {
        const data = store.get(path)
        return { exists: data !== undefined, data: () => data }
      }),
    })),
  })),
}))

const mockInsert = vi.fn()
const mockPatch = vi.fn()
const mockDelete = vi.fn()

vi.mock('googleapis', () => ({
  google: {
    auth: {
      // Must be a real constructor (used with `new`) — not an arrow function.
      OAuth2: vi.fn(function (this: { setCredentials: () => void }) {
        this.setCredentials = vi.fn()
      }),
    },
    calendar: vi.fn(() => ({
      events: {
        insert: (...args: unknown[]) => mockInsert(...args),
        patch: (...args: unknown[]) => mockPatch(...args),
        delete: (...args: unknown[]) => mockDelete(...args),
      },
    })),
  },
}))

process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'test-client-id'
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret'

describe('getParentCalendarAuth', () => {
  beforeEach(() => {
    store.clear()
  })

  it('returns not-connected when no integration doc exists', async () => {
    const { getParentCalendarAuth } = await import('../calendarSync.service.js')
    const result = await getParentCalendarAuth('parent_1')
    expect(result).toEqual({ connected: false, refreshToken: null })
  })

  it('returns not-connected when connected=false even if a refreshToken lingers', async () => {
    store.set('users/parent_1/integrations/google_calendar', {
      connected: false,
      refreshToken: 'stale-token',
    })
    const { getParentCalendarAuth } = await import('../calendarSync.service.js')
    const result = await getParentCalendarAuth('parent_1')
    expect(result).toEqual({ connected: false, refreshToken: null })
  })

  it('returns the refresh token when connected', async () => {
    store.set('users/parent_1/integrations/google_calendar', {
      connected: true,
      refreshToken: 'rt-123',
    })
    const { getParentCalendarAuth } = await import('../calendarSync.service.js')
    const result = await getParentCalendarAuth('parent_1')
    expect(result).toEqual({ connected: true, refreshToken: 'rt-123' })
  })
})

describe('upsertCalendarEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts an event on the primary calendar and returns its id', async () => {
    mockInsert.mockResolvedValue({ data: { id: 'evt_abc' } })
    const { upsertCalendarEvent } = await import('../calendarSync.service.js')

    const id = await upsertCalendarEvent('rt-123', {
      title: 'Session with Dr. Smith',
      startDateTime: '2026-11-01T10:00:00',
      endDateTime: '2026-11-01T11:00:00',
    })

    expect(id).toBe('evt_abc')
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: 'primary',
        requestBody: expect.objectContaining({
          summary: 'Session with Dr. Smith',
          start: { dateTime: '2026-11-01T10:00:00', timeZone: 'Asia/Bishkek' },
          end: { dateTime: '2026-11-01T11:00:00', timeZone: 'Asia/Bishkek' },
        }),
      })
    )
  })

  it('throws when Google does not return an event id', async () => {
    mockInsert.mockResolvedValue({ data: {} })
    const { upsertCalendarEvent } = await import('../calendarSync.service.js')

    await expect(
      upsertCalendarEvent('rt-123', {
        title: 'Session',
        startDateTime: '2026-11-01T10:00:00',
        endDateTime: '2026-11-01T11:00:00',
      })
    ).rejects.toThrow('did not return an event id')
  })
})

describe('updateCalendarEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('patches only start/end when no title/description/location given', async () => {
    mockPatch.mockResolvedValue({ data: {} })
    const { updateCalendarEvent } = await import('../calendarSync.service.js')

    await updateCalendarEvent('rt-123', 'evt_abc', {
      startDateTime: '2026-11-02T14:00:00',
      endDateTime: '2026-11-02T15:00:00',
    })

    expect(mockPatch).toHaveBeenCalledWith({
      calendarId: 'primary',
      eventId: 'evt_abc',
      requestBody: {
        start: { dateTime: '2026-11-02T14:00:00', timeZone: 'Asia/Bishkek' },
        end: { dateTime: '2026-11-02T15:00:00', timeZone: 'Asia/Bishkek' },
      },
    })
  })
})

describe('deleteCalendarEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes the event by id', async () => {
    mockDelete.mockResolvedValue({})
    const { deleteCalendarEvent } = await import('../calendarSync.service.js')

    await deleteCalendarEvent('rt-123', 'evt_abc')

    expect(mockDelete).toHaveBeenCalledWith({ calendarId: 'primary', eventId: 'evt_abc' })
  })

  it('treats a 404/410 (already gone) as success, not an error', async () => {
    mockDelete.mockRejectedValue({ code: 410 })
    const { deleteCalendarEvent } = await import('../calendarSync.service.js')

    await expect(deleteCalendarEvent('rt-123', 'evt_abc')).resolves.toBeUndefined()
  })

  it('rethrows other errors', async () => {
    mockDelete.mockRejectedValue({ code: 500, message: 'boom' })
    const { deleteCalendarEvent } = await import('../calendarSync.service.js')

    await expect(deleteCalendarEvent('rt-123', 'evt_abc')).rejects.toBeTruthy()
  })
})

/**
 * calendarSync.service.ts
 *
 * Standalone Google Calendar event sync for parents. Kept separate from
 * event.dispatcher.ts (push/email): that dispatcher is fire-and-forget with
 * no return value, built around rendered text templates. Calendar sync needs
 * structured start/end/location AND must return a googleEventId that the
 * caller persists onto the source doc (booking/session/registration) for
 * later update/delete — a different contract, so it isn't forced in there.
 *
 * Callers are responsible for:
 *   - checking getParentCalendarAuth() before deciding to act (no-op if the
 *     parent hasn't connected their calendar)
 *   - calling these fire-and-forget (never block the HTTP response on a
 *     Google API round-trip)
 *   - persisting the returned googleEventId onto their own source doc
 */

import { getFirestore } from '../database/firebase.js'
import { getCalendarWithRefreshToken } from '../meetings/google-meet.js'

export interface CalendarEventInput {
  title: string
  description?: string
  location?: string
  /** ISO 8601 datetime */
  startDateTime: string
  /** ISO 8601 datetime */
  endDateTime: string
  timeZone?: string
}

export interface ParentCalendarAuth {
  connected: boolean
  refreshToken: string | null
}

/** Looks up whether a parent has Google Calendar connected (users/{uid}/integrations/google_calendar). */
export async function getParentCalendarAuth(parentId: string): Promise<ParentCalendarAuth> {
  const db = getFirestore()
  const snap = await db.doc(`users/${parentId}/integrations/google_calendar`).get()
  if (!snap.exists) return { connected: false, refreshToken: null }

  const data = snap.data()!
  if (!data.connected || !data.refreshToken) return { connected: false, refreshToken: null }

  return { connected: true, refreshToken: data.refreshToken as string }
}

/** Creates a new event on the parent's primary calendar. Returns the Google event id. */
export async function upsertCalendarEvent(
  refreshToken: string,
  input: CalendarEventInput
): Promise<string> {
  const calendar = getCalendarWithRefreshToken(refreshToken)
  const tz = input.timeZone ?? 'Asia/Bishkek'

  const event = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: input.title,
      description: input.description,
      location: input.location,
      start: { dateTime: input.startDateTime, timeZone: tz },
      end: { dateTime: input.endDateTime, timeZone: tz },
    },
  })

  if (!event.data.id) throw new Error('Google Calendar did not return an event id')
  return event.data.id
}

/**
 * Patches an existing event (e.g. after a booking reschedule). Only the
 * fields provided are changed — omitted fields (title/description/location)
 * are left as-is, since this is a partial `events.patch`, not a replace.
 */
export async function updateCalendarEvent(
  refreshToken: string,
  googleEventId: string,
  input: Partial<CalendarEventInput> & Pick<CalendarEventInput, 'startDateTime' | 'endDateTime'>
): Promise<void> {
  const calendar = getCalendarWithRefreshToken(refreshToken)
  const tz = input.timeZone ?? 'Asia/Bishkek'

  await calendar.events.patch({
    calendarId: 'primary',
    eventId: googleEventId,
    requestBody: {
      ...(input.title !== undefined ? { summary: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
      start: { dateTime: input.startDateTime, timeZone: tz },
      end: { dateTime: input.endDateTime, timeZone: tz },
    },
  })
}

/** Deletes an event (e.g. after a booking/session cancel). Treats an already-gone event as success. */
export async function deleteCalendarEvent(
  refreshToken: string,
  googleEventId: string
): Promise<void> {
  const calendar = getCalendarWithRefreshToken(refreshToken)
  try {
    await calendar.events.delete({ calendarId: 'primary', eventId: googleEventId })
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code
    if (code === 410 || code === 404) return // already gone on Google's side
    throw err
  }
}

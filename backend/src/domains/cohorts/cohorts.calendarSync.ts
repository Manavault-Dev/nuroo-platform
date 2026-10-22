/**
 * cohorts.calendarSync.ts — fan-out helpers for keeping enrolled parents'
 * Google Calendars in sync with a cohort's sessions.
 *
 * A cohort session can have N enrolled parents, and a parent can enroll
 * before or after a given session exists — so, unlike bookings (1:1), this
 * needs its own per-(session, parent) tracking doc: COL.calendarSyncDoc.
 * All functions here are meant to be called fire-and-forget from the route
 * handlers (never block the HTTP response on N Google API round-trips).
 */
import type admin from 'firebase-admin'
import { COL } from './cohorts.helpers.js'
import type { CohortDoc, ParticipantDoc, SessionDoc } from './cohorts.types.js'
import {
  getParentCalendarAuth,
  upsertCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from '../../infrastructure/calendar/calendarSync.service.js'

function sessionEventInput(cohort: CohortDoc, session: SessionDoc) {
  return {
    title: `${cohort.title} — ${cohort.orgName ?? 'Nuroo'}`,
    description: session.topic ?? undefined,
    location:
      session.format === 'online'
        ? (session.meetingUrl ?? undefined)
        : (cohort.orgName ?? undefined),
    startDateTime: `${session.date}T${session.startTime}:00`,
    endDateTime: `${session.date}T${session.endTime}:00`,
  }
}

async function getActiveParentIds(
  db: admin.firestore.Firestore,
  orgId: string,
  cohortId: string
): Promise<string[]> {
  const snap = await db
    .collection(COL.participants(orgId, cohortId))
    .where('status', '==', 'active')
    .get()
  return snap.docs.map((d) => (d.data() as ParticipantDoc).parentId)
}

/** A new session was added to a cohort — create an event for every already-enrolled parent. */
export async function syncSessionCreatedForEnrolledParents(
  db: admin.firestore.Firestore,
  cohort: CohortDoc,
  session: SessionDoc
): Promise<void> {
  const parentIds = await getActiveParentIds(db, cohort.orgId, cohort.id)
  await Promise.all(
    parentIds.map(async (parentId) => {
      try {
        const auth = await getParentCalendarAuth(parentId)
        if (!auth.connected || !auth.refreshToken) return
        const googleEventId = await upsertCalendarEvent(
          auth.refreshToken,
          sessionEventInput(cohort, session)
        )
        await db.doc(COL.calendarSyncDoc(cohort.orgId, cohort.id, session.id, parentId)).set({
          googleEventId,
          updatedAt: new Date().toISOString(),
        })
      } catch (err) {
        console.error('[Cohorts] Calendar sync (session created) failed for parent', parentId, err)
      }
    })
  )
}

/** A session's date/time changed (reschedule/postpone) — update every tracked parent's event. */
export async function syncSessionUpdatedForEnrolledParents(
  db: admin.firestore.Firestore,
  cohort: CohortDoc,
  session: SessionDoc
): Promise<void> {
  const syncSnap = await db.collection(COL.calendarSync(cohort.orgId, cohort.id, session.id)).get()
  await Promise.all(
    syncSnap.docs.map(async (d) => {
      const parentId = d.id
      const { googleEventId } = d.data() as { googleEventId: string }
      try {
        const auth = await getParentCalendarAuth(parentId)
        if (!auth.connected || !auth.refreshToken) return
        await updateCalendarEvent(auth.refreshToken, googleEventId, {
          startDateTime: `${session.date}T${session.startTime}:00`,
          endDateTime: `${session.date}T${session.endTime}:00`,
        })
      } catch (err) {
        console.error('[Cohorts] Calendar sync (session updated) failed for parent', parentId, err)
      }
    })
  )
}

/** A session was cancelled — delete every tracked parent's event and the tracking docs. */
export async function syncSessionCancelledForEnrolledParents(
  db: admin.firestore.Firestore,
  cohort: CohortDoc,
  session: SessionDoc
): Promise<void> {
  const syncSnap = await db.collection(COL.calendarSync(cohort.orgId, cohort.id, session.id)).get()
  await Promise.all(
    syncSnap.docs.map(async (d) => {
      const parentId = d.id
      const { googleEventId } = d.data() as { googleEventId: string }
      try {
        const auth = await getParentCalendarAuth(parentId)
        if (auth.connected && auth.refreshToken) {
          await deleteCalendarEvent(auth.refreshToken, googleEventId)
        }
      } catch (err) {
        console.error(
          '[Cohorts] Calendar sync (session cancelled) failed for parent',
          parentId,
          err
        )
      } finally {
        await d.ref.delete().catch(() => {})
      }
    })
  )
}

/** A parent just enrolled — create events for every currently-scheduled session of the cohort. */
export async function syncNewParticipantAcrossSessions(
  db: admin.firestore.Firestore,
  cohort: CohortDoc,
  parentId: string
): Promise<void> {
  try {
    const auth = await getParentCalendarAuth(parentId)
    if (!auth.connected || !auth.refreshToken) return

    const sessionsSnap = await db.collection(COL.sessions(cohort.orgId, cohort.id)).get()
    const sessions = sessionsSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<SessionDoc, 'id'>) }))
      .filter((s) => s.status !== 'cancelled')

    await Promise.all(
      sessions.map(async (session) => {
        try {
          const googleEventId = await upsertCalendarEvent(
            auth.refreshToken!,
            sessionEventInput(cohort, session)
          )
          await db.doc(COL.calendarSyncDoc(cohort.orgId, cohort.id, session.id, parentId)).set({
            googleEventId,
            updatedAt: new Date().toISOString(),
          })
        } catch (err) {
          console.error(
            '[Cohorts] Calendar sync (new participant) failed for session',
            session.id,
            err
          )
        }
      })
    )
  } catch (err) {
    console.error('[Cohorts] Calendar sync (new participant) failed for parent', parentId, err)
  }
}

/** A parent dropped out — delete their events across every non-cancelled session of the cohort. */
export async function syncDroppedParticipantAcrossSessions(
  db: admin.firestore.Firestore,
  orgId: string,
  cohortId: string,
  parentId: string
): Promise<void> {
  try {
    const auth = await getParentCalendarAuth(parentId)

    const sessionsSnap = await db.collection(COL.sessions(orgId, cohortId)).get()
    const sessionIds = sessionsSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<SessionDoc, 'id'>) }))
      .filter((s) => s.status !== 'cancelled')
      .map((s) => s.id)

    await Promise.all(
      sessionIds.map(async (sessionId) => {
        const syncRef = db.doc(COL.calendarSyncDoc(orgId, cohortId, sessionId, parentId))
        const syncSnap = await syncRef.get()
        if (!syncSnap.exists) return
        const { googleEventId } = syncSnap.data() as { googleEventId: string }
        try {
          if (auth.connected && auth.refreshToken) {
            await deleteCalendarEvent(auth.refreshToken, googleEventId)
          }
        } catch (err) {
          console.error(
            '[Cohorts] Calendar sync (participant dropped) failed for session',
            sessionId,
            err
          )
        } finally {
          await syncRef.delete().catch(() => {})
        }
      })
    )
  } catch (err) {
    console.error('[Cohorts] Calendar sync (participant dropped) failed for parent', parentId, err)
  }
}

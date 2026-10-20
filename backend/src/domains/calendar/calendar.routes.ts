/**
 * Google Calendar OAuth routes for specialists and parents.
 *
 * Flow:
 *   1. User requests connect URL        → GET /calendar/connect?role=parent|specialist
 *   2. Google redirects back            → GET /calendar/callback?code=...&state=...
 *   3. Backend exchanges code → tokens  → saves refreshToken in Firestore
 *   4. User is now connected            → GET /calendar/status?role=...
 *   5. Disconnect                       → DELETE /calendar/disconnect?role=...
 *
 * `role` only ever picks which of the CALLER'S OWN doc paths gets read/written
 * (never another uid's), so a client-supplied value carries no cross-user risk.
 */

import type { FastifyPluginAsync } from 'fastify'
import { getFirestore } from '../../infrastructure/database/firebase.js'
import {
  getOAuthConsentUrl,
  exchangeCodeForTokens,
} from '../../infrastructure/meetings/google-meet.js'

const RATE = { max: 30, timeWindow: '1 minute' }

type CalendarRole = 'parent' | 'specialist'

const toRole = (value: unknown): CalendarRole => (value === 'parent' ? 'parent' : 'specialist')

/** Firestore path: specialists/{uid}/integrations/google_calendar, or users/{uid}/... for parents */
const calendarDocPath = (uid: string, role: CalendarRole) =>
  role === 'parent'
    ? `users/${uid}/integrations/google_calendar`
    : `specialists/${uid}/integrations/google_calendar`

export const calendarRoutes: FastifyPluginAsync = async (fastify) => {
  const db = getFirestore()

  // ── GET /calendar/connect ─────────────────────────────────────────────────
  // Returns the Google OAuth consent URL for the authenticated user.

  fastify.get<{ Querystring: { role?: string } }>(
    '/calendar/connect',
    { config: { rateLimit: RATE } },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })

      const uid = request.user.uid
      const role = toRole(request.query.role)
      const state = Buffer.from(JSON.stringify({ uid, role, ts: Date.now() })).toString('base64url')

      try {
        const url = getOAuthConsentUrl(state)
        return { ok: true, url }
      } catch (err: any) {
        return reply.code(503).send({ error: err.message })
      }
    }
  )

  // ── GET /calendar/callback ────────────────────────────────────────────────
  // Google redirects here after specialist approves access.

  fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/calendar/callback',
    { config: { rateLimit: RATE } },
    async (request, reply) => {
      const { code, state, error } = request.query

      // Best-effort role decode from state, even on the access_denied path —
      // Google echoes back the original `state` regardless of outcome.
      const roleFromState = (): CalendarRole => {
        try {
          return toRole(JSON.parse(Buffer.from(state ?? '', 'base64url').toString()).role)
        } catch {
          return 'specialist'
        }
      }
      const errorRedirect = (reason: string, role: CalendarRole) =>
        role === 'parent'
          ? `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://usenuroo.com'}/calendar-connected?error=${reason}`
          : `${process.env.NEXT_PUBLIC_B2B_URL ?? ''}/b2b/integrations?error=${reason}`

      if (error) {
        return reply.redirect(errorRedirect('access_denied', roleFromState()))
      }

      if (!code || !state) {
        return reply.code(400).send({ error: 'Missing code or state' })
      }

      // Decode state to get uid/role
      let uid: string
      let role: CalendarRole
      try {
        const decoded = JSON.parse(Buffer.from(state, 'base64url').toString())
        uid = decoded.uid
        role = toRole(decoded.role) // absent on old in-flight states → defaults to specialist
        if (!uid) throw new Error('Missing uid in state')

        // Reject stale states (> 10 min)
        if (Date.now() - decoded.ts > 10 * 60 * 1000) {
          throw new Error('State expired')
        }
      } catch {
        return reply.code(400).send({ error: 'Invalid state parameter' })
      }

      const successRedirect =
        role === 'parent'
          ? `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://usenuroo.com'}/calendar-connected?success=1`
          : `${process.env.NEXT_PUBLIC_B2B_URL ?? ''}/b2b/integrations?success=1`

      try {
        const { refreshToken, email } = await exchangeCodeForTokens(code)

        await db.doc(calendarDocPath(uid, role)).set({
          connected: true,
          googleEmail: email,
          refreshToken, // stored encrypted in prod via KMS ideally
          connectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })

        return reply.redirect(successRedirect)
      } catch (err: any) {
        fastify.log.error({ err }, 'Google Calendar OAuth callback failed')
        return reply.redirect(errorRedirect('token_exchange', role))
      }
    }
  )

  // ── GET /calendar/status ──────────────────────────────────────────────────
  // Returns connection status for the authenticated user.

  fastify.get<{ Querystring: { role?: string } }>(
    '/calendar/status',
    { config: { rateLimit: RATE } },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })

      const role = toRole(request.query.role)
      const snap = await db.doc(calendarDocPath(request.user.uid, role)).get()

      if (!snap.exists || !snap.data()?.connected) {
        return { ok: true, connected: false }
      }

      const data = snap.data()!
      return {
        ok: true,
        connected: true,
        googleEmail: data.googleEmail ?? null,
        connectedAt: data.connectedAt ?? null,
      }
    }
  )

  // ── DELETE /calendar/disconnect ───────────────────────────────────────────
  // Revokes access and removes stored tokens.

  fastify.delete<{ Querystring: { role?: string } }>(
    '/calendar/disconnect',
    { config: { rateLimit: RATE } },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })

      const role = toRole(request.query.role)
      await db.doc(calendarDocPath(request.user.uid, role)).set({
        connected: false,
        googleEmail: null,
        refreshToken: null,
        disconnectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      return { ok: true }
    }
  )
}

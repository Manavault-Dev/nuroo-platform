import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify'
import admin from 'firebase-admin'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from '../../infrastructure/database/firebase.js'
import { getEmailProvider } from '../../modules/email/resend.provider.js'
import { trialEndedTemplate, trialEndingTemplate } from '../../modules/email/email.templates.js'

/**
 * Scheduled trial-expiration notifications.
 *
 * Triggered by a daily cron (see .github/workflows/trial-notifications.yml)
 * hitting this endpoint — runs inside the already-deployed backend so it
 * reuses its existing Firebase Admin + Resend credentials instead of needing
 * a separate set of secrets in CI.
 *
 * Scans every org with billing.status === 'trialing' and sends:
 *   - a "your free access ends in N days" email once, when N first drops to
 *     REMINDER_DAYS_THRESHOLD or below (idempotent via
 *     billing.trialEndingNotifiedAt)
 *   - a "your free access has ended" email once, the first time the scan
 *     runs after trialEndsAt has passed (idempotent via
 *     billing.trialEndedNotifiedAt)
 *
 * Access itself is already enforced elsewhere (getSubscriptionStatus) —
 * this route only sends the notification, it never grants or revokes access.
 */

const REMINDER_DAYS_THRESHOLD = 7

interface OrgContact {
  email: string
  name: string
}

async function resolveOrgAdminContact(
  db: FirebaseFirestore.Firestore,
  orgData: FirebaseFirestore.DocumentData
): Promise<OrgContact | null> {
  const uid = orgData.createdBy as string | undefined
  if (!uid) return null

  try {
    const [authUser, specialistSnap] = await Promise.all([
      getAuth().getUser(uid),
      db.doc(`specialists/${uid}`).get(),
    ])
    if (!authUser.email) return null

    const specialistData = specialistSnap.exists ? specialistSnap.data() : null
    const name =
      (specialistData?.fullName as string) ||
      (specialistData?.name as string) ||
      authUser.email.split('@')[0]

    return { email: authUser.email, name }
  } catch {
    return null
  }
}

export async function runTrialNotificationScan(log: FastifyBaseLogger) {
  const db = getFirestore()
  const snap = await db.collection('organizations').where('billing.status', '==', 'trialing').get()

  let endingSoonSent = 0
  let endedSent = 0
  let skippedNoContact = 0
  let errors = 0

  for (const doc of snap.docs) {
    const data = doc.data()
    const trialEndsAt = data.billing?.trialEndsAt?.toDate?.() as Date | undefined
    if (!trialEndsAt) continue

    const daysRemaining = Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    const alreadyNotifiedEnding = data.billing?.trialEndingNotifiedAt !== undefined
    const alreadyNotifiedEnded = data.billing?.trialEndedNotifiedAt !== undefined
    const orgName = (data.name as string) || doc.id

    try {
      if (daysRemaining <= 0) {
        if (alreadyNotifiedEnded) continue
        const contact = await resolveOrgAdminContact(db, data)
        if (!contact) {
          skippedNoContact++
          continue
        }
        const { subject, html } = trialEndedTemplate({
          orgAdminName: contact.name,
          orgName,
          orgId: doc.id,
        })
        await getEmailProvider().send({ to: contact.email, subject, html })
        await doc.ref.set(
          { billing: { trialEndedNotifiedAt: admin.firestore.Timestamp.now() } },
          { merge: true }
        )
        endedSent++
      } else if (daysRemaining <= REMINDER_DAYS_THRESHOLD) {
        if (alreadyNotifiedEnding) continue
        const contact = await resolveOrgAdminContact(db, data)
        if (!contact) {
          skippedNoContact++
          continue
        }
        const { subject, html } = trialEndingTemplate({
          orgAdminName: contact.name,
          orgName,
          daysRemaining,
          orgId: doc.id,
        })
        await getEmailProvider().send({ to: contact.email, subject, html })
        await doc.ref.set(
          { billing: { trialEndingNotifiedAt: admin.firestore.Timestamp.now() } },
          { merge: true }
        )
        endingSoonSent++
      }
    } catch (err) {
      errors++
      log.error({ err, orgId: doc.id }, 'Failed to send trial notification email')
    }
  }

  return { scanned: snap.size, endingSoonSent, endedSent, skippedNoContact, errors }
}

export const trialNotificationsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Querystring: { secret?: string } }>(
    '/internal/cron/trial-notifications',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const expected = process.env.CRON_SECRET
      if (!expected) {
        fastify.log.error('CRON_SECRET is not set — rejecting trial-notifications cron call')
        return reply.code(503).send({ error: 'Cron endpoint not configured' })
      }
      if (request.query.secret !== expected) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const result = await runTrialNotificationScan(fastify.log)
      return { ok: true, ...result }
    }
  )
}

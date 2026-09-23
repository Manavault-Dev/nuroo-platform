/**
 * Migration: give every org that is currently "at risk" of losing Business
 * access (old binary nurooPlan model grants it, but the real subscription
 * model has no active plan/trial) a fresh 90-day grace trial, so switching
 * the frontend's usePlanGate() to the real model doesn't break anyone
 * without warning.
 *
 * Re-derives the at-risk list live (same logic as auditPlanMismatch.ts) so
 * it only touches orgs that still match at run time. Writes
 * organizations/{orgId}.billing = { status: 'trialing', trialEndsAt: <+90d>,
 * ...} via merge — does not touch the Stripe-managed billing/current
 * subcollection, and skips (with a warning) any org that unexpectedly
 * already has one, since that would take precedence and make this write a
 * no-op for them.
 *
 * Usage:
 *   npx tsx scripts/extendTrialForLegacyOrgs.ts           # dry run (default)
 *   npx tsx scripts/extendTrialForLegacyOrgs.ts --apply    # actually write
 */
import { initializeFirebaseAdmin, getFirestore } from '../src/infrastructure/database/firebase.js'
import { getSubscriptionStatus } from '../src/domains/payments/planLimits.js'
import admin from 'firebase-admin'

const GRACE_TRIAL_DAYS = 90

async function main() {
  initializeFirebaseAdmin()
  const db = getFirestore()
  const apply = process.argv.includes('--apply')

  console.log(
    apply ? '\n🚀 APPLYING migration (real writes)\n' : '\n🔍 DRY RUN (pass --apply to write)\n'
  )

  const snap = await db.collection('organizations').get()
  console.log(`📊 Scanning ${snap.size} organizations...\n`)

  const trialEndsAt = new Date()
  trialEndsAt.setDate(trialEndsAt.getDate() + GRACE_TRIAL_DAYS)
  console.log(`   New trialEndsAt for all migrated orgs: ${trialEndsAt.toISOString()}\n`)

  let migrated = 0
  let skippedAlreadyOk = 0
  let skippedHasSubcollection = 0

  for (const doc of snap.docs) {
    const orgId = doc.id
    const data = doc.data()
    const nurooPlan = data.nurooPlan
    const oldModelGrantsBusiness = nurooPlan !== 'nuroo'

    const status = await getSubscriptionStatus(orgId)
    if (!oldModelGrantsBusiness || status.active) {
      skippedAlreadyOk++
      continue
    }

    // Guard: if a real Stripe-managed billing/current doc exists, our
    // top-level `billing` map write would be shadowed and do nothing.
    const billingCurrentSnap = await db.doc(`organizations/${orgId}/billing/current`).get()
    if (billingCurrentSnap.exists) {
      console.log(
        `   ⚠️  SKIPPING "${data.name || orgId}" (${orgId}) — has a billing/current doc, needs manual review`
      )
      skippedHasSubcollection++
      continue
    }

    console.log(
      `   ${apply ? '✅' : '·'} "${data.name || orgId}" (${orgId}) — granting trial until ${trialEndsAt.toISOString().slice(0, 10)}`
    )

    if (apply) {
      await db.doc(`organizations/${orgId}`).set(
        {
          billing: {
            status: 'trialing',
            trialEndsAt: admin.firestore.Timestamp.fromDate(trialEndsAt),
            legacyGraceExtension: true,
            legacyGraceExtensionAppliedAt: admin.firestore.Timestamp.now(),
          },
        },
        { merge: true }
      )
    }

    migrated++
  }

  console.log(`\n📝 ${apply ? 'Migrated' : 'Would migrate'}: ${migrated}`)
  console.log(`   Already fine (no action needed): ${skippedAlreadyOk}`)
  console.log(`   Skipped (has billing/current, needs manual review): ${skippedHasSubcollection}\n`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ Error:', e)
    process.exit(1)
  })

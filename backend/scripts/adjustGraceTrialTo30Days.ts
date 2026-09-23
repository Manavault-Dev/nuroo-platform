/**
 * Correction: the initial legacy-org grace trial (extendTrialForLegacyOrgs.ts)
 * used 90 days, inconsistent with the product's standard 30-day trial
 * (FREE_TRIAL_DAYS in planLimits.ts, and the "30 days free" pricing copy).
 * This finds every org already marked with billing.legacyGraceExtension ===
 * true and rewrites trialEndsAt to 30 days from today instead, so it's
 * consistent with the standard trial everyone else gets.
 *
 * Nothing has been communicated to any org yet, so this is safe to correct.
 *
 * Usage:
 *   npx tsx scripts/adjustGraceTrialTo30Days.ts           # dry run (default)
 *   npx tsx scripts/adjustGraceTrialTo30Days.ts --apply    # actually write
 */
import { initializeFirebaseAdmin, getFirestore } from '../src/infrastructure/database/firebase.js'
import admin from 'firebase-admin'

const GRACE_TRIAL_DAYS = 30

async function main() {
  initializeFirebaseAdmin()
  const db = getFirestore()
  const apply = process.argv.includes('--apply')

  console.log(
    apply ? '\n🚀 APPLYING correction (real writes)\n' : '\n🔍 DRY RUN (pass --apply to write)\n'
  )

  const trialEndsAt = new Date()
  trialEndsAt.setDate(trialEndsAt.getDate() + GRACE_TRIAL_DAYS)
  console.log(`   New trialEndsAt: ${trialEndsAt.toISOString()}\n`)

  const snap = await db
    .collection('organizations')
    .where('billing.legacyGraceExtension', '==', true)
    .get()

  console.log(`📊 Found ${snap.size} orgs previously granted the legacy grace extension\n`)

  let updated = 0
  for (const doc of snap.docs) {
    const data = doc.data()
    console.log(
      `   ${apply ? '✅' : '·'} "${data.name || doc.id}" (${doc.id}) — trialEndsAt → ${trialEndsAt.toISOString().slice(0, 10)}`
    )
    if (apply) {
      await doc.ref.set(
        {
          billing: {
            trialEndsAt: admin.firestore.Timestamp.fromDate(trialEndsAt),
          },
        },
        { merge: true }
      )
    }
    updated++
  }

  console.log(`\n📝 ${apply ? 'Updated' : 'Would update'}: ${updated}\n`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ Error:', e)
    process.exit(1)
  })

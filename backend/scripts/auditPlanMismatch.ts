/**
 * Read-only audit: how many live organizations would be affected by
 * consolidating the old binary nurooPlan ('nuroo' / 'nuroo_business') gate
 * onto the real subscription-backed plan model (starter/growth/enterprise)?
 *
 * Makes NO writes. Safe to run anytime.
 *
 * Usage:
 *   npx tsx scripts/auditPlanMismatch.ts
 */
import { initializeFirebaseAdmin, getFirestore } from '../src/infrastructure/database/firebase.js'
import { getSubscriptionStatus } from '../src/domains/payments/planLimits.js'

async function main() {
  initializeFirebaseAdmin()
  const db = getFirestore()

  const snap = await db.collection('organizations').get()
  console.log(`\n📊 Total organizations: ${snap.size}\n`)

  let legacyNoPlanField = 0 // no nurooPlan stored at all (old-model fallback = full access)
  let nurooPlanNuroo = 0 // explicitly on the free 'nuroo' tier
  let nurooPlanBusiness = 0 // explicitly on 'nuroo_business'

  let realActive = 0 // Model B: has an active subscription/trial right now
  let realInactive = 0 // Model B: no active subscription (would be denied Business features)

  const atRiskOrgs: Array<{ id: string; name: string; nurooPlan: string; realStatus: string }> = []

  for (const doc of snap.docs) {
    const data = doc.data()
    const nurooPlan = data.nurooPlan

    if (nurooPlan === 'nuroo') nurooPlanNuroo++
    else if (nurooPlan === 'nuroo_business') nurooPlanBusiness++
    else legacyNoPlanField++

    // Old model's effective access: explicit 'nuroo' -> free only; anything
    // else (explicit 'nuroo_business' OR missing field) -> full access.
    const oldModelGrantsBusiness = nurooPlan !== 'nuroo'

    const status = await getSubscriptionStatus(doc.id)
    if (status.active) realActive++
    else realInactive++

    // At risk = old model currently grants business-only features, but the
    // real subscription model would deny them once this org hits a gated
    // route (attendance, reports, assignmentsProgress, teamSchedule, etc.)
    if (oldModelGrantsBusiness && !status.active) {
      atRiskOrgs.push({
        id: doc.id,
        name: (data.name as string) || '(no name)',
        nurooPlan: nurooPlan ?? '(missing → legacy full access)',
        realStatus: status.error ?? 'inactive',
      })
    }
  }

  console.log('── Old model (org.nurooPlan) ──────────────────────────────')
  console.log(`  Explicit 'nuroo' (free):          ${nurooPlanNuroo}`)
  console.log(`  Explicit 'nuroo_business':        ${nurooPlanBusiness}`)
  console.log(`  Missing field (legacy fallback):  ${legacyNoPlanField}`)

  console.log('\n── Real model (billing/subscription status) ────────────────')
  console.log(`  Active (trial or paid):           ${realActive}`)
  console.log(`  Inactive/expired/none:            ${realInactive}`)

  console.log(`\n⚠️  Organizations AT RISK of losing access when we switch: ${atRiskOrgs.length}`)
  if (atRiskOrgs.length > 0) {
    console.log(
      '   (currently see Business features via old model, but have no real active subscription)\n'
    )
    for (const org of atRiskOrgs.slice(0, 50)) {
      console.log(`   - ${org.id}  "${org.name}"  nurooPlan=${org.nurooPlan}  →  ${org.realStatus}`)
    }
    if (atRiskOrgs.length > 50) {
      console.log(`   ... and ${atRiskOrgs.length - 50} more`)
    }
  }

  console.log('')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ Error:', e)
    process.exit(1)
  })

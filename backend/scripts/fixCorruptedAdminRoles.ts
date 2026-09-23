/**
 * Fix: re-run the same detection as auditCorruptedAdminRoles.ts, and for every
 * org member whose organizations/{orgId}/members/{uid}.role is 'org_admin'
 * but who is NOT the org's creator, and whose own
 * specialists/{uid}/organizations/{orgId} record says something else (e.g.
 * 'specialist'), write that true role back into the members doc.
 *
 * This repairs the data corruption produced by the old rbac.ts self-heal bug
 * (already fixed in code): it used to force-write 'org_admin' back onto any
 * member whose root specialists/{uid}.orgId happened to match the org,
 * silently reverting any explicit demotion made via the team UI.
 *
 * Re-derives the list live (does not trust a hardcoded copy) so it only
 * touches records that still match the corruption pattern at write time.
 * Logs a before -> after line for every write. User-confirmed before running.
 *
 * Usage:
 *   npx tsx scripts/fixCorruptedAdminRoles.ts
 */
import { initializeFirebaseAdmin, getFirestore } from '../src/infrastructure/database/firebase.js'
import admin from 'firebase-admin'

async function main() {
  initializeFirebaseAdmin()
  const db = getFirestore()

  const orgsSnap = await db.collection('organizations').get()
  console.log(`\n📊 Scanning ${orgsSnap.size} organizations...\n`)

  let fixed = 0
  let skipped = 0

  for (const orgDoc of orgsSnap.docs) {
    const orgId = orgDoc.id
    const orgData = orgDoc.data()
    const orgName = (orgData.name as string) || '(no name)'
    const createdBy = orgData.createdBy as string | undefined

    const membersSnap = await db.collection(`organizations/${orgId}/members`).get()
    for (const memberDoc of membersSnap.docs) {
      const uid = memberDoc.id
      const memberData = memberDoc.data()
      const memberRole = memberData.role as string

      if (memberRole !== 'org_admin') continue
      if (uid === createdBy) continue // legitimate creator — leave alone

      const userOrgSnap = await db.doc(`specialists/${uid}/organizations/${orgId}`).get()
      const trueRole = userOrgSnap.exists ? ((userOrgSnap.data()?.role as string) ?? null) : null

      if (!trueRole || trueRole === 'org_admin' || trueRole === 'admin') {
        skipped++
        continue
      }

      await memberDoc.ref.update({
        role: trueRole,
        updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
      })
      fixed++
      console.log(
        `   ✅ org "${orgName}" (${orgId})  uid=${uid}  members.role: org_admin → ${trueRole}`
      )
    }
  }

  console.log(`\n📝 Fixed: ${fixed}   Skipped (no longer matching / already correct): ${skipped}\n`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ Error:', e)
    process.exit(1)
  })

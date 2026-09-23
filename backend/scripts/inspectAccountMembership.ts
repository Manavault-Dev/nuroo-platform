/**
 * Read-only diagnostic: look up two accounts by email and print their
 * Firebase Auth uid, specialists/{uid} doc, and every org members entry
 * that references them — to see whether their org role/membership data
 * is inconsistent (e.g. the rbac.ts self-heal bug that force-reset a
 * demoted specialist back to org_admin).
 *
 * Makes NO writes. Safe to run anytime.
 *
 * Usage:
 *   npx tsx scripts/inspectAccountMembership.ts email1@example.com email2@example.com
 */
import { initializeFirebaseAdmin, getFirestore } from '../src/infrastructure/database/firebase.js'
import { getAuth } from 'firebase-admin/auth'

async function inspectAccount(email: string) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`📧 ${email}`)
  console.log('='.repeat(60))

  const db = getFirestore()
  let uid: string
  try {
    const userRecord = await getAuth().getUserByEmail(email)
    uid = userRecord.uid
    console.log(`  uid: ${uid}`)
    console.log(`  disabled: ${userRecord.disabled}`)
    console.log(`  customClaims: ${JSON.stringify(userRecord.customClaims ?? {})}`)
  } catch (e) {
    console.log(`  ❌ No Firebase Auth user found for this email: ${(e as Error).message}`)
    return
  }

  const specialistSnap = await db.doc(`specialists/${uid}`).get()
  if (specialistSnap.exists) {
    const d = specialistSnap.data()!
    console.log(`  specialists/${uid}:`)
    console.log(`    name: ${d.name ?? '(none)'}`)
    console.log(`    orgId (primary): ${d.orgId ?? '(none)'}`)
    console.log(`    role: ${d.role ?? '(none)'}`)
  } else {
    console.log(`  specialists/${uid}: (does not exist)`)
  }

  // Find every organizations/*/members/{uid} doc via collectionGroup
  const membersQuery = await db
    .collectionGroup('members')
    .get()
    .then((snap) => snap.docs.filter((doc) => doc.id === uid))

  if (membersQuery.length === 0) {
    console.log(`  organizations/*/members/${uid}: (no membership records found)`)
  } else {
    for (const doc of membersQuery) {
      const orgId = doc.ref.parent.parent!.id
      const d = doc.data()
      const orgSnap = await db.doc(`organizations/${orgId}`).get()
      const orgName = orgSnap.exists ? orgSnap.data()?.name : '(org not found)'
      console.log(`  organizations/${orgId}/members/${uid}  ["${orgName}"]:`)
      console.log(`    role: ${d.role ?? '(none)'}`)
      console.log(`    status: ${d.status ?? '(none)'}`)
      console.log(
        `    createdBy match: ${orgSnap.exists ? orgSnap.data()?.createdBy === uid : 'n/a'}`
      )
    }
  }

  // Also check specialists/{uid}/organizations/{orgId} sub-collection
  const userOrgsSnap = await db.collection(`specialists/${uid}/organizations`).get()
  if (!userOrgsSnap.empty) {
    console.log(`  specialists/${uid}/organizations/*:`)
    for (const doc of userOrgsSnap.docs) {
      const d = doc.data()
      console.log(`    ${doc.id}: role=${d.role ?? '(none)'} status=${d.status ?? '(none)'}`)
    }
  }
}

async function main() {
  initializeFirebaseAdmin()
  const emails = process.argv.slice(2)
  if (emails.length === 0) {
    console.error('Usage: npx tsx scripts/inspectAccountMembership.ts email1 email2 ...')
    process.exit(1)
  }
  for (const email of emails) {
    await inspectAccount(email)
  }
  console.log('')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ Error:', e)
    process.exit(1)
  })

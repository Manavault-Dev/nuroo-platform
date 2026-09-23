/**
 * Read-only audit: find org members whose organizations/{orgId}/members/{uid}
 * role is 'org_admin' but who are NOT the org's creator, where their own
 * specialists/{uid}/organizations/{orgId} record says something else (e.g.
 * 'specialist'). This is the exact corruption pattern produced by the old
 * rbac.ts self-heal bug (now fixed) that force-promoted any member whose
 * root specialists/{uid}.orgId happened to match the org.
 *
 * Makes NO writes. Safe to run anytime.
 *
 * Usage:
 *   npx tsx scripts/auditCorruptedAdminRoles.ts
 */
import { initializeFirebaseAdmin, getFirestore } from '../src/infrastructure/database/firebase.js'

async function main() {
  initializeFirebaseAdmin()
  const db = getFirestore()

  const orgsSnap = await db.collection('organizations').get()
  console.log(`\n📊 Scanning ${orgsSnap.size} organizations...\n`)

  let totalMembers = 0
  let suspects = 0
  const findings: Array<{
    orgId: string
    orgName: string
    uid: string
    memberRole: string
    trueRole: string | null
    trueSource: string
  }> = []

  for (const orgDoc of orgsSnap.docs) {
    const orgId = orgDoc.id
    const orgData = orgDoc.data()
    const orgName = (orgData.name as string) || '(no name)'
    const createdBy = orgData.createdBy as string | undefined

    const membersSnap = await db.collection(`organizations/${orgId}/members`).get()
    for (const memberDoc of membersSnap.docs) {
      totalMembers++
      const uid = memberDoc.id
      const memberData = memberDoc.data()
      const memberRole = memberData.role as string

      if (memberRole !== 'org_admin') continue
      if (uid === createdBy) continue // legitimate creator, not a suspect

      // Cross-check the specialist's own record of their intended role in this org
      const userOrgSnap = await db.doc(`specialists/${uid}/organizations/${orgId}`).get()
      const trueRole = userOrgSnap.exists ? ((userOrgSnap.data()?.role as string) ?? null) : null

      if (trueRole && trueRole !== 'org_admin' && trueRole !== 'admin') {
        suspects++
        findings.push({
          orgId,
          orgName,
          uid,
          memberRole,
          trueRole,
          trueSource: `specialists/${uid}/organizations/${orgId}`,
        })
      }
    }
  }

  console.log(`  Total member records scanned: ${totalMembers}`)
  console.log(`\n⚠️  Suspected corrupted-to-admin members: ${suspects}\n`)

  for (const f of findings) {
    console.log(
      `   - org "${f.orgName}" (${f.orgId})  uid=${f.uid}  members.role=${f.memberRole}  but ${f.trueSource}.role=${f.trueRole}`
    )
  }

  console.log('')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ Error:', e)
    process.exit(1)
  })

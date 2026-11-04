/**
 * Read-only audit: does any live organization or specialist still store a
 * legacy category value ("sensory", "sensory_development", "sensory_dev",
 * "child_dev", "child_development") that the current ORG_CATEGORIES list
 * (lib/b2b/countries.ts / domains/organization/constants/orgCategories.ts
 * on mobile) no longer resolves to a label? If none do, the mobile-side
 * resolveCategoryLabel() rewrite is not a regression for real data.
 *
 * Makes NO writes. Safe to run anytime.
 *
 * Usage:
 *   npx tsx scripts/auditLegacyCategoryValues.ts
 */
import { initializeFirebaseAdmin, getFirestore } from '../src/infrastructure/database/firebase.js'

const LEGACY_VALUES = new Set([
  'sensory',
  'sensory_dev',
  'sensory_development',
  'child_dev',
  'child_development',
])

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

async function scanCollection(db: FirebaseFirestore.Firestore, collection: string) {
  const snap = await db.collection(collection).get()
  const hits: Array<{ id: string; name: string; categories: string[] }> = []

  for (const doc of snap.docs) {
    const data = doc.data()
    const categories: unknown = data.categories ?? data.specialization
    const list: string[] = Array.isArray(categories)
      ? categories
      : typeof categories === 'string'
        ? [categories]
        : []

    const matched = list.filter((c) => typeof c === 'string' && LEGACY_VALUES.has(normalize(c)))
    if (matched.length > 0) {
      hits.push({
        id: doc.id,
        name: (data.name as string) ?? (data.fullName as string) ?? '(no name)',
        categories: matched,
      })
    }
  }

  return { total: snap.size, hits }
}

async function main() {
  initializeFirebaseAdmin()
  const db = getFirestore()

  console.log('\n📊 Scanning for legacy category values (sensory*/child_dev*)...\n')

  const orgs = await scanCollection(db, 'organizations')
  const specialists = await scanCollection(db, 'specialists')

  console.log(
    `organizations: ${orgs.total} total, ${orgs.hits.length} with a legacy category value`
  )
  for (const h of orgs.hits) {
    console.log(`   - ${h.id}  "${h.name}"  →  ${h.categories.join(', ')}`)
  }

  console.log(
    `\nspecialists: ${specialists.total} total, ${specialists.hits.length} with a legacy category value`
  )
  for (const h of specialists.hits) {
    console.log(`   - ${h.id}  "${h.name}"  →  ${h.categories.join(', ')}`)
  }

  const totalHits = orgs.hits.length + specialists.hits.length
  console.log(
    totalHits === 0
      ? '\n✅ No live documents use a legacy sensory/child-development category value — the mobile category-resolver change is not a regression for real data.\n'
      : `\n⚠️  ${totalHits} document(s) still use a legacy category value — these will render as a raw, unlocalized string on mobile until resolveCategoryLabel() gets a compatibility alias for them.\n`
  )
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ Error:', e)
    process.exit(1)
  })

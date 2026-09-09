/**
 * addOrgCoords.ts — geocodes all b2bOrganizations that lack lat/lng
 * and writes coordinates back to Firestore using Firebase Admin SDK.
 *
 * Uses Nominatim (OpenStreetMap) — free, no API key needed.
 * Rate limit: 1 request/sec as required by Nominatim ToS.
 *
 * Usage:
 *   npx tsx scripts/addOrgCoords.ts
 */

import admin from 'firebase-admin'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.join(__dirname, '../.env') })

const projectId   = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')

if (!projectId || !clientEmail || !privateKey) {
  console.error('❌ Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY in backend/.env')
  process.exit(1)
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  })
}

const db = admin.firestore()

// ── Nominatim geocoding ───────────────────────────────────────────────────────
async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NurooApp/1.0 (support@usenuroo.com)' },
  })
  const json = (await res.json()) as any[]
  if (!json.length) return null
  return { lat: parseFloat(json[0].lat), lng: parseFloat(json[0].lon) }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── Main ─────────────────────────────────────────────────────────────────────
console.log(`\n🔥 Firebase Admin → project: ${projectId}\n`)

const snap = await db
  .collection('organizations')
  .where('isPublicMarketplaceEnabled', '==', true)
  .get()
console.log(`📋 Found ${snap.size} organizations\n`)

let updated = 0, skipped = 0, failed = 0

for (const docSnap of snap.docs) {
  const d = docSnap.data()
  const name = d.name ?? d.orgName ?? docSnap.id

  // Already geocoded
  if (typeof d.lat === 'number' && typeof d.lng === 'number') {
    console.log(`⏭️  ${name} — already has coords (${d.lat.toFixed(4)}, ${d.lng.toFixed(4)})`)
    skipped++
    continue
  }

  // Build query: address + city, fallback to city only
  const fullQuery  = [d.address, d.city, d.country ?? 'Kyrgyzstan'].filter(Boolean).join(', ')
  const cityQuery  = [d.city, 'Kyrgyzstan'].filter(Boolean).join(', ')

  await sleep(1100) // Nominatim: max 1 req/sec
  let coords = fullQuery ? await geocode(fullQuery) : null

  if (!coords && cityQuery) {
    await sleep(1100)
    coords = await geocode(cityQuery)
  }

  if (!coords) {
    console.log(`❌ ${name} — geocode failed (address: "${fullQuery}")`)
    failed++
    continue
  }

  await docSnap.ref.update({ lat: coords.lat, lng: coords.lng })
  console.log(`✅ ${name} — (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`)
  updated++
}

console.log(`
─────────────────────────────────
✅ Updated : ${updated}
⏭️  Skipped : ${skipped}  (already had coords)
❌ Failed  : ${failed}
─────────────────────────────────
`)

process.exit(0)

/**
 * Diagnostic: mint a Firebase custom token for a given uid (admin operation,
 * no password involved anywhere), exchange it for a real ID token via the
 * public Firebase Identity Toolkit REST API, then call the local backend's
 * GET /v1/me exactly as the frontend would — to see the EXACT JSON the
 * frontend receives for this user, ground truth instead of guessing.
 *
 * Makes no Firestore writes. Safe. Local backend only (does not touch prod).
 *
 * Usage:
 *   npx tsx scripts/diagnoseAsUser.ts <uid> [backendBaseUrl]
 */
import { initializeFirebaseAdmin } from '../src/infrastructure/database/firebase.js'
import { getAuth } from 'firebase-admin/auth'

const FIREBASE_WEB_API_KEY = 'AIzaSyAWiX94qG3CSPDBEuN5LHyuZdGqC0cT5C0'

async function main() {
  initializeFirebaseAdmin()
  const uid = process.argv[2]
  const backendBaseUrl = process.argv[3] || 'http://127.0.0.1:3101'
  if (!uid) {
    console.error('Usage: npx tsx scripts/diagnoseAsUser.ts <uid> [backendBaseUrl]')
    process.exit(1)
  }

  console.log(`\n🔑 Minting custom token for uid=${uid}...`)
  const customToken = await getAuth().createCustomToken(uid)

  console.log('🔄 Exchanging for a real ID token via Identity Toolkit...')
  const exchangeRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  )
  const exchangeData = (await exchangeRes.json()) as { idToken?: string; error?: unknown }
  if (!exchangeData.idToken) {
    console.error('❌ Token exchange failed:', JSON.stringify(exchangeData, null, 2))
    process.exit(1)
  }
  console.log('✅ Got ID token.\n')

  console.log(`📡 GET ${backendBaseUrl}/v1/me ...`)
  const meRes = await fetch(`${backendBaseUrl}/v1/me`, {
    headers: { Authorization: `Bearer ${exchangeData.idToken}` },
  })
  const meData = await meRes.json()
  console.log(`Status: ${meRes.status}`)
  console.log(JSON.stringify(meData, null, 2))
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ Error:', e)
    process.exit(1)
  })

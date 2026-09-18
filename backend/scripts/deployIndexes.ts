/**
 * Deploys Firestore composite indexes from ../../firestore.indexes.json.
 * Reads indexes using the backend's Firebase Admin credentials, but creates them
 * using the operator's own `gcloud` identity (the backend service account only has
 * Firestore read/write data access, not index-admin permission).
 *
 * Prereq: `gcloud auth login` + `gcloud config set project <id>` with a principal that
 * has roles/datastore.indexAdmin (or Editor/Owner) on the project.
 *
 * Usage:
 *   npx tsx scripts/deployIndexes.ts          # create missing indexes, then poll until READY
 *   npx tsx scripts/deployIndexes.ts --check  # only report current index status, create nothing
 */

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { initializeFirebaseAdmin } from '../src/infrastructure/database/firebase.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const indexesPath = path.resolve(__dirname, '../../firestore.indexes.json')

function getGcloudAccessToken(): string {
  return execSync('gcloud auth print-access-token', { encoding: 'utf-8' }).trim()
}

interface IndexField {
  fieldPath: string
  order?: 'ASCENDING' | 'DESCENDING'
  arrayConfig?: 'CONTAINS'
}

interface IndexDef {
  collectionGroup: string
  queryScope: 'COLLECTION' | 'COLLECTION_GROUP'
  fields: IndexField[]
}

async function getAccessToken(): Promise<string> {
  const app = initializeFirebaseAdmin()
  if (!app) throw new Error('Firebase Admin failed to initialize — check backend/.env')
  const credential = app.options.credential
  if (!credential) throw new Error('No credential on the initialized Firebase app')
  const { access_token } = await credential.getAccessToken()
  return access_token
}

async function main() {
  const checkOnly = process.argv.includes('--check')

  const projectId = initializeFirebaseAdmin()?.options.projectId
  if (!projectId) throw new Error('Could not resolve Firebase project id')

  const readToken = await getAccessToken()
  const writeToken = checkOnly ? readToken : getGcloudAccessToken()
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)`

  const raw = fs.readFileSync(indexesPath, 'utf-8')
  const parsed = JSON.parse(raw) as { indexes: IndexDef[] }

  console.log(`Project: ${projectId}`)
  console.log(`Indexes defined in firestore.indexes.json: ${parsed.indexes.length}`)

  // List existing indexes per collection group (dedupe collection groups first).
  const collectionGroups = Array.from(new Set(parsed.indexes.map((i) => i.collectionGroup)))
  const existingByGroup = new Map<string, any[]>()
  for (const cg of collectionGroups) {
    const res = await fetch(`${base}/collectionGroups/${cg}/indexes`, {
      headers: { Authorization: `Bearer ${readToken}` },
    })
    const body = await res.json()
    if (!res.ok) {
      console.error(`  ! Failed to list indexes for ${cg}:`, body.error?.message ?? body)
      existingByGroup.set(cg, [])
      continue
    }
    existingByGroup.set(cg, body.indexes ?? [])
  }

  function sameIndex(a: IndexDef, b: any): boolean {
    if (a.queryScope !== b.queryScope) return false
    const bFields = (b.fields ?? []).filter((f: any) => f.fieldPath !== '__name__')
    if (bFields.length !== a.fields.length) return false
    return a.fields.every((f, i) => {
      const bf = bFields[i]
      if (!bf || bf.fieldPath !== f.fieldPath) return false
      if (f.order) return bf.order === f.order
      if (f.arrayConfig) return bf.arrayConfig === f.arrayConfig
      return true
    })
  }

  const toCreate: IndexDef[] = []
  for (const idx of parsed.indexes) {
    const existing = existingByGroup.get(idx.collectionGroup) ?? []
    const match = existing.find((e) => sameIndex(idx, e))
    if (match) {
      console.log(
        `  = ${idx.collectionGroup} [${idx.fields.map((f) => f.fieldPath).join(',')}] already exists (${match.state})`
      )
    } else {
      toCreate.push(idx)
    }
  }

  if (checkOnly) {
    console.log(`\n${toCreate.length} index(es) missing:`)
    for (const idx of toCreate) {
      console.log(
        `  - ${idx.collectionGroup} [${idx.fields.map((f) => `${f.fieldPath} ${f.order}`).join(', ')}]`
      )
    }
    return
  }

  console.log(`\nCreating ${toCreate.length} missing index(es)...`)
  for (const idx of toCreate) {
    const res = await fetch(`${base}/collectionGroups/${idx.collectionGroup}/indexes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryScope: idx.queryScope, fields: idx.fields }),
    })
    const body = await res.json()
    const label = `${idx.collectionGroup} [${idx.fields.map((f) => f.fieldPath).join(',')}]`
    if (res.ok) {
      console.log(`  + created ${label}`)
    } else if (body.error?.status === 'ALREADY_EXISTS') {
      console.log(`  = ${label} already exists`)
    } else {
      console.error(`  ! failed to create ${label}:`, body.error?.message ?? body)
    }
  }

  // Poll until every index for the touched collection groups is READY (or fail).
  console.log('\nPolling build status...')
  const deadline = Date.now() + 5 * 60 * 1000
  let allReady = false
  while (Date.now() < deadline) {
    let pending = 0
    let failed = 0
    for (const cg of collectionGroups) {
      const res = await fetch(`${base}/collectionGroups/${cg}/indexes`, {
        headers: { Authorization: `Bearer ${readToken}` },
      })
      const body = await res.json()
      for (const idx of body.indexes ?? []) {
        if (idx.state === 'CREATING') pending++
        if (idx.state === 'NEEDS_REPAIR' || idx.state === 'ERROR') {
          failed++
          console.error(`  ! index in bad state: ${cg}`, idx)
        }
      }
    }
    console.log(`  ${pending} still building, ${failed} failed...`)
    if (pending === 0) {
      allReady = failed === 0
      break
    }
    await new Promise((r) => setTimeout(r, 10000))
  }

  console.log(
    allReady
      ? '\nAll indexes READY.'
      : '\nTimed out or some indexes failed — check the Firebase console.'
  )
  process.exit(allReady ? 0 : 1)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})

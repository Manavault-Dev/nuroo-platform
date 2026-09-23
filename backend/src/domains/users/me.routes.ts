import { FastifyPluginAsync } from 'fastify'
import admin from 'firebase-admin'
import path from 'path'
import multipart from '@fastify/multipart'

import { getFirestore, getStorageBucket } from '../../infrastructure/database/firebase.js'
import type { SpecialistProfile } from '../../shared/types/domain.js'
import { z } from 'zod'
import { eventDispatcher } from '../../modules/notifications/event.dispatcher.js'

const COLLECTIONS = {
  SPECIALISTS: 'specialists',
  PARENTS: 'parents',
  ORGANIZATIONS: 'organizations',
  ORG_MEMBERS: (orgId: string) => `organizations/${orgId}/members`,
  USER_ORGS: (uid: string) => `specialists/${uid}/organizations`,
} as const

const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
})

function extractName(specialistData: admin.firestore.DocumentData | null | undefined): string {
  return specialistData?.fullName || specialistData?.name || ''
}

function normalizeRole(role: string): 'admin' | 'specialist' | 'independent_specialist' {
  if (role === 'org_admin' || role === 'admin') return 'admin'
  if (role === 'independent_specialist') return 'independent_specialist'
  return 'specialist'
}

function denormalizeRole(
  role: 'admin' | 'specialist' | 'independent_specialist'
): 'org_admin' | 'specialist' | 'independent_specialist' {
  if (role === 'admin') return 'org_admin'
  if (role === 'independent_specialist') return 'independent_specialist'
  return 'specialist'
}

async function findOrganizationsForUser(
  db: admin.firestore.Firestore,
  uid: string,
  isUserSuperAdmin: boolean,
  hasSpecialistProfile: boolean = true
): Promise<
  Array<{
    orgId: string
    orgName: string
    country?: string | null
    city?: string | null
    categories?: string[] | null
    description?: string | null
    address?: string | null
    contactPhone?: string | null
    whatsappNumber?: string | null
    websiteUrl?: string | null
    logoUrl?: string | null
    coverImageUrl?: string | null
    logoPositionX?: number | null
    logoPositionY?: number | null
    logoScale?: number | null
    coverPositionX?: number | null
    coverPositionY?: number | null
    coverScale?: number | null
    isPublicMarketplaceEnabled?: boolean
    nurooPlan?: 'nuroo' | 'nuroo_business' | null
    role: 'admin' | 'specialist' | 'independent_specialist'
  }>
> {
  const organizations: Array<{
    orgId: string
    orgName: string
    country?: string | null
    city?: string | null
    categories?: string[] | null
    description?: string | null
    address?: string | null
    contactPhone?: string | null
    whatsappNumber?: string | null
    websiteUrl?: string | null
    logoUrl?: string | null
    coverImageUrl?: string | null
    logoPositionX?: number | null
    logoPositionY?: number | null
    logoScale?: number | null
    coverPositionX?: number | null
    coverPositionY?: number | null
    coverScale?: number | null
    isPublicMarketplaceEnabled?: boolean
    nurooPlan?: 'nuroo' | 'nuroo_business' | null
    role: 'admin' | 'specialist' | 'independent_specialist'
  }> = []
  const seenOrgIds = new Set<string>()

  const addOrganization = (
    orgId: string,
    orgData: admin.firestore.DocumentData,
    role: 'admin' | 'specialist' | 'independent_specialist'
  ) => {
    if (seenOrgIds.has(orgId)) return
    seenOrgIds.add(orgId)
    const rawPlan = orgData.nurooPlan
    const nurooPlan: 'nuroo' | 'nuroo_business' | null =
      rawPlan === 'nuroo' || rawPlan === 'nuroo_business' ? rawPlan : null
    organizations.push({
      orgId,
      orgName: orgData.name || orgId,
      country: orgData.country ?? null,
      city: orgData.city ?? null,
      categories: Array.isArray(orgData.categories) ? orgData.categories : [],
      description: orgData.description ?? null,
      address: orgData.address ?? null,
      contactPhone: orgData.contactPhone ?? null,
      whatsappNumber: orgData.whatsappNumber ?? null,
      websiteUrl: orgData.websiteUrl ?? null,
      logoUrl: orgData.logoUrl ?? null,
      coverImageUrl: orgData.coverImageUrl ?? null,
      logoPositionX: orgData.logoPositionX ?? null,
      logoPositionY: orgData.logoPositionY ?? null,
      logoScale: orgData.logoScale ?? null,
      coverPositionX: orgData.coverPositionX ?? null,
      coverPositionY: orgData.coverPositionY ?? null,
      coverScale: orgData.coverScale ?? null,
      isPublicMarketplaceEnabled: orgData.isPublicMarketplaceEnabled ?? false,
      nurooPlan,
      role,
    })
  }

  const writeMembershipIndex = async (
    orgId: string,
    orgData: admin.firestore.DocumentData,
    role: 'admin' | 'specialist' | 'independent_specialist'
  ) => {
    const now = admin.firestore.Timestamp.now()
    // Trust the role the caller already computed (from the live member/index
    // record, with the org-creator fallback already applied where needed).
    // Do NOT re-check the existing members doc and force 'org_admin' back
    // onto it here — that was the same self-heal anti-pattern already found
    // and removed from rbac.ts: it silently reverted any explicit demotion
    // to 'specialist' made via the team UI on this member's next /me call.
    const finalRole = denormalizeRole(role)

    await Promise.allSettled([
      db.doc(`${COLLECTIONS.ORG_MEMBERS(orgId)}/${uid}`).set(
        {
          uid,
          role: finalRole,
          status: 'active',
          updatedAt: now,
        },
        { merge: true }
      ),
      db.doc(`${COLLECTIONS.USER_ORGS(uid)}/${orgId}`).set(
        {
          orgId,
          orgName: orgData.name || orgId,
          country: orgData.country ?? null,
          role: finalRole,
          status: 'active',
          updatedAt: now,
        },
        { merge: true }
      ),
    ])
  }

  if (isUserSuperAdmin) {
    const createdOrgsSnapshot = await db
      .collection(COLLECTIONS.ORGANIZATIONS)
      .where('createdBy', '==', uid)
      .get()

    for (const orgDoc of createdOrgsSnapshot.docs) {
      addOrganization(orgDoc.id, orgDoc.data(), 'admin')
    }
  }

  // Strategy 0: per-user membership index — fastest path, no collectionGroup scan
  try {
    const indexedSnapshot = await db
      .collection(COLLECTIONS.USER_ORGS(uid))
      .where('status', '==', 'active')
      .get()

    if (!indexedSnapshot.empty) {
      const indexedEntries = await Promise.all(
        indexedSnapshot.docs.map(async (membershipDoc) => {
          const membershipData = membershipDoc.data()
          const orgId = (membershipData.orgId as string | undefined) || membershipDoc.id
          const orgSnap = await db.doc(`${COLLECTIONS.ORGANIZATIONS}/${orgId}`).get()
          if (!orgSnap.exists) return null

          return {
            orgId,
            orgData: orgSnap.data()!,
            role: normalizeRole(membershipData.role),
          }
        })
      )

      for (const entry of indexedEntries) {
        if (!entry) continue
        addOrganization(entry.orgId, entry.orgData, entry.role)
      }

      return organizations
    }
  } catch (err) {
    console.warn('[me] Strategy 0 (user org index) failed:', err)
  }

  // Strategy 1: orgId pointer on specialist profile
  try {
    const specialistSnap = await db.doc(`${COLLECTIONS.SPECIALISTS}/${uid}`).get()
    const specialistData = specialistSnap.exists ? specialistSnap.data() : null
    const orgId = specialistData?.orgId as string | undefined

    if (orgId) {
      const [orgSnap, memberSnap] = await Promise.all([
        db.doc(`${COLLECTIONS.ORGANIZATIONS}/${orgId}`).get(),
        db.doc(`${COLLECTIONS.ORG_MEMBERS(orgId)}/${uid}`).get(),
      ])

      if (orgSnap.exists) {
        const memberData = memberSnap.exists ? memberSnap.data() : null
        const role =
          memberData?.status === 'active'
            ? normalizeRole(memberData.role)
            : orgSnap.data()?.createdBy === uid
              ? 'admin'
              : null

        if (role) {
          addOrganization(orgId, orgSnap.data()!, role)
          await writeMembershipIndex(orgId, orgSnap.data()!, role)
          return organizations
        }
      }
    }
  } catch (err) {
    console.warn('[me] Strategy 1 (specialist org pointer) failed:', err)
  }

  // Strategy 2: legacy fallback — full org scan, skipped for brand-new users
  if (!hasSpecialistProfile) {
    return organizations
  }
  console.warn('[me] Strategy 2: scanning organizations collection for uid:', uid)
  try {
    const orgsSnapshot = await db.collection(COLLECTIONS.ORGANIZATIONS).get()
    const directChecks = await Promise.all(
      orgsSnapshot.docs.map(async (orgDoc) => {
        const memberRef = db.doc(`${COLLECTIONS.ORGANIZATIONS}/${orgDoc.id}/members/${uid}`)
        const memberSnap = await memberRef.get()
        if (!memberSnap.exists) return null
        const data = memberSnap.data()!
        if (data.status !== 'active') return null
        return {
          orgId: orgDoc.id,
          orgData: orgDoc.data(),
          role: normalizeRole(data.role),
        }
      })
    )
    for (const entry of directChecks) {
      if (!entry) continue
      addOrganization(entry.orgId, entry.orgData, entry.role)
      await writeMembershipIndex(entry.orgId, entry.orgData, entry.role)
    }
  } catch (err) {
    console.error('[me] Strategy 2 (direct scan) failed:', err)
  }

  return organizations
}

function buildProfileUpdateData(name: string, now: Date) {
  return {
    fullName: name,
    name,
    updatedAt: admin.firestore.Timestamp.fromDate(now),
  }
}

function buildNewProfileData(uid: string, email: string | undefined, name: string, now: Date) {
  return {
    uid,
    email: email || '',
    fullName: name,
    name,
    createdAt: admin.firestore.Timestamp.fromDate(now),
    updatedAt: admin.firestore.Timestamp.fromDate(now),
  }
}

export const meRoute: FastifyPluginAsync = async (fastify) => {
  // Avatar upload in isolated sub-plugin so multipart doesn't affect GET/POST /me
  fastify.register(async (sub) => {
    await sub.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } })

    sub.post('/me/avatar', async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const { uid } = request.user

      let fileBuffer: Buffer | null = null
      let mimeType = 'image/jpeg'
      let filename = 'avatar'

      for await (const part of request.parts()) {
        if (part.type === 'file') {
          mimeType = part.mimetype
          filename = part.filename || 'avatar'
          const chunks: Buffer[] = []
          for await (const chunk of part.file) chunks.push(chunk)
          fileBuffer = Buffer.concat(chunks)
        }
      }

      if (!fileBuffer) {
        return reply.code(400).send({ error: 'No file uploaded' })
      }
      if (!mimeType.startsWith('image/')) {
        return reply.code(400).send({ error: 'Only image files are allowed' })
      }

      const ext = path.extname(filename).replace('.', '') || 'jpg'
      const storagePath = `specialists/${uid}/avatar.${ext}`

      const bucket = await getStorageBucket()
      const file = bucket.file(storagePath)
      await file.save(fileBuffer, { contentType: mimeType, resumable: false })
      await file.makePublic()

      const avatarUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`

      const db = getFirestore()
      await db
        .doc(`${COLLECTIONS.SPECIALISTS}/${uid}`)
        .set({ avatarUrl, updatedAt: admin.firestore.Timestamp.now() }, { merge: true })

      return { ok: true, avatarUrl }
    })
  })

  fastify.get('/me', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }

    const db = getFirestore()
    const { uid, email } = request.user

    const specialistRef = db.doc(`${COLLECTIONS.SPECIALISTS}/${uid}`)
    const isUserSuperAdmin = request.user?.claims?.superAdmin === true

    const [specialistSnap, parentSnap] = await Promise.all([
      specialistRef.get(),
      db.doc(`${COLLECTIONS.PARENTS}/${uid}`).get(),
    ])

    const organizations = await findOrganizationsForUser(
      db,
      uid,
      isUserSuperAdmin,
      specialistSnap.exists
    )

    // Parent-only accounts return empty orgs — clients derive role from orgs.length === 0
    const specialistData = specialistSnap.exists ? specialistSnap.data() : null
    const name = extractName(specialistData)

    // Welcome email on first login
    const isNewUser = !specialistSnap.exists && !parentSnap.exists
    if (isNewUser && email) {
      eventDispatcher.dispatch({
        type: 'welcome',
        userId: uid,
        name: name || email.split('@')[0],
        email,
      })
    }

    const profile: SpecialistProfile = {
      uid,
      email: email || '',
      name,
      organizations,
    }

    return profile
  })

  fastify.post<{ Body: z.infer<typeof updateProfileSchema> }>('/me', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }

    const db = getFirestore()
    const { uid, email } = request.user
    const body = updateProfileSchema.parse(request.body)
    const now = new Date()

    const specialistRef = db.doc(`${COLLECTIONS.SPECIALISTS}/${uid}`)
    const specialistSnap = await specialistRef.get()

    if (specialistSnap.exists) {
      if (body.name) {
        await specialistRef.update(buildProfileUpdateData(body.name, now))
      }

      const data = (await specialistRef.get()).data()
      return {
        ok: true,
        specialist: {
          uid,
          email: email || '',
          name: extractName(data),
        },
      }
    }

    const name = body.name || ''
    const newData = buildNewProfileData(uid, email, name, now)
    await specialistRef.set(newData)

    return {
      ok: true,
      specialist: { uid, email: email || '', name: newData.fullName },
    }
  })
}

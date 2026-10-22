import multipart from '@fastify/multipart'
import { FastifyPluginAsync } from 'fastify'
import admin from 'firebase-admin'
import { z } from 'zod'

import { getFirestore, getStorageBucket } from '../../infrastructure/database/firebase.js'
import { FREE_TRIAL_DAYS, FREE_TRIAL_PLAN_ID } from '../payments/planLimits.js'
import { requireOrgMember } from '../../infrastructure/auth/rbac.js'

const NUROO_PLAN_IDS = ['nuroo', 'nuroo_business'] as const
type NurooPlanId = (typeof NUROO_PLAN_IDS)[number]

export const ORG_TYPES = [
  'kindergarten',
  'development_center',
  'school',
  'specialist',
  'other',
] as const
export type OrgType = (typeof ORG_TYPES)[number]

const createOrgSchema = z.object({
  name: z.string().trim().min(1).max(200),
  country: z.string().trim().max(100).optional(),
  plan: z.enum(NUROO_PLAN_IDS).optional(),
  specializations: z.array(z.string().trim().max(100)).max(20).optional(),
  type: z.enum(ORG_TYPES).nullable().optional(),
})

export const imageSourceSchema = z
  .string()
  .trim()
  .max(900_000)
  .refine((value) => value.startsWith('data:image/') || z.string().url().safeParse(value).success, {
    message: 'Must be a valid URL or uploaded image',
  })

const uploadKindSchema = z.enum(['logo', 'cover', 'photo'])
const imagePositionSchema = z.number().min(0).max(100).optional().nullable()
const imageScaleSchema = z.number().min(1).max(2).optional().nullable()

export function parseDataImageUrl(value: string): { mimeType: string; buffer: Buffer } | null {
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (!match) return null

  try {
    return {
      mimeType: match[1],
      buffer: Buffer.from(match[2], 'base64'),
    }
  } catch {
    return null
  }
}

export async function uploadOrgMarketplaceImage(
  orgId: string,
  kind: 'logo' | 'cover' | 'photo',
  mediaBuffer: Buffer,
  mediaMimetype: string,
  mediaFilename: string
) {
  const bucket = await getStorageBucket()
  const safeName = mediaFilename.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `orgs/${orgId}/marketplace/${kind}/${Date.now()}-${safeName}`
  const file = bucket.file(storagePath)

  await file.save(mediaBuffer, {
    contentType: mediaMimetype || undefined,
    metadata: {
      cacheControl: 'public, max-age=31536000',
    },
  })
  await file.makePublic()

  return `https://storage.googleapis.com/${bucket.name}/${storagePath}`
}

const updateOrgSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    country: z.string().trim().max(100).optional(),
    city: z.string().trim().max(100).optional(),
    type: z.enum(ORG_TYPES).nullable().optional(),
    categories: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    // Marketplace profile fields
    description: z.string().trim().max(1000).optional(),
    address: z.string().trim().max(300).optional(),
    contactPhone: z
      .string()
      .trim()
      .max(50)
      .regex(/^[+\d\s\-().]*$/, 'Invalid phone format')
      .optional(),
    whatsappNumber: z
      .string()
      .trim()
      .max(50)
      .regex(/^[+\d\s\-().]*$/, 'Invalid phone format')
      .optional(),
    websiteUrl: z.string().trim().max(500).url('Must be a valid URL').optional().or(z.literal('')),
    logoUrl: imageSourceSchema.optional().or(z.literal('')),
    coverImageUrl: imageSourceSchema.optional().or(z.literal('')),
    logoPositionX: imagePositionSchema,
    logoPositionY: imagePositionSchema,
    logoScale: imageScaleSchema,
    coverPositionX: imagePositionSchema,
    coverPositionY: imagePositionSchema,
    coverScale: imageScaleSchema,
    isPublicMarketplaceEnabled: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  })

const orgIdParamsSchema = {
  type: 'object',
  required: ['orgId'],
  properties: { orgId: { type: 'string', description: 'Organization ID' } },
} as const

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' } },
} as const

const createOrgBodySchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: true,
  properties: {
    name: { type: 'string' },
    country: { type: 'string' },
    plan: { type: 'string', enum: [...NUROO_PLAN_IDS] },
    specializations: { type: 'array', items: { type: 'string' } },
    type: { type: ['string', 'null'], enum: [...ORG_TYPES, null] },
  },
} as const

const createOrgResponseSchema = {
  type: 'object',
  required: ['ok', 'orgId', 'name', 'country', 'role'],
  properties: {
    ok: { type: 'boolean' },
    orgId: { type: 'string' },
    name: { type: 'string' },
    country: { type: ['string', 'null'] },
    role: { type: 'string' },
  },
} as const

const updateOrgBodySchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    name: { type: 'string' },
    country: { type: 'string' },
    city: { type: 'string' },
    type: { type: ['string', 'null'], enum: [...ORG_TYPES, null] },
    categories: { type: 'array', items: { type: 'string' } },
    description: { type: 'string' },
    address: { type: 'string' },
    contactPhone: { type: 'string' },
    whatsappNumber: { type: 'string' },
    websiteUrl: { type: 'string' },
    logoUrl: { type: 'string' },
    coverImageUrl: { type: 'string' },
    logoPositionX: { type: ['number', 'null'] },
    logoPositionY: { type: ['number', 'null'] },
    logoScale: { type: ['number', 'null'] },
    coverPositionX: { type: ['number', 'null'] },
    coverPositionY: { type: ['number', 'null'] },
    coverScale: { type: ['number', 'null'] },
    isPublicMarketplaceEnabled: { type: 'boolean' },
  },
} as const

const updateOrgResponseSchema = {
  type: 'object',
  required: ['ok', 'org'],
  properties: {
    ok: { type: 'boolean' },
    org: {
      type: 'object',
      required: [
        'id',
        'name',
        'country',
        'city',
        'categories',
        'description',
        'address',
        'contactPhone',
        'whatsappNumber',
        'websiteUrl',
        'logoUrl',
        'coverImageUrl',
        'logoPositionX',
        'logoPositionY',
        'logoScale',
        'coverPositionX',
        'coverPositionY',
        'coverScale',
        'isPublicMarketplaceEnabled',
        'createdBy',
        'createdAt',
        'isActive',
        'billingPlan',
      ],
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        country: { type: ['string', 'null'] },
        city: { type: ['string', 'null'] },
        categories: { type: 'array', items: { type: 'string' } },
        description: { type: ['string', 'null'] },
        address: { type: ['string', 'null'] },
        contactPhone: { type: ['string', 'null'] },
        whatsappNumber: { type: ['string', 'null'] },
        websiteUrl: { type: ['string', 'null'] },
        logoUrl: { type: ['string', 'null'] },
        coverImageUrl: { type: ['string', 'null'] },
        logoPositionX: { type: ['number', 'null'] },
        logoPositionY: { type: ['number', 'null'] },
        logoScale: { type: ['number', 'null'] },
        coverPositionX: { type: ['number', 'null'] },
        coverPositionY: { type: ['number', 'null'] },
        coverScale: { type: ['number', 'null'] },
        isPublicMarketplaceEnabled: { type: 'boolean' },
        createdBy: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
        isActive: { type: 'boolean' },
        billingPlan: { type: ['string', 'null'] },
      },
    },
  },
} as const

const mediaUploadResponseSchema = {
  type: 'object',
  required: ['ok', 'kind', 'url'],
  properties: {
    ok: { type: 'boolean' },
    kind: { type: 'string', enum: ['logo', 'cover', 'photo'] },
    url: { type: 'string' },
  },
} as const

const deletePhotoBodySchema = {
  type: 'object',
  required: ['url'],
  properties: { url: { type: 'string' } },
} as const

const okResponseSchema = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
} as const

const publicOrgSchema = {
  type: 'object',
  required: [
    'id',
    'name',
    'logoUrl',
    'coverImageUrl',
    'marketplaceLogoUrl',
    'marketplaceCoverImageUrl',
    'coverImage',
    'imageUrl',
    'logoPositionX',
    'logoPositionY',
    'logoScale',
    'coverPositionX',
    'coverPositionY',
    'coverScale',
    'description',
    'country',
    'city',
    'address',
    'categories',
    'contactPhone',
    'whatsappNumber',
    'websiteUrl',
    'reviewCount',
    'averageRating',
    'plan',
    'isOnline',
    'priceFrom',
    'currency',
    'ageMin',
    'ageMax',
    'lat',
    'lng',
    'photos',
  ],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    logoUrl: { type: ['string', 'null'] },
    coverImageUrl: { type: ['string', 'null'] },
    marketplaceLogoUrl: { type: ['string', 'null'] },
    marketplaceCoverImageUrl: { type: ['string', 'null'] },
    coverImage: { type: ['string', 'null'] },
    imageUrl: { type: ['string', 'null'] },
    logoPositionX: { type: ['number', 'null'] },
    logoPositionY: { type: ['number', 'null'] },
    logoScale: { type: ['number', 'null'] },
    coverPositionX: { type: ['number', 'null'] },
    coverPositionY: { type: ['number', 'null'] },
    coverScale: { type: ['number', 'null'] },
    description: { type: ['string', 'null'] },
    country: { type: ['string', 'null'] },
    city: { type: ['string', 'null'] },
    address: { type: ['string', 'null'] },
    categories: { type: 'array', items: { type: 'string' } },
    contactPhone: { type: ['string', 'null'] },
    whatsappNumber: { type: ['string', 'null'] },
    websiteUrl: { type: ['string', 'null'] },
    reviewCount: { type: 'number' },
    averageRating: { type: 'number' },
    plan: { type: 'string' },
    isOnline: { type: 'boolean' },
    priceFrom: { type: ['number', 'null'] },
    currency: { type: 'string' },
    ageMin: { type: ['number', 'null'] },
    ageMax: { type: ['number', 'null'] },
    lat: { type: ['number', 'null'] },
    lng: { type: ['number', 'null'] },
    photos: { type: 'array', items: { type: 'string' } },
  },
} as const

export const orgsRoute: FastifyPluginAsync = async (fastify) => {
  await fastify.register(multipart, { limits: { fileSize: 8 * 1024 * 1024 } })

  // ── GET /orgs/:orgId — fetch full org data including photos[] ─────────────
  fastify.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId',
    {
      schema: {
        tags: ['Organizations'],
        summary: "Get an organization's full Firestore document (any org member)",
        params: orgIdParamsSchema,
        response: {
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const { orgId } = request.params
      await requireOrgMember(request, reply, orgId)
      if (reply.sent) return
      const db = getFirestore()
      const snap = await db.collection('organizations').doc(orgId).get()
      if (!snap.exists) return reply.code(404).send({ error: 'Org not found' })
      return reply.send({ ok: true, org: { id: snap.id, ...snap.data() } })
    }
  )

  fastify.post<{ Body: z.infer<typeof createOrgSchema> }>(
    '/orgs',
    {
      schema: {
        tags: ['Organizations'],
        summary: 'Create a new organization owned by the authenticated user',
        body: createOrgBodySchema,
        response: {
          200: createOrgResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const db = getFirestore()
      const { uid, email } = request.user
      const body = createOrgSchema.parse(request.body)
      const now = new Date()
      const trialExpiresAt = new Date(now)
      trialExpiresAt.setDate(trialExpiresAt.getDate() + FREE_TRIAL_DAYS)

      const existing = await db
        .collection('organizations')
        .where('createdBy', '==', uid)
        .where('name', '==', body.name)
        .limit(1)
        .get()

      if (!existing.empty) {
        return reply.code(400).send({ error: 'You already have an organization with this name' })
      }

      const orgRef = db.collection('organizations').doc()
      const orgId = orgRef.id

      const chosenPlan: NurooPlanId = body.plan ?? 'nuroo_business'
      // independent_specialist = solo Nuroo user; org_admin = team/org owner
      const memberRole = chosenPlan === 'nuroo' ? 'independent_specialist' : 'org_admin'

      await orgRef.set({
        name: body.name,
        country: body.country || null,
        type: body.type ?? null,
        createdAt: admin.firestore.Timestamp.fromDate(now),
        createdBy: uid,
        isActive: true,
        nurooPlan: chosenPlan,
        specializations: body.specializations ?? [],
        billingPlan: null,
        billing: {
          provider: 'manual',
          status: 'trialing',
          plan: FREE_TRIAL_PLAN_ID,
          trialEndsAt: admin.firestore.Timestamp.fromDate(trialExpiresAt),
          currentPeriodEnd: null,
          updatedAt: admin.firestore.Timestamp.fromDate(now),
        },
        freeTrial: {
          planId: FREE_TRIAL_PLAN_ID,
          startedAt: admin.firestore.Timestamp.fromDate(now),
          expiresAt: admin.firestore.Timestamp.fromDate(trialExpiresAt),
        },
      })

      await orgRef
        .collection('members')
        .doc(uid)
        .set({
          uid,
          role: memberRole, // 'independent_specialist' | 'org_admin'
          status: 'active',
          joinedAt: admin.firestore.Timestamp.fromDate(now),
        })

      await db.doc(`specialists/${uid}/organizations/${orgId}`).set({
        orgId,
        orgName: body.name,
        country: body.country || null,
        role: 'org_admin',
        status: 'active',
        updatedAt: admin.firestore.Timestamp.fromDate(now),
      })

      const specialistRef = db.doc(`specialists/${uid}`)
      const specialistSnap = await specialistRef.get()
      if (specialistSnap.exists) {
        await specialistRef.update({
          orgId,
          role: 'org_admin',
          updatedAt: admin.firestore.Timestamp.fromDate(now),
        })
      } else {
        await specialistRef.set({
          uid,
          email: email || '',
          fullName: email?.split('@')[0] || 'Specialist',
          orgId,
          role: 'org_admin',
          createdAt: admin.firestore.Timestamp.fromDate(now),
          updatedAt: admin.firestore.Timestamp.fromDate(now),
        })
      }

      return {
        ok: true,
        orgId,
        name: body.name,
        country: body.country || null,
        role: 'org_admin',
      }
    }
  )

  fastify.patch<{
    Params: { orgId: string }
    Body: z.infer<typeof updateOrgSchema>
  }>(
    '/orgs/:orgId',
    {
      schema: {
        tags: ['Organizations'],
        summary: "Update an organization's profile fields (org admin only)",
        params: orgIdParamsSchema,
        body: updateOrgBodySchema,
        response: {
          200: updateOrgResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const { orgId } = request.params
      const member = await requireOrgMember(request, reply, orgId)
      if (reply.sent) return

      if (member.role !== 'org_admin') {
        request.log.warn(
          { orgId, uid: request.user.uid, role: member.role },
          '[ORG_UPDATE_FORBIDDEN] User is not an organization admin'
        )
        return reply.code(403).send({ error: 'Only organization admins can perform this action' })
      }

      const parseResult = updateOrgSchema.safeParse(request.body)
      if (!parseResult.success) {
        return reply.code(400).send({
          error: 'Invalid organization update',
          issues: parseResult.error.issues,
        })
      }

      const body = parseResult.data
      const db = getFirestore()
      const orgRef = db.doc(`organizations/${orgId}`)
      const orgSnap = await orgRef.get()

      if (!orgSnap.exists) {
        return reply.code(404).send({ error: 'Organization not found' })
      }

      const updateData: Record<string, unknown> = {
        updatedAt: admin.firestore.Timestamp.fromDate(new Date()),
      }

      let logoUrl = body.logoUrl
      if (typeof logoUrl === 'string' && logoUrl.startsWith('data:image/')) {
        const parsed = parseDataImageUrl(logoUrl)
        if (!parsed) {
          return reply.code(400).send({ error: 'Invalid logo image payload' })
        }
        logoUrl = await uploadOrgMarketplaceImage(
          orgId,
          'logo',
          parsed.buffer,
          parsed.mimeType,
          'logo-upload'
        )
      }

      let coverImageUrl = body.coverImageUrl
      if (typeof coverImageUrl === 'string' && coverImageUrl.startsWith('data:image/')) {
        const parsed = parseDataImageUrl(coverImageUrl)
        if (!parsed) {
          return reply.code(400).send({ error: 'Invalid cover image payload' })
        }
        coverImageUrl = await uploadOrgMarketplaceImage(
          orgId,
          'cover',
          parsed.buffer,
          parsed.mimeType,
          'cover-upload'
        )
      }

      if (body.name !== undefined) updateData.name = body.name
      if (body.country !== undefined) updateData.country = body.country || null
      if (body.city !== undefined) updateData.city = body.city || null
      if (body.type !== undefined) updateData.type = body.type
      if (body.categories !== undefined) updateData.categories = body.categories
      if (body.description !== undefined) updateData.description = body.description || null
      if (body.address !== undefined) updateData.address = body.address || null
      if (body.contactPhone !== undefined) updateData.contactPhone = body.contactPhone || null
      if (body.whatsappNumber !== undefined) updateData.whatsappNumber = body.whatsappNumber || null
      if (body.websiteUrl !== undefined) updateData.websiteUrl = body.websiteUrl || null
      if (body.logoUrl !== undefined) updateData.logoUrl = logoUrl || null
      if (body.coverImageUrl !== undefined) updateData.coverImageUrl = coverImageUrl || null
      if (body.logoPositionX !== undefined) updateData.logoPositionX = body.logoPositionX
      if (body.logoPositionY !== undefined) updateData.logoPositionY = body.logoPositionY
      if (body.logoScale !== undefined) updateData.logoScale = body.logoScale
      if (body.coverPositionX !== undefined) updateData.coverPositionX = body.coverPositionX
      if (body.coverPositionY !== undefined) updateData.coverPositionY = body.coverPositionY
      if (body.coverScale !== undefined) updateData.coverScale = body.coverScale
      if (body.isPublicMarketplaceEnabled !== undefined)
        updateData.isPublicMarketplaceEnabled = body.isPublicMarketplaceEnabled

      await orgRef.update(updateData)

      const updatedSnap = await orgRef.get()
      const data = updatedSnap.data()!

      return {
        ok: true,
        org: {
          id: updatedSnap.id,
          name: data.name,
          country: data.country ?? null,
          city: data.city ?? null,
          categories: data.categories ?? [],
          description: data.description ?? null,
          address: data.address ?? null,
          contactPhone: data.contactPhone ?? null,
          whatsappNumber: data.whatsappNumber ?? null,
          websiteUrl: data.websiteUrl ?? null,
          logoUrl: data.logoUrl ?? null,
          coverImageUrl: data.coverImageUrl ?? null,
          logoPositionX: data.logoPositionX ?? null,
          logoPositionY: data.logoPositionY ?? null,
          logoScale: data.logoScale ?? null,
          coverPositionX: data.coverPositionX ?? null,
          coverPositionY: data.coverPositionY ?? null,
          coverScale: data.coverScale ?? null,
          isPublicMarketplaceEnabled: data.isPublicMarketplaceEnabled ?? false,
          createdBy: data.createdBy,
          createdAt: data.createdAt?.toDate?.() || new Date(),
          isActive: data.isActive ?? true,
          billingPlan: data.billingPlan ?? null,
        },
      }
    }
  )

  // ── DELETE /orgs/:orgId — org admin only; guarded against deleting an org
  // that still has children, bookings, or other active members ───────────────
  fastify.delete<{ Params: { orgId: string } }>(
    '/orgs/:orgId',
    {
      schema: {
        tags: ['Organizations'],
        summary:
          'Delete an organization (org admin only; blocked if it still has children, bookings, or other members)',
        params: orgIdParamsSchema,
        response: {
          200: okResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const { orgId } = request.params
      const member = await requireOrgMember(request, reply, orgId)
      if (reply.sent) return

      if (member.role !== 'org_admin') {
        return reply.code(403).send({ error: 'Only organization admins can perform this action' })
      }

      const db = getFirestore()

      const [childrenSnap, bookingsSnap, membersSnap] = await Promise.all([
        db.collection(`organizations/${orgId}/children`).limit(1).get(),
        db.collection(`organizations/${orgId}/bookings`).limit(1).get(),
        db.collection(`organizations/${orgId}/members`).where('status', '==', 'active').get(),
      ])

      if (!childrenSnap.empty) {
        return reply.code(400).send({
          error: 'Cannot delete an organization that still has children. Remove them first.',
        })
      }
      if (!bookingsSnap.empty) {
        return reply
          .code(400)
          .send({ error: 'Cannot delete an organization that has bookings. Remove them first.' })
      }
      if (membersSnap.size > 1) {
        return reply
          .code(400)
          .send({ error: 'Cannot delete an organization with other members. Remove them first.' })
      }

      const uid = request.user.uid
      const now = admin.firestore.Timestamp.fromDate(new Date())

      const batch = db.batch()
      batch.delete(db.doc(`organizations/${orgId}`))
      for (const doc of membersSnap.docs) {
        batch.delete(doc.ref)
      }
      batch.delete(db.doc(`specialists/${uid}/organizations/${orgId}`))
      await batch.commit()

      const specialistRef = db.doc(`specialists/${uid}`)
      const specialistSnap = await specialistRef.get()
      if (specialistSnap.exists && specialistSnap.data()?.orgId === orgId) {
        await specialistRef.update({
          orgId: admin.firestore.FieldValue.delete(),
          role: admin.firestore.FieldValue.delete(),
          updatedAt: now,
        })
      }

      return { ok: true }
    }
  )

  // Multipart form upload (file field "media" + optional "kind" field) — no
  // JSON `body` schema is declared since Fastify's JSON body validation does
  // not apply to multipart requests and could otherwise reject valid uploads.
  fastify.post<{ Params: { orgId: string } }>(
    '/orgs/:orgId/media',
    {
      schema: {
        tags: ['Organizations'],
        summary:
          'Upload a logo, cover, or gallery photo image for an organization (org admin only)',
        params: orgIdParamsSchema,
        response: {
          201: mediaUploadResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          413: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const { orgId } = request.params
      const member = await requireOrgMember(request, reply, orgId)
      if (reply.sent) return

      if (member.role !== 'org_admin') {
        return reply.code(403).send({ error: 'Only organization admins can perform this action' })
      }

      try {
        const parts = request.parts()
        let mediaBuffer: Buffer | null = null
        let mediaMimetype = ''
        let mediaFilename = 'image'
        let kind: 'logo' | 'cover' | 'photo' = 'logo'

        for await (const part of parts) {
          if (part.type === 'file' && part.fieldname === 'media') {
            const chunks: Buffer[] = []
            for await (const chunk of part.file) chunks.push(chunk)
            mediaBuffer = Buffer.concat(chunks)
            mediaMimetype = part.mimetype || ''
            mediaFilename = part.filename || 'image'
          } else if (part.type === 'field' && part.fieldname === 'kind') {
            kind = uploadKindSchema.parse((part as { value: string }).value)
          }
        }

        if (!mediaBuffer || mediaBuffer.length === 0) {
          return reply.code(400).send({ error: 'Image file is required' })
        }

        if (!mediaMimetype.startsWith('image/')) {
          return reply.code(400).send({ error: 'Only image uploads are allowed' })
        }

        const url = await uploadOrgMarketplaceImage(
          orgId,
          kind,
          mediaBuffer,
          mediaMimetype,
          mediaFilename
        )

        // For gallery photos — append URL to the photos[] array in Firestore
        if (kind === 'photo') {
          const db = getFirestore()
          await db
            .collection('organizations')
            .doc(orgId)
            .update({
              photos: admin.firestore.FieldValue.arrayUnion(url),
            })
        }

        return reply.code(201).send({ ok: true, kind, url })
      } catch (error: any) {
        if (error?.code === 'FST_FILES_LIMIT') {
          return reply.code(413).send({ error: 'Image file is too large' })
        }
        if (error instanceof z.ZodError) {
          return reply.code(400).send({ error: 'Invalid upload kind', issues: error.issues })
        }
        request.log.error(error, '[ORG_MEDIA_UPLOAD] Failed to upload org marketplace image')
        return reply.code(500).send({ error: 'Failed to upload image' })
      }
    }
  )

  // ── DELETE /orgs/:orgId/media/photo — remove a gallery photo URL ─────────────
  fastify.delete<{ Params: { orgId: string }; Body: { url: string } }>(
    '/orgs/:orgId/media/photo',
    {
      schema: {
        tags: ['Organizations'],
        summary: "Remove a photo URL from an organization's gallery (org admin only)",
        params: orgIdParamsSchema,
        body: deletePhotoBodySchema,
        response: {
          200: okResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const { orgId } = request.params
      const member = await requireOrgMember(request, reply, orgId)
      if (reply.sent) return
      if (member.role !== 'org_admin')
        return reply.code(403).send({ error: 'Only admins can delete photos' })

      const { url } = request.body as { url: string }
      if (!url) return reply.code(400).send({ error: 'url is required' })

      const db = getFirestore()
      await db
        .collection('organizations')
        .doc(orgId)
        .update({
          photos: admin.firestore.FieldValue.arrayRemove(url),
        })
      return reply.send({ ok: true })
    }
  )

  // ── In-memory cache for public org listing (TTL 5 min) ───────────────────────
  // Orgs don't change frequently; 5 min cache saves Firestore reads under load.
  const ORGS_CACHE_TTL = 5 * 60_000
  let _orgsCache: { data: Record<string, unknown>[]; expiresAt: number } | null = null

  function mapPublicOrg(id: string, raw: Record<string, unknown>) {
    const d = raw as any
    const logoUrl = d.logoUrl ?? null
    const coverImageUrl = d.coverImageUrl ?? null

    return {
      id,
      name: d.name ?? '',
      logoUrl,
      coverImageUrl,
      marketplaceLogoUrl: logoUrl,
      marketplaceCoverImageUrl: coverImageUrl,
      coverImage: coverImageUrl,
      imageUrl: coverImageUrl,
      logoPositionX: d.logoPositionX ?? null,
      logoPositionY: d.logoPositionY ?? null,
      logoScale: d.logoScale ?? null,
      coverPositionX: d.coverPositionX ?? null,
      coverPositionY: d.coverPositionY ?? null,
      coverScale: d.coverScale ?? null,
      description: d.description ?? null,
      country: d.country ?? null,
      city: d.city ?? null,
      address: d.address ?? null,
      categories: Array.isArray(d.categories) ? d.categories : [],
      contactPhone: d.contactPhone ?? null,
      whatsappNumber: d.whatsappNumber ?? null,
      websiteUrl: d.websiteUrl ?? null,
      reviewCount: (d.reviewCount as number) ?? 0,
      averageRating: (d.averageRating as number) ?? 0,
      plan: d.nurooPlan ?? d.plan ?? 'nuroo_business',
      isOnline: d.isOnline === true,
      priceFrom: (d.priceFrom as number) ?? null,
      currency: (d.currency as string) ?? 'KGS',
      ageMin: (d.ageMin as number) ?? null,
      ageMax: (d.ageMax as number) ?? null,
      lat: typeof d.lat === 'number' ? d.lat : null,
      lng: typeof d.lng === 'number' ? d.lng : null,
      photos: Array.isArray(d.photos)
        ? (d.photos as string[]).filter(
            (p: string) => typeof p === 'string' && p.startsWith('http')
          )
        : [],
    }
  }

  // ── GET /api/organizations/public/:id — single org, for org-detail screens ───
  fastify.get<{ Params: { id: string } }>(
    '/api/organizations/public/:id',
    {
      schema: {
        tags: ['Organizations'],
        summary: 'Get a single public marketplace organization profile (no auth required)',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', description: 'Organization ID' } },
        },
        response: {
          200: {
            type: 'object',
            required: ['ok', 'organization'],
            properties: { ok: { type: 'boolean' }, organization: publicOrgSchema },
          },
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const db = getFirestore()
      const doc = await db.collection('organizations').doc(request.params.id).get()
      const d = doc.data()
      if (!doc.exists || !d || d.isPublicMarketplaceEnabled !== true) {
        return reply.code(404).send({ error: 'Organization not found' })
      }

      reply.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
      return { ok: true, organization: mapPublicOrg(doc.id, d) }
    }
  )

  // ── GET /api/organizations/public — unauthenticated marketplace listing ───────
  fastify.get<{
    Querystring: { category?: string; search?: string; country?: string; city?: string }
  }>(
    '/api/organizations/public',
    {
      schema: {
        tags: ['Organizations'],
        summary: 'List public marketplace organizations with optional filters (no auth required)',
        querystring: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            search: { type: 'string' },
            country: { type: 'string' },
            city: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['ok', 'organizations'],
            properties: {
              ok: { type: 'boolean' },
              organizations: { type: 'array', items: publicOrgSchema },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const db = getFirestore()
      const { category, search, country, city } = request.query

      // Serve from cache when no filters (most common case: initial marketplace load)
      let orgsRaw: Record<string, unknown>[]
      if (
        !category &&
        !search &&
        !country &&
        !city &&
        _orgsCache &&
        Date.now() < _orgsCache.expiresAt
      ) {
        orgsRaw = _orgsCache.data
      } else {
        const snap = await db
          .collection('organizations')
          .where('isPublicMarketplaceEnabled', '==', true)
          .limit(200)
          .get()
        orgsRaw = snap.docs.map((doc) => ({ _id: doc.id, ...doc.data() }))
        if (!category && !search && !country && !city) {
          _orgsCache = { data: orgsRaw, expiresAt: Date.now() + ORGS_CACHE_TTL }
        }
      }

      const orgs = orgsRaw.map((raw) => mapPublicOrg((raw as any)._id, raw))

      // Server-side filters (client can also filter, but this reduces payload)
      let result = orgs.filter((o) => o.name)

      if (category && category !== 'All') {
        const lc = category.toLowerCase()
        result = result.filter((o) =>
          o.categories.some((c: string) => c.toLowerCase().includes(lc))
        )
      }
      if (country) {
        result = result.filter((o) => o.country?.toLowerCase() === country.toLowerCase())
      }
      if (city) {
        result = result.filter((o) => o.city?.toLowerCase().includes(city.toLowerCase()))
      }
      if (search) {
        const q = search.toLowerCase()
        result = result.filter(
          (o) =>
            o.name.toLowerCase().includes(q) ||
            (o.description ?? '').toLowerCase().includes(q) ||
            (o.city ?? '').toLowerCase().includes(q) ||
            o.categories.some((c: string) => c.toLowerCase().includes(q))
        )
      }

      reply.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
      return { ok: true, organizations: result }
    }
  )
}

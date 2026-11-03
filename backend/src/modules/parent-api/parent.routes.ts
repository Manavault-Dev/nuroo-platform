import { FastifyPluginAsync } from 'fastify'
import admin from 'firebase-admin'
import { z } from 'zod'
import { listChildSpecialists, listChildNotes, listParentLinkedChildren } from './parent.service.js'
import { getFirestore } from '../../infrastructure/database/firebase.js'
import {
  listInvoices,
  getInvoice,
  type InvoiceDoc,
} from '../../domains/payments/invoice.service.js'
import { getOrgPaymentProvider } from '../../domains/payments/providers/registry.js'
import { dispatch as sendNotification } from '../../modules/notifications/notification.service.js'
import { config } from '../../config/index.js'
import {
  parseDataImageUrl,
  uploadOrgMarketplaceImage,
  imageSourceSchema,
  safeHttpUrlSchema,
} from '../../domains/organizations/orgs.routes.js'
import { FREE_TRIAL_DAYS, FREE_TRIAL_PLAN_ID } from '../../domains/payments/planLimits.js'
import { geocodeAddress } from '../../infrastructure/geocoding/googleGeocoding.service.js'

/** Deep link scheme used by the Nuroo mobile app */
const MOBILE_DEEP_LINK_SCHEME = 'nuroo'

/**
 * For past-due upcoming invoices: persist status=pending + Finik paymentUrl to Firestore
 * so the parent can pay immediately without waiting for the nightly cron.
 * Also marks past-due pending invoices as overdue in the response.
 *
 * The Firestore writes run fire-and-forget — we return the upgraded list immediately
 * and let the writes complete in the background.
 */
async function lazyUpgradeInvoices(
  db: FirebaseFirestore.Firestore,
  invoices: InvoiceDoc[]
): Promise<InvoiceDoc[]> {
  const todayISO = new Date().toISOString().split('T')[0]
  const ts = admin.firestore.FieldValue.serverTimestamp()
  const backendUrl = (config.BACKEND_PUBLIC_URL ?? 'http://localhost:3101').replace(/\/$/, '')

  // Process all invoices concurrently instead of sequentially
  return Promise.all(
    invoices.map(async (inv): Promise<InvoiceDoc> => {
      // Upgrade past-due pending → overdue in response
      if (inv.status === 'pending' && inv.dueDate && inv.dueDate < todayISO) {
        // Persist overdue status fire-and-forget
        db.doc(`organizations/${inv.orgId}/invoices/${inv.id}`)
          .update({ status: 'overdue', updatedAt: ts })
          .catch(() => {
            /* best-effort */
          })
        return { ...inv, status: 'overdue' as const }
      }

      // Upgrade past-due upcoming → pending + generate Finik payment URL (if not already set)
      if (inv.status === 'upcoming' && inv.dueDate && inv.dueDate <= todayISO) {
        // Skip Finik call if a payment URL was already generated
        if (inv.paymentUrl) {
          db.doc(`organizations/${inv.orgId}/invoices/${inv.id}`)
            .update({ status: 'pending', updatedAt: ts })
            .catch(() => {
              /* best-effort */
            })
          return { ...inv, status: 'pending' as const }
        }

        let paymentUrl: string | null = null
        let providerPaymentId: string | null = null

        try {
          const provider = await getOrgPaymentProvider(db, inv.orgId, 'finik')
          if (provider) {
            const pr = await provider.createInvoice({
              orgId: inv.orgId,
              parentId: inv.parentId,
              childId: inv.childId,
              amount: inv.amount,
              currency: inv.currency,
              description: inv.description,
              dueDate: inv.dueDate,
              invoiceId: inv.id,
              callbackUrl: `${backendUrl}/webhooks/finik`,
              // Return URL uses the mobile deep link so the app regains focus after payment
              returnUrl: `${MOBILE_DEEP_LINK_SCHEME}://invoices/${inv.id}?status=paid`,
            })
            paymentUrl = pr.paymentUrl
            providerPaymentId = pr.providerPaymentId
          }
        } catch {
          /* provider not configured or errored — still upgrade to pending */
        }

        // Persist upgrade fire-and-forget
        db.doc(`organizations/${inv.orgId}/invoices/${inv.id}`)
          .update({
            status: 'pending',
            paymentUrl: paymentUrl ?? null,
            providerPaymentId: providerPaymentId ?? null,
            updatedAt: ts,
          })
          .catch(() => {
            /* best-effort */
          })

        // Push notification fire-and-forget
        sendNotification({
          userId: inv.parentId,
          orgId: inv.orgId,
          role: 'parent',
          type: 'invoice_due',
          category: 'billingUpdates',
          title: '💳 Счёт к оплате',
          body: `Срок оплаты ${inv.amount} ${inv.currency} — ${inv.dueDate}. Нажмите, чтобы оплатить.`,
          metadata: { orgId: inv.orgId, parentId: inv.parentId, childId: inv.childId },
          channel: 'both',
          priority: 'high',
          dedupKey: `invoice_due_${inv.id}`,
        }).catch(() => {
          /* best-effort */
        })

        return { ...inv, status: 'pending' as const, paymentUrl: paymentUrl ?? undefined }
      }

      return inv
    })
  )
}

// Covers the two routes below, which accept base64 logo/cover/gallery
// images (up to 15MB body) — keeps repeated-upload storage-write/cost abuse
// in check without blocking a normal "fill out my org profile" session.
const RATE_PROFILE_WRITE = { max: 10, timeWindow: '1 minute' }

const phoneSchema = z
  .string()
  .trim()
  .max(50)
  .regex(/^[+\d\s\-().]*$/, 'Invalid phone format')

const createBasicOrgSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    country: z.string().trim().max(100).optional(),
    description: z.string().trim().max(1000).optional(),
    address: z.string().trim().max(300).optional(),
    contactPhone: phoneSchema.optional(),
    whatsappNumber: phoneSchema.optional(),
    websiteUrl: safeHttpUrlSchema(500).optional().or(z.literal('')),
    categories: z.array(z.string().trim().max(100)).max(20).optional(),
    logoUrl: imageSourceSchema.optional(),
    coverImageUrl: imageSourceSchema.optional().or(z.literal('')),
    photos: z.array(imageSourceSchema).max(8).optional(),
  })
  .refine((body) => !!(body.contactPhone || body.whatsappNumber), {
    message: 'At least one contact method (contactPhone or whatsappNumber) is required',
  })

const imagePositionSchema = z.number().min(0).max(100).optional().nullable()
const imageScaleSchema = z.number().min(1).max(2).optional().nullable()

const updateBasicOrgSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).optional(),
  address: z.string().trim().max(300).optional(),
  contactPhone: phoneSchema.optional(),
  whatsappNumber: phoneSchema.optional(),
  websiteUrl: safeHttpUrlSchema(500).optional().or(z.literal('')),
  categories: z.array(z.string().trim().max(100)).max(20).optional(),
  logoUrl: imageSourceSchema.optional(),
  coverImageUrl: imageSourceSchema.optional().or(z.literal('')),
  logoPositionX: imagePositionSchema,
  logoPositionY: imagePositionSchema,
  logoScale: imageScaleSchema,
  coverPositionX: imagePositionSchema,
  coverPositionY: imagePositionSchema,
  coverScale: imageScaleSchema,
  // Full-replace, not incremental — the client always sends the complete
  // desired gallery, same as how the basic-org creator has no membership
  // doc to authorize the org-admin-only incremental /media endpoints.
  photos: z.array(imageSourceSchema).max(8).optional(),
})

export const parentApiRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { childId: string } }>(
    '/api/parent/children/:childId/specialists',
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const { uid: parentUid } = request.user
      const { childId } = request.params

      try {
        const specialists = await listChildSpecialists(childId, parentUid)
        return { ok: true, specialists }
      } catch (error: unknown) {
        console.error('Error getting child specialists:', error)
        if (error instanceof Error && error.message?.includes('Access denied')) {
          return reply.code(403).send({ error: error.message })
        }
        return reply
          .code(500)
          .send({ error: error instanceof Error ? error.message : 'Failed to get specialists' })
      }
    }
  )

  fastify.get<{ Params: { childId: string } }>(
    '/api/parent/children/:childId/notes',
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const { uid: parentUid } = request.user
      const { childId } = request.params

      try {
        const notes = await listChildNotes(childId, parentUid)
        return { ok: true, notes }
      } catch (error: unknown) {
        console.error('Error getting child notes:', error)
        if (error instanceof Error && error.message?.includes('Access denied')) {
          return reply.code(403).send({ error: error.message })
        }
        return reply
          .code(500)
          .send({ error: error instanceof Error ? error.message : 'Failed to get notes' })
      }
    }
  )

  fastify.get('/api/parent/children', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }

    const { uid: parentUid } = request.user

    try {
      const childIds = await listParentLinkedChildren(parentUid)
      return { ok: true, childIds }
    } catch (error: unknown) {
      console.error('Error getting parent children:', error)
      return reply
        .code(500)
        .send({ error: error instanceof Error ? error.message : 'Failed to get children' })
    }
  })

  // GET /api/parent/invoices — parent sees their own invoices across all linked orgs
  fastify.get<{ Querystring: { orgId?: string; limit?: string } }>(
    '/api/parent/invoices',
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const { uid: parentUid } = request.user
      const { orgId, limit } = request.query
      const db = getFirestore()

      try {
        if (orgId) {
          // Query a specific org's invoices for this parent
          const invoices = await listInvoices(db, orgId, {
            parentId: parentUid,
            limit: limit ? parseInt(limit, 10) : 50,
          })
          return { ok: true, invoices: await lazyUpgradeInvoices(db, invoices) }
        }

        // No orgId: discover all orgs the parent is linked to.
        // The mobile app stores linked orgs in users/{uid}.linkedOrganizationsById
        // (a map of { [key]: { orgId, orgName } }). We also check the legacy
        // parents/{uid}.linkedOrganizations array for back-compat.
        const [userSnap, parentSnap] = await Promise.all([
          db.doc(`users/${parentUid}`).get(),
          db.doc(`parents/${parentUid}`).get(),
        ])

        const linkedOrgs: string[] = []
        const seen = new Set<string>()

        const addOrg = (orgId: string) => {
          if (orgId && !seen.has(orgId)) {
            seen.add(orgId)
            linkedOrgs.push(orgId)
          }
        }

        if (userSnap.exists) {
          const userData = userSnap.data()!
          const byId = (userData.linkedOrganizationsById || {}) as Record<
            string,
            { orgId?: string }
          >
          for (const [key, val] of Object.entries(byId)) {
            addOrg(val.orgId || key)
          }
          const arr = (userData.linkedOrganizations || []) as Array<{ orgId: string }>
          arr.forEach((o) => addOrg(o.orgId))
        }

        if (parentSnap.exists) {
          const parentData = parentSnap.data()!
          const arr = (parentData.linkedOrganizations || []) as Array<{ orgId: string }>
          arr.forEach((o) => addOrg(o.orgId))
        }

        if (linkedOrgs.length === 0) {
          return { ok: true, invoices: [] }
        }

        const allInvoices = (
          await Promise.all(
            linkedOrgs.map((oid) =>
              listInvoices(db, oid, {
                parentId: parentUid,
                limit: limit ? parseInt(limit, 10) : 50,
              })
            )
          )
        ).flat()

        // Sort by createdAt desc
        allInvoices.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

        return { ok: true, invoices: await lazyUpgradeInvoices(db, allInvoices) }
      } catch (error: unknown) {
        console.error('Error getting parent invoices:', error)
        return reply
          .code(500)
          .send({ error: error instanceof Error ? error.message : 'Failed to get invoices' })
      }
    }
  )

  // POST /api/parent/invoices/:orgId/:invoiceId/payment-url
  // Regenerate payment URL for an existing invoice where paymentUrl is null.
  // This happens when Finik wasn't configured at invoice creation time.
  fastify.post<{ Params: { orgId: string; invoiceId: string } }>(
    '/api/parent/invoices/:orgId/:invoiceId/payment-url',
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const { uid: parentUid } = request.user
      const { orgId, invoiceId } = request.params
      const db = getFirestore()

      try {
        const invoice = await getInvoice(db, orgId, invoiceId)

        if (!invoice) {
          return reply.code(404).send({ error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' })
        }

        // Security: parent can only fetch their own invoice's payment URL
        if (invoice.parentId !== parentUid) {
          return reply.code(403).send({ error: 'Forbidden', code: 'FORBIDDEN' })
        }

        if (invoice.status === 'paid' || invoice.status === 'canceled') {
          return reply.code(409).send({
            error: `Invoice is ${invoice.status} — payment URL not applicable`,
            code: 'INVALID_STATUS',
          })
        }

        // Treat upcoming as pending when requested by parent (due date has passed by definition
        // since the mobile shows Get payment link only for pending/overdue)
        const effectiveStatus = invoice.status === 'upcoming' ? 'pending' : invoice.status

        // If URL already exists, just return it
        if (invoice.paymentUrl) {
          return { ok: true, paymentUrl: invoice.paymentUrl }
        }

        // Try to generate a new payment URL via the provider
        const provider = await getOrgPaymentProvider(db, orgId, 'finik')
        if (!provider) {
          return reply.code(422).send({
            error: 'Payment provider is not configured for this organization',
            code: 'PROVIDER_NOT_CONFIGURED',
          })
        }

        const backendUrl = (config.BACKEND_PUBLIC_URL ?? 'http://localhost:3101').replace(/\/$/, '')

        const providerResult = await provider.createInvoice({
          orgId,
          parentId: invoice.parentId,
          childId: invoice.childId,
          amount: invoice.amount,
          currency: invoice.currency,
          description: invoice.description,
          dueDate: invoice.dueDate,
          invoiceId,
          callbackUrl: `${backendUrl}/webhooks/finik`,
          // Deep link returns the parent to the mobile app after payment completes
          returnUrl: `${MOBILE_DEEP_LINK_SCHEME}://invoices/${invoiceId}?status=paid`,
        })

        // Persist the generated URL (and upgrade upcoming→pending) so subsequent calls return it instantly
        await db.doc(`organizations/${orgId}/invoices/${invoiceId}`).update({
          status: effectiveStatus,
          paymentUrl: providerResult.paymentUrl,
          providerPaymentId: providerResult.providerPaymentId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })

        return { ok: true, paymentUrl: providerResult.paymentUrl }
      } catch (error: unknown) {
        console.error('Error generating payment URL:', error)
        return reply.code(500).send({
          error: error instanceof Error ? error.message : 'Failed to generate payment URL',
          code: 'PAYMENT_URL_FAILED',
        })
      }
    }
  )

  // POST /api/parent/organizations — self-serve "basic" organization (contact
  // card only, no booking, no specialists). Intentionally never writes
  // organizations/{orgId}/members/{uid} or specialists/{uid} — doing so would
  // flip the creator's role to 'specialist'/'organizer' on their next /me
  // call and lock them out of the parent-facing mobile UI.
  fastify.post(
    '/api/parent/organizations',
    // Base64 cover/gallery images can push the JSON body well past Fastify's
    // 1 MiB default — see the same note on the PATCH route below.
    { bodyLimit: 15 * 1024 * 1024, config: { rateLimit: RATE_PROFILE_WRITE } },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }
      const { uid } = request.user

      const parsed = createBasicOrgSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid request' })
      }
      const {
        name,
        country,
        description,
        address,
        contactPhone,
        whatsappNumber,
        websiteUrl,
        categories,
        logoUrl,
        coverImageUrl,
        photos,
      } = parsed.data

      try {
        const db = getFirestore()

        const dupSnap = await db
          .collection('organizations')
          .where('createdBy', '==', uid)
          .where('name', '==', name)
          .limit(1)
          .get()
        if (!dupSnap.empty) {
          return reply.code(409).send({ error: 'You already have an organization with this name' })
        }

        const orgRef = db.collection('organizations').doc()

        const uploadImageField = async (value: string, kind: 'logo' | 'cover' | 'photo') => {
          const parsedImage = parseDataImageUrl(value)
          return parsedImage
            ? uploadOrgMarketplaceImage(
                orgRef.id,
                kind,
                parsedImage.buffer,
                parsedImage.mimeType,
                kind
              )
            : value
        }

        const uploadedLogoUrl = logoUrl ? await uploadImageField(logoUrl, 'logo') : null
        const uploadedCoverUrl = coverImageUrl
          ? await uploadImageField(coverImageUrl, 'cover')
          : null
        const uploadedPhotos = photos
          ? await Promise.all(photos.map((photo) => uploadImageField(photo, 'photo')))
          : []

        const geocoded = address
          ? await geocodeAddress(address, { country: country ?? null })
          : null

        await orgRef.set({
          name,
          country: country ?? null,
          description: description ?? null,
          address: address ?? null,
          lat: geocoded?.lat ?? null,
          lng: geocoded?.lng ?? null,
          contactPhone: contactPhone ?? null,
          whatsappNumber: whatsappNumber ?? null,
          websiteUrl: websiteUrl ?? null,
          categories: categories ?? [],
          logoUrl: uploadedLogoUrl,
          coverImageUrl: uploadedCoverUrl,
          photos: uploadedPhotos,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: uid,
          isActive: true,
          isPublicMarketplaceEnabled: true,
          tier: 'basic',
          createdVia: 'mobile_basic',
        })

        return {
          ok: true,
          orgId: orgRef.id,
          name,
          logoUrl: uploadedLogoUrl,
          contactPhone: contactPhone ?? null,
          whatsappNumber: whatsappNumber ?? null,
          isPublicMarketplaceEnabled: true,
        }
      } catch (error: unknown) {
        console.error('Error creating basic organization:', error)
        return reply
          .code(500)
          .send({ error: error instanceof Error ? error.message : 'Failed to create organization' })
      }
    }
  )

  // GET /api/parent/organizations/basic — basic-tier orgs this parent created
  fastify.get('/api/parent/organizations/basic', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
    const { uid } = request.user

    try {
      const db = getFirestore()
      const snap = await db.collection('organizations').where('createdBy', '==', uid).get()

      const organizations = snap.docs
        .map((doc) => ({ id: doc.id, data: doc.data() }))
        .filter(({ data }) => data.tier === 'basic')
        .map(({ id, data }) => ({
          orgId: id,
          name: data.name as string,
          description: (data.description as string | null) ?? null,
          address: (data.address as string | null) ?? null,
          categories: Array.isArray(data.categories) ? (data.categories as string[]) : [],
          logoUrl: (data.logoUrl as string | null) ?? null,
          coverImageUrl: (data.coverImageUrl as string | null) ?? null,
          photos: Array.isArray(data.photos) ? (data.photos as string[]) : [],
          contactPhone: (data.contactPhone as string | null) ?? null,
          whatsappNumber: (data.whatsappNumber as string | null) ?? null,
          websiteUrl: (data.websiteUrl as string | null) ?? null,
          isPublicMarketplaceEnabled: !!data.isPublicMarketplaceEnabled,
          createdAt: data.createdAt ?? null,
        }))

      return { ok: true, organizations }
    } catch (error: unknown) {
      console.error('Error listing basic organizations:', error)
      return reply
        .code(500)
        .send({ error: error instanceof Error ? error.message : 'Failed to list organizations' })
    }
  })

  // PATCH /api/parent/organizations/:orgId — edit a basic-tier org, scoped by createdBy
  // (not full org_admin RBAC — the creator has no membership doc until they claim-admin below)
  fastify.patch<{ Params: { orgId: string }; Body: z.infer<typeof updateBasicOrgSchema> }>(
    '/api/parent/organizations/:orgId',
    // Base64 cover/gallery images can push the JSON body well past Fastify's
    // 1 MiB default — mobile already sends the logo this way (no multipart
    // upload route exists for a creator who isn't an org member yet).
    { bodyLimit: 15 * 1024 * 1024, config: { rateLimit: RATE_PROFILE_WRITE } },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }
      const { uid } = request.user
      const { orgId } = request.params

      const parsed = updateBasicOrgSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid request' })
      }

      try {
        const db = getFirestore()
        const orgRef = db.doc(`organizations/${orgId}`)
        const snap = await orgRef.get()
        if (!snap.exists) return reply.code(404).send({ error: 'Organization not found' })
        const data = snap.data()!
        if (data.createdBy !== uid) return reply.code(403).send({ error: 'Forbidden' })
        if (data.tier !== 'basic') {
          return reply
            .code(400)
            .send({ error: 'This organization is already managed from the dashboard' })
        }

        const update: Record<string, unknown> = {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }
        if (parsed.data.name !== undefined) update.name = parsed.data.name
        if (parsed.data.description !== undefined)
          update.description = parsed.data.description || null
        if (parsed.data.address !== undefined) {
          update.address = parsed.data.address || null
          if (parsed.data.address) {
            const geocoded = await geocodeAddress(parsed.data.address, {
              country: (data.country as string | null) ?? null,
            })
            update.lat = geocoded?.lat ?? null
            update.lng = geocoded?.lng ?? null
          } else {
            update.lat = null
            update.lng = null
          }
        }
        if (parsed.data.contactPhone !== undefined)
          update.contactPhone = parsed.data.contactPhone || null
        if (parsed.data.whatsappNumber !== undefined)
          update.whatsappNumber = parsed.data.whatsappNumber || null
        if (parsed.data.websiteUrl !== undefined) update.websiteUrl = parsed.data.websiteUrl || null
        if (parsed.data.categories !== undefined) update.categories = parsed.data.categories
        if (parsed.data.logoPositionX !== undefined)
          update.logoPositionX = parsed.data.logoPositionX
        if (parsed.data.logoPositionY !== undefined)
          update.logoPositionY = parsed.data.logoPositionY
        if (parsed.data.logoScale !== undefined) update.logoScale = parsed.data.logoScale
        if (parsed.data.coverPositionX !== undefined)
          update.coverPositionX = parsed.data.coverPositionX
        if (parsed.data.coverPositionY !== undefined)
          update.coverPositionY = parsed.data.coverPositionY
        if (parsed.data.coverScale !== undefined) update.coverScale = parsed.data.coverScale

        const uploadImageField = async (value: string, kind: 'logo' | 'cover' | 'photo') => {
          const parsedImage = parseDataImageUrl(value)
          return parsedImage
            ? uploadOrgMarketplaceImage(orgId, kind, parsedImage.buffer, parsedImage.mimeType, kind)
            : value
        }

        if (parsed.data.logoUrl !== undefined) {
          update.logoUrl = parsed.data.logoUrl
            ? await uploadImageField(parsed.data.logoUrl, 'logo')
            : null
        }
        if (parsed.data.coverImageUrl !== undefined) {
          update.coverImageUrl = parsed.data.coverImageUrl
            ? await uploadImageField(parsed.data.coverImageUrl, 'cover')
            : null
        }
        if (parsed.data.photos !== undefined) {
          update.photos = await Promise.all(
            parsed.data.photos.map((photo) => uploadImageField(photo, 'photo'))
          )
        }

        await orgRef.update(update)
        return { ok: true }
      } catch (error: unknown) {
        console.error('Error updating basic organization:', error)
        return reply
          .code(500)
          .send({ error: error instanceof Error ? error.message : 'Failed to update organization' })
      }
    }
  )

  // DELETE /api/parent/organizations/:orgId — only before admin claim (createdBy-scoped)
  fastify.delete<{ Params: { orgId: string } }>(
    '/api/parent/organizations/:orgId',
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }
      const { uid } = request.user
      const { orgId } = request.params

      try {
        const db = getFirestore()
        const orgRef = db.doc(`organizations/${orgId}`)
        const snap = await orgRef.get()
        if (!snap.exists) return reply.code(404).send({ error: 'Organization not found' })
        const data = snap.data()!
        if (data.createdBy !== uid) return reply.code(403).send({ error: 'Forbidden' })
        if (data.tier !== 'basic') {
          return reply
            .code(400)
            .send({ error: 'This organization is already managed from the dashboard' })
        }

        await orgRef.delete()
        return { ok: true }
      } catch (error: unknown) {
        console.error('Error deleting basic organization:', error)
        return reply
          .code(500)
          .send({ error: error instanceof Error ? error.message : 'Failed to delete organization' })
      }
    }
  )

  // POST /api/parent/organizations/:orgId/claim-admin — upgrade a basic-tier org to a
  // fully-managed organization: grants the creator org_admin membership (same shape as
  // POST /orgs) and starts their free trial. One-way — the creator's /me-derived role
  // then flips to 'organizer' and the mobile role-gate redirects them to the web dashboard,
  // the same mechanism as any other org admin.
  fastify.post<{ Params: { orgId: string } }>(
    '/api/parent/organizations/:orgId/claim-admin',
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }
      const { uid, email } = request.user
      const { orgId } = request.params

      try {
        const db = getFirestore()
        const orgRef = db.doc(`organizations/${orgId}`)
        const snap = await orgRef.get()
        if (!snap.exists) return reply.code(404).send({ error: 'Organization not found' })
        const data = snap.data()!
        if (data.createdBy !== uid) return reply.code(403).send({ error: 'Forbidden' })

        const memberRef = orgRef.collection('members').doc(uid)
        const memberSnap = await memberRef.get()
        if (memberSnap.exists) {
          return reply.code(409).send({ error: 'Already an admin of this organization' })
        }

        const now = new Date()
        const trialExpiresAt = new Date(now)
        trialExpiresAt.setDate(trialExpiresAt.getDate() + FREE_TRIAL_DAYS)

        await orgRef.update({
          nurooPlan: 'nuroo_business',
          tier: admin.firestore.FieldValue.delete(),
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
          updatedAt: admin.firestore.Timestamp.fromDate(now),
        })

        await memberRef.set({
          uid,
          role: 'org_admin',
          status: 'active',
          joinedAt: admin.firestore.Timestamp.fromDate(now),
        })

        await db.doc(`specialists/${uid}/organizations/${orgId}`).set({
          orgId,
          orgName: data.name,
          country: data.country ?? null,
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

        return { ok: true, orgId }
      } catch (error: unknown) {
        console.error('Error claiming organization admin:', error)
        return reply
          .code(500)
          .send({ error: error instanceof Error ? error.message : 'Failed to claim organization' })
      }
    }
  )
}

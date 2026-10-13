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
} from '../../domains/organizations/orgs.routes.js'

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

const phoneSchema = z
  .string()
  .trim()
  .max(50)
  .regex(/^[+\d\s\-().]*$/, 'Invalid phone format')

const createBasicOrgSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    country: z.string().trim().max(100).optional(),
    contactPhone: phoneSchema.optional(),
    whatsappNumber: phoneSchema.optional(),
    logoUrl: imageSourceSchema.optional(),
  })
  .refine((body) => !!(body.contactPhone || body.whatsappNumber), {
    message: 'At least one contact method (contactPhone or whatsappNumber) is required',
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
  fastify.post('/api/parent/organizations', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
    const { uid } = request.user

    const parsed = createBasicOrgSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid request' })
    }
    const { name, country, contactPhone, whatsappNumber, logoUrl } = parsed.data

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

      let uploadedLogoUrl: string | null = null
      if (logoUrl) {
        const parsedImage = parseDataImageUrl(logoUrl)
        if (parsedImage) {
          uploadedLogoUrl = await uploadOrgMarketplaceImage(
            orgRef.id,
            'logo',
            parsedImage.buffer,
            parsedImage.mimeType,
            'logo'
          )
        } else {
          // Already a plain URL (not a data: upload) — store as-is.
          uploadedLogoUrl = logoUrl
        }
      }

      await orgRef.set({
        name,
        country: country ?? null,
        contactPhone: contactPhone ?? null,
        whatsappNumber: whatsappNumber ?? null,
        logoUrl: uploadedLogoUrl,
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
  })

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
          logoUrl: (data.logoUrl as string | null) ?? null,
          contactPhone: (data.contactPhone as string | null) ?? null,
          whatsappNumber: (data.whatsappNumber as string | null) ?? null,
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
}

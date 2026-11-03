import { FastifyPluginAsync } from 'fastify'
import admin from 'firebase-admin'
import { z } from 'zod'

import { getFirestore } from '../../infrastructure/database/firebase.js'
import { writeAudit } from '../../infrastructure/audit/audit.js'

/**
 * Claim-request flow for imported/unclaimed marketplace listings. Submitting
 * a claim never grants access by itself — it only creates a reviewable
 * request (organizations/{orgId}/claims/{claimId}) and flips the org to
 * 'pending_verification' so no second claim can be submitted concurrently.
 * Granting org_admin membership happens in the separate admin-review step
 * in orgClaimsAdmin.routes.ts (approve/reject), reusing the same grant
 * shape (member doc + specialist index + trial billing) as the existing
 * self-serve claim-admin route in parent.routes.ts — the only difference is
 * who triggers it and that it targets an imported listing instead of a
 * self-created basic org.
 */

const submitClaimSchema = z.object({
  contactName: z.string().trim().max(200).optional(),
  contactPhone: z
    .string()
    .trim()
    .max(50)
    .regex(/^[+\d\s\-().]*$/, 'Invalid phone format')
    .optional(),
  note: z.string().trim().max(1000).optional(),
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

const RATE_CLAIM_WRITE = { max: 10, timeWindow: '1 minute' }
const RATE_CLAIM_READ = { max: 60, timeWindow: '1 minute' }

export const orgClaimsRoute: FastifyPluginAsync = async (fastify) => {
  // POST /orgs/:orgId/claim — authenticated user requests ownership of an
  // unclaimed (imported) listing. Does not grant anything by itself.
  fastify.post<{
    Params: { orgId: string }
    Body: z.infer<typeof submitClaimSchema>
  }>(
    '/orgs/:orgId/claim',
    {
      config: { rateLimit: RATE_CLAIM_WRITE },
      schema: {
        tags: ['Organizations'],
        summary: 'Request ownership of an unclaimed marketplace organization listing',
        params: orgIdParamsSchema,
        body: {
          type: 'object',
          additionalProperties: true,
          properties: {
            contactName: { type: 'string', maxLength: 200 },
            contactPhone: { type: 'string', maxLength: 50 },
            note: { type: 'string', maxLength: 1000 },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['ok', 'claimId', 'status'],
            properties: {
              ok: { type: 'boolean' },
              claimId: { type: 'string' },
              status: { type: 'string' },
            },
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const { orgId } = request.params
      const parsed = submitClaimSchema.safeParse(request.body ?? {})
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid request' })
      }
      const { contactName, contactPhone, note } = parsed.data
      const uid = request.user.uid

      try {
        const db = getFirestore()
        const orgRef = db.doc(`organizations/${orgId}`)
        const claimsRef = orgRef.collection('claims')

        const result = await db.runTransaction(async (tx) => {
          const orgSnap = await tx.get(orgRef)
          if (!orgSnap.exists) {
            return { error: { code: 404, message: 'Organization not found' } } as const
          }

          const orgData = orgSnap.data()!

          // One active (pending) claim per org — equality-only filter, no
          // orderBy, so this never needs a composite index. Checked before
          // the status guard below so a legitimate re-request (double-tap,
          // retry) from the same claimant is idempotent even though the
          // first request already flipped the org out of 'unclaimed'.
          const pendingSnap = await tx.get(claimsRef.where('status', '==', 'pending').limit(1))
          if (!pendingSnap.empty) {
            const existing = pendingSnap.docs[0].data()
            if (existing.uid === uid) {
              return {
                ok: true as const,
                claimId: pendingSnap.docs[0].id,
                status: 'pending' as const,
              }
            }
            return {
              error: {
                code: 409,
                message: 'This organization already has a pending claim request',
              },
            } as const
          }

          if (orgData.status !== 'unclaimed') {
            return {
              error: { code: 409, message: 'This organization cannot be claimed' },
            } as const
          }

          const now = admin.firestore.Timestamp.now()
          const claimRef = claimsRef.doc()
          tx.set(claimRef, {
            uid,
            status: 'pending',
            contactName: contactName || null,
            contactPhone: contactPhone || null,
            note: note || null,
            submittedAt: now,
            reviewedAt: null,
            reviewedBy: null,
          })
          tx.update(orgRef, { status: 'pending_verification' })

          return { ok: true as const, claimId: claimRef.id, status: 'pending' as const }
        })

        if ('error' in result) {
          return reply.code(result.error.code).send({ error: result.error.message })
        }

        writeAudit({
          db,
          orgId,
          entityType: 'organization',
          entityId: orgId,
          action: 'organization.claim_submitted',
          actorId: uid,
          actorRole: 'parent',
          after: { claimId: result.claimId, status: 'pending' },
        })

        return result
      } catch (error: unknown) {
        fastify.log.error({ err: error }, 'Failed to submit organization claim')
        return reply
          .code(500)
          .send({ error: error instanceof Error ? error.message : 'Failed to submit claim' })
      }
    }
  )

  // GET /orgs/:orgId/claim — status for the CTA: whether this org can be
  // claimed, and whether the current user already has a claim pending/
  // rejected on it. Deliberately authenticated-only (not folded into the
  // public org response) so claim state is never exposed to anonymous
  // marketplace browsing.
  fastify.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId/claim',
    {
      config: { rateLimit: RATE_CLAIM_READ },
      schema: {
        tags: ['Organizations'],
        summary: "Get the claim CTA state for an organization and the current user's own claim",
        params: orgIdParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'claimable', 'myClaim'],
            properties: {
              ok: { type: 'boolean' },
              claimable: { type: 'boolean' },
              myClaim: {
                type: ['object', 'null'],
                properties: {
                  id: { type: 'string' },
                  status: { type: 'string' },
                },
              },
            },
          },
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }
      const { orgId } = request.params
      const uid = request.user.uid

      const db = getFirestore()
      const orgSnap = await db.doc(`organizations/${orgId}`).get()
      if (!orgSnap.exists) {
        return reply.code(404).send({ error: 'Organization not found' })
      }
      const orgStatus = orgSnap.data()?.status ?? null

      const mySnap = await db
        .collection(`organizations/${orgId}/claims`)
        .where('uid', '==', uid)
        .limit(5)
        .get()

      let myClaim: { id: string; status: string } | null = null
      for (const doc of mySnap.docs) {
        const status = doc.data().status as string
        if (status === 'pending') {
          myClaim = { id: doc.id, status }
          break
        }
        if (!myClaim) myClaim = { id: doc.id, status }
      }

      return {
        ok: true,
        claimable: orgStatus === 'unclaimed',
        myClaim,
      }
    }
  )
}

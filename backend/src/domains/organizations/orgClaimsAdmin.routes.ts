import { FastifyPluginAsync } from 'fastify'
import admin from 'firebase-admin'

import { getFirestore } from '../../infrastructure/database/firebase.js'
import { writeAudit } from '../../infrastructure/audit/audit.js'
import { requirePlatformAdmin } from '../../infrastructure/auth/rbac.js'
import { FREE_TRIAL_DAYS, FREE_TRIAL_PLAN_ID } from '../payments/planLimits.js'

/**
 * Platform-admin review for the claim-request flow in orgClaims.routes.ts:
 * list orgs awaiting review, approve (grants org_admin membership + starts
 * a free trial, same grant shape as the self-serve claim-admin route in
 * parent.routes.ts), or reject (reopens the listing).
 */

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' } },
} as const

const RATE_CLAIM_WRITE = { max: 10, timeWindow: '1 minute' }
const RATE_CLAIM_READ = { max: 60, timeWindow: '1 minute' }

const claimIdParamsSchema = {
  type: 'object',
  required: ['orgId', 'claimId'],
  properties: {
    orgId: { type: 'string', description: 'Organization ID' },
    claimId: { type: 'string', description: 'Claim ID' },
  },
} as const

export const orgClaimsAdminRoute: FastifyPluginAsync = async (fastify) => {
  // GET /admin/orgs/claims — platform-admin-only list of orgs currently
  // awaiting claim review. Queries the top-level organizations collection
  // (already indexed, equality-only) instead of a collectionGroup query
  // across claims subcollections, which keeps this on the same
  // no-composite-index convention as the rest of this domain.
  fastify.get(
    '/admin/orgs/claims',
    {
      preHandler: requirePlatformAdmin,
      config: { rateLimit: RATE_CLAIM_READ },
      schema: {
        tags: ['Organizations'],
        summary: 'List organizations with a pending claim request (platform admin only)',
        response: {
          200: {
            type: 'object',
            required: ['ok', 'claims'],
            properties: {
              ok: { type: 'boolean' },
              claims: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['claimId', 'orgId', 'orgName', 'uid', 'submittedAt'],
                  properties: {
                    claimId: { type: 'string' },
                    orgId: { type: 'string' },
                    orgName: { type: 'string' },
                    uid: { type: 'string' },
                    contactName: { type: ['string', 'null'] },
                    contactPhone: { type: ['string', 'null'] },
                    note: { type: ['string', 'null'] },
                    submittedAt: {},
                  },
                },
              },
            },
          },
          403: errorResponseSchema,
        },
      },
    },
    async (_request, _reply) => {
      const db = getFirestore()
      const pendingOrgsSnap = await db
        .collection('organizations')
        .where('status', '==', 'pending_verification')
        .limit(100)
        .get()

      const claims = (
        await Promise.all(
          pendingOrgsSnap.docs.map(async (orgDoc) => {
            const claimSnap = await db
              .collection(`organizations/${orgDoc.id}/claims`)
              .where('status', '==', 'pending')
              .limit(1)
              .get()
            if (claimSnap.empty) return null
            const claimDoc = claimSnap.docs[0]
            const claimData = claimDoc.data()
            return {
              claimId: claimDoc.id,
              orgId: orgDoc.id,
              orgName: (orgDoc.data().name as string) ?? '',
              uid: claimData.uid as string,
              contactName: (claimData.contactName as string | null) ?? null,
              contactPhone: (claimData.contactPhone as string | null) ?? null,
              note: (claimData.note as string | null) ?? null,
              submittedAt: claimData.submittedAt ?? null,
            }
          })
        )
      ).filter((c): c is NonNullable<typeof c> => c !== null)

      return { ok: true, claims }
    }
  )

  // POST /admin/orgs/:orgId/claims/:claimId/approve — grants org_admin
  // membership to the claimant and starts their free trial, same shape as
  // the self-serve claim-admin route (member doc + specialist index +
  // specialists/{uid} upsert + trial billing), just admin-triggered and
  // targeting an imported listing instead of a self-created basic org.
  fastify.post<{ Params: { orgId: string; claimId: string } }>(
    '/admin/orgs/:orgId/claims/:claimId/approve',
    {
      preHandler: requirePlatformAdmin,
      config: { rateLimit: RATE_CLAIM_WRITE },
      schema: {
        tags: ['Organizations'],
        summary:
          'Approve a pending organization claim and grant org_admin access (platform admin only)',
        params: claimIdParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'orgId', 'uid'],
            properties: {
              ok: { type: 'boolean' },
              orgId: { type: 'string' },
              uid: { type: 'string' },
            },
          },
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { orgId, claimId } = request.params

      try {
        const db = getFirestore()
        const orgRef = db.doc(`organizations/${orgId}`)
        const claimRef = db.doc(`organizations/${orgId}/claims/${claimId}`)

        const result = await db.runTransaction(async (tx) => {
          const [orgSnap, claimSnap] = await Promise.all([tx.get(orgRef), tx.get(claimRef)])
          if (!orgSnap.exists)
            return { error: { code: 404, message: 'Organization not found' } } as const
          if (!claimSnap.exists)
            return { error: { code: 404, message: 'Claim not found' } } as const

          const orgData = orgSnap.data()!
          const claimData = claimSnap.data()!
          if (claimData.status !== 'pending') {
            return {
              error: { code: 409, message: 'This claim has already been reviewed' },
            } as const
          }
          if (orgData.status !== 'pending_verification') {
            return {
              error: { code: 409, message: 'This organization is not awaiting verification' },
            } as const
          }

          const now = new Date()
          const trialExpiresAt = new Date(now)
          trialExpiresAt.setDate(trialExpiresAt.getDate() + FREE_TRIAL_DAYS)
          const claimantUid = claimData.uid as string

          tx.update(orgRef, {
            status: 'active',
            claimedBy: claimantUid,
            claimedAt: admin.firestore.Timestamp.fromDate(now),
            crmEnabled: true,
            nurooPlan: orgData.nurooPlan ?? 'nuroo_business',
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

          tx.update(claimRef, {
            status: 'approved',
            reviewedAt: admin.firestore.Timestamp.fromDate(now),
            reviewedBy: request.user!.uid,
          })

          tx.set(orgRef.collection('members').doc(claimantUid), {
            uid: claimantUid,
            role: 'org_admin',
            status: 'active',
            joinedAt: admin.firestore.Timestamp.fromDate(now),
          })

          tx.set(db.doc(`specialists/${claimantUid}/organizations/${orgId}`), {
            orgId,
            orgName: orgData.name,
            country: orgData.country ?? null,
            role: 'org_admin',
            status: 'active',
            updatedAt: admin.firestore.Timestamp.fromDate(now),
          })

          return { ok: true as const, orgId, uid: claimantUid, now }
        })

        if ('error' in result) {
          return reply.code(result.error.code).send({ error: result.error.message })
        }

        // Outside the transaction (needs an Auth lookup + a read-before-write
        // that only has one caller, so no transactional isolation needed).
        // The core grant (org active + claim approved + org_admin member doc)
        // already committed above — this is a secondary index doc, so a
        // failure here must not make the whole request look failed: the
        // claim is already 'approved', so a client retry would just 409
        // forever with no way to repair the missing index. Best-effort it,
        // and surface the failure via logging/audit instead of a 500.
        try {
          const specialistRef = db.doc(`specialists/${result.uid}`)
          const specialistSnap = await specialistRef.get()
          if (specialistSnap.exists) {
            await specialistRef.update({
              orgId,
              role: 'org_admin',
              updatedAt: admin.firestore.Timestamp.fromDate(result.now),
            })
          } else {
            const authUser = await admin
              .auth()
              .getUser(result.uid)
              .catch(() => null)
            await specialistRef.set({
              uid: result.uid,
              email: authUser?.email || '',
              fullName: authUser?.displayName || authUser?.email?.split('@')[0] || 'Specialist',
              orgId,
              role: 'org_admin',
              createdAt: admin.firestore.Timestamp.fromDate(result.now),
              updatedAt: admin.firestore.Timestamp.fromDate(result.now),
            })
          }
        } catch (specialistError: unknown) {
          fastify.log.error(
            { err: specialistError, orgId, uid: result.uid },
            'Claim approved but specialists/{uid} index upsert failed — org_admin membership is still granted; this index doc needs manual repair'
          )
          writeAudit({
            db,
            orgId,
            entityType: 'organization',
            entityId: orgId,
            action: 'organization.claim_approved',
            actorId: request.user!.uid,
            actorRole: 'platform_admin',
            reason: 'specialists/{uid} index upsert failed after approval — needs manual repair',
            after: { claimId, grantedTo: result.uid, specialistIndexFailed: true },
          })
        }

        writeAudit({
          db,
          orgId,
          entityType: 'organization',
          entityId: orgId,
          action: 'organization.claim_approved',
          actorId: request.user!.uid,
          actorRole: 'platform_admin',
          after: { claimId, grantedTo: result.uid },
        })

        return { ok: true, orgId, uid: result.uid }
      } catch (error: unknown) {
        fastify.log.error({ err: error }, 'Failed to approve organization claim')
        return reply
          .code(500)
          .send({ error: error instanceof Error ? error.message : 'Failed to approve claim' })
      }
    }
  )

  // POST /admin/orgs/:orgId/claims/:claimId/reject — reopens the listing so
  // the same or a different claimant can submit a fresh request.
  fastify.post<{ Params: { orgId: string; claimId: string }; Body: { reason?: string } }>(
    '/admin/orgs/:orgId/claims/:claimId/reject',
    {
      preHandler: requirePlatformAdmin,
      config: { rateLimit: RATE_CLAIM_WRITE },
      schema: {
        tags: ['Organizations'],
        summary: 'Reject a pending organization claim (platform admin only)',
        params: claimIdParamsSchema,
        body: {
          type: 'object',
          additionalProperties: true,
          properties: { reason: { type: 'string', maxLength: 500 } },
        },
        response: {
          200: {
            type: 'object',
            required: ['ok'],
            properties: { ok: { type: 'boolean' } },
          },
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { orgId, claimId } = request.params
      const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : null

      try {
        const db = getFirestore()
        const orgRef = db.doc(`organizations/${orgId}`)
        const claimRef = db.doc(`organizations/${orgId}/claims/${claimId}`)

        const result = await db.runTransaction(async (tx) => {
          const [orgSnap, claimSnap] = await Promise.all([tx.get(orgRef), tx.get(claimRef)])
          if (!orgSnap.exists)
            return { error: { code: 404, message: 'Organization not found' } } as const
          if (!claimSnap.exists)
            return { error: { code: 404, message: 'Claim not found' } } as const

          const orgData = orgSnap.data()!
          const claimData = claimSnap.data()!
          if (claimData.status !== 'pending') {
            return {
              error: { code: 409, message: 'This claim has already been reviewed' },
            } as const
          }
          if (orgData.status !== 'pending_verification') {
            return {
              error: { code: 409, message: 'This organization is not awaiting verification' },
            } as const
          }

          const now = admin.firestore.Timestamp.now()
          tx.update(claimRef, {
            status: 'rejected',
            reviewedAt: now,
            reviewedBy: request.user!.uid,
            reason,
          })
          // Reopen the listing — another claim (from this or a different
          // user) can be submitted again.
          tx.update(orgRef, { status: 'unclaimed' })

          return { ok: true as const }
        })

        if ('error' in result) {
          return reply.code(result.error.code).send({ error: result.error.message })
        }

        writeAudit({
          db,
          orgId,
          entityType: 'organization',
          entityId: orgId,
          action: 'organization.claim_rejected',
          actorId: request.user!.uid,
          actorRole: 'platform_admin',
          after: { claimId, reason },
        })

        return { ok: true }
      } catch (error: unknown) {
        fastify.log.error({ err: error }, 'Failed to reject organization claim')
        return reply
          .code(500)
          .send({ error: error instanceof Error ? error.message : 'Failed to reject claim' })
      }
    }
  )
}

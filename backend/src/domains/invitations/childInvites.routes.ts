import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import admin from 'firebase-admin'
import { randomBytes } from 'crypto'
import { z } from 'zod'

import { getFirestore } from '../../infrastructure/database/firebase.js'
import { requireOrgMember } from '../../infrastructure/auth/rbac.js'

/**
 * Personalized per-child invite links/QR — org staff pre-registers a child,
 * generates a token, and hands it (link or QR) to that child's parent.
 * Distinct from parentInvites (org/specialist-scoped, reusable, requires the
 * parent to already have a Nuroo account before entering a code): here the
 * child already exists server-side, the token is single-use, and the parent
 * never has to search for the org or the child themselves.
 */

const createChildInviteSchema = z.object({
  groupLabel: z.string().trim().max(100).optional(),
  expectedParentName: z.string().trim().max(200).optional(),
  relationship: z.string().trim().max(100).optional(),
  contactPhone: z
    .string()
    .trim()
    .max(50)
    .regex(/^[+\d\s\-().]*$/, 'Invalid phone format')
    .optional(),
  contactEmail: z.string().trim().max(200).email('Invalid email').optional().or(z.literal('')),
})

function generateChildInviteToken(): string {
  return randomBytes(24).toString('base64url')
}

export const childInvitesRoute: FastifyPluginAsync = async (fastify) => {
  // POST /orgs/:orgId/children/:childId/invite — create or regenerate
  fastify.post<{
    Params: { orgId: string; childId: string }
    Body: z.infer<typeof createChildInviteSchema>
  }>('/orgs/:orgId/children/:childId/invite', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }

    const { orgId, childId } = request.params
    const member = await requireOrgMember(request, reply, orgId)
    if (reply.sent) return
    if (member.role !== 'org_admin') {
      return reply.code(403).send({ error: 'Only organization admins can create child invites' })
    }

    const parsed = createChildInviteSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid request' })
    }
    const { groupLabel, expectedParentName, relationship, contactPhone, contactEmail } = parsed.data

    try {
      const db = getFirestore()

      const childRef = db.doc(`organizations/${orgId}/children/${childId}`)
      const childSnap = await childRef.get()
      if (!childSnap.exists) {
        return reply.code(404).send({ error: 'Child not found' })
      }
      const childData = childSnap.data()!
      if (childData.parentUserId) {
        return reply.code(409).send({ error: 'This child is already connected to a parent' })
      }

      // Regenerate: invalidate any existing pending invite for this child first.
      const existingSnap = await db
        .collection('childInvites')
        .where('orgId', '==', orgId)
        .where('childId', '==', childId)
        .where('status', '==', 'pending')
        .get()
      for (const doc of existingSnap.docs) {
        await doc.ref.update({ status: 'revoked' })
      }

      const token = generateChildInviteToken()
      const now = admin.firestore.Timestamp.now()

      await db.doc(`childInvites/${token}`).set({
        token,
        orgId,
        childId,
        childName: (childData.name as string) || '',
        groupLabel: groupLabel || null,
        expectedParentName: expectedParentName || null,
        relationship: relationship || null,
        contactPhone: contactPhone || null,
        contactEmail: contactEmail || null,
        status: 'pending',
        createdAt: now,
        createdBy: request.user.uid,
        claimedAt: null,
        claimedByUid: null,
      })

      return {
        ok: true,
        token,
        link: `https://usenuroo.com/join/${token}`,
      }
    } catch (error: unknown) {
      fastify.log.error({ err: error }, 'Failed to create child invite')
      return reply
        .code(500)
        .send({ error: error instanceof Error ? error.message : 'Failed to create invite' })
    }
  })

  // GET /orgs/:orgId/children/:childId/invite — current invite + status for the admin card
  fastify.get<{ Params: { orgId: string; childId: string } }>(
    '/orgs/:orgId/children/:childId/invite',
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }
      const { orgId, childId } = request.params
      await requireOrgMember(request, reply, orgId)
      if (reply.sent) return

      try {
        const db = getFirestore()
        // Equality-only filters (no orderBy) so this doesn't need a composite
        // index — at most one invite is ever pending/claimed per child at a
        // time (regenerate revokes the previous one), so picking the first
        // active match is unambiguous in practice.
        const snap = await db
          .collection('childInvites')
          .where('orgId', '==', orgId)
          .where('childId', '==', childId)
          .where('status', 'in', ['pending', 'claimed'])
          .get()

        if (snap.empty) {
          return { ok: true, invite: null }
        }

        const data = snap.docs[0].data()
        return {
          ok: true,
          invite: {
            token: data.token,
            link: `https://usenuroo.com/join/${data.token}`,
            status: data.status,
            groupLabel: data.groupLabel ?? null,
            createdAt: data.createdAt,
            claimedAt: data.claimedAt ?? null,
          },
        }
      } catch (error: unknown) {
        fastify.log.error({ err: error }, 'Failed to fetch child invite')
        return reply
          .code(500)
          .send({ error: error instanceof Error ? error.message : 'Failed to fetch invite' })
      }
    }
  )

  // GET /invites/child/:token — PUBLIC, whitelisted in index.ts. No sensitive data.
  fastify.get<{ Params: { token: string } }>('/invites/child/:token', async (request, reply) => {
    try {
      const db = getFirestore()
      const { token } = request.params
      const inviteSnap = await db.doc(`childInvites/${token}`).get()
      if (!inviteSnap.exists) {
        return reply.code(404).send({ error: 'Invalid or expired invite' })
      }
      const inviteData = inviteSnap.data()!
      if (inviteData.status === 'revoked') {
        return reply.code(404).send({ error: 'Invalid or expired invite' })
      }

      const orgSnap = await db.doc(`organizations/${inviteData.orgId}`).get()

      return {
        ok: true,
        orgName: orgSnap.exists ? orgSnap.data()?.name || 'Organization' : 'Organization',
        childName: inviteData.childName || '',
        status: inviteData.status,
      }
    } catch (error: unknown) {
      fastify.log.error({ err: error }, 'Failed to fetch public child invite')
      return reply.code(500).send({ error: 'Failed to fetch invite' })
    }
  })

  // POST /invites/child/:token/accept — Firebase-authed parent claims the invite
  const handleAcceptChildInvite = async (
    request: FastifyRequest<{ Params: { token: string } }>,
    reply: FastifyReply
  ) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }
    const { token } = request.params
    const parentUid = request.user.uid

    try {
      const db = getFirestore()
      const inviteRef = db.doc(`childInvites/${token}`)
      const inviteSnap = await inviteRef.get()
      if (!inviteSnap.exists) {
        return reply.code(404).send({ error: 'Invalid or expired invite' })
      }
      const inviteData = inviteSnap.data()!
      if (inviteData.status !== 'pending') {
        return reply.code(409).send({ error: 'This invite has already been used' })
      }

      const { orgId, childId } = inviteData as { orgId: string; childId: string }

      const orgChildRef = db.doc(`organizations/${orgId}/children/${childId}`)
      const orgChildSnap = await orgChildRef.get()
      if (!orgChildSnap.exists) {
        return reply.code(404).send({ error: 'Child not found' })
      }
      if (orgChildSnap.data()?.parentUserId) {
        return reply.code(409).send({ error: 'This child is already connected to a parent' })
      }

      const now = admin.firestore.Timestamp.now()

      await orgChildRef.update({
        parentUserId: parentUid,
        assignedAt: now,
      })

      const childRef = db.doc(`children/${childId}`)
      const childSnap = await childRef.get()
      if (childSnap.exists) {
        await childRef.update({ updatedAt: now })
      }

      await inviteRef.update({
        status: 'claimed',
        claimedAt: now,
        claimedByUid: parentUid,
      })

      return { ok: true, orgId, childId }
    } catch (error: unknown) {
      fastify.log.error({ err: error }, 'Failed to accept child invite')
      return reply
        .code(500)
        .send({ error: error instanceof Error ? error.message : 'Failed to accept invite' })
    }
  }

  fastify.post('/invites/child/:token/accept', handleAcceptChildInvite)
}

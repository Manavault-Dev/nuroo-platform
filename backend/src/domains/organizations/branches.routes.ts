import { FastifyPluginAsync } from 'fastify'
import admin from 'firebase-admin'
import { z } from 'zod'

import { getFirestore } from '../../infrastructure/database/firebase.js'
import { requireOrgMember, memberBranchScope } from '../../infrastructure/auth/rbac.js'
import { checkOrgHasFeature } from '../payments/planLimits.js'

const ORG_BRANCHES = (orgId: string) => `organizations/${orgId}/branches`

const branchSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  phone: z.string().max(50).optional(),
  contactPerson: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  photoUrl: z.string().url().optional(),
})

function transformBranch(doc: admin.firestore.QueryDocumentSnapshot) {
  const data = doc.data()
  return {
    id: doc.id,
    name: data.name,
    address: data.address || null,
    phone: data.phone || null,
    contactPerson: data.contactPerson || null,
    description: data.description || null,
    photoUrl: data.photoUrl || null,
    createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
  }
}

export const branchesRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { orgId: string } }>('/orgs/:orgId/branches', async (request, reply) => {
    try {
      const { orgId } = request.params
      await requireOrgMember(request, reply, orgId)
      if (reply.sent) return

      const db = getFirestore()
      let snapshot: admin.firestore.QuerySnapshot

      try {
        snapshot = await db.collection(ORG_BRANCHES(orgId)).orderBy('createdAt', 'desc').get()
      } catch {
        snapshot = await db.collection(ORG_BRANCHES(orgId)).get()
      }

      const branches = snapshot.docs.map(transformBranch)

      return { ok: true, branches, count: branches.length }
    } catch (error: any) {
      console.error('[BRANCHES] Error listing branches:', error)
      return reply.code(500).send({ error: 'Failed to list branches', details: error.message })
    }
  })

  // GET /orgs/:orgId/branches/stats — enterprise dashboard: per-branch revenue,
  // unpaid invoices and team size (HQ sees all branches; a branch-scoped admin
  // sees only their own branch).
  fastify.get<{ Params: { orgId: string } }>(
    '/orgs/:orgId/branches/stats',
    async (request, reply) => {
      try {
        const { orgId } = request.params
        const member = await requireOrgMember(request, reply, orgId)
        if (reply.sent) return
        if (member.role !== 'org_admin') {
          return reply.code(403).send({ error: 'Only org admins can view branch stats' })
        }

        const featureCheck = await checkOrgHasFeature(orgId, 'branches')
        if (!featureCheck.ok) {
          return reply.code(403).send({ error: featureCheck.error, upgradeRequired: true })
        }

        const db = getFirestore()
        const scope = memberBranchScope(member)

        let branchSnapshot: admin.firestore.QuerySnapshot
        try {
          branchSnapshot = await db
            .collection(ORG_BRANCHES(orgId))
            .orderBy('createdAt', 'desc')
            .get()
        } catch {
          branchSnapshot = await db.collection(ORG_BRANCHES(orgId)).get()
        }
        const branches = branchSnapshot.docs
          .map(transformBranch)
          .filter((b) => !scope || b.id === scope)

        const [membersSnap, invoicesSnap] = await Promise.all([
          db.collection(`organizations/${orgId}/members`).get(),
          db.collection(`organizations/${orgId}/invoices`).limit(500).get(),
        ])

        const teamCountByBranch = new Map<string, number>()
        for (const doc of membersSnap.docs) {
          const branchId = (doc.data().branchId as string | null | undefined) ?? null
          if (!branchId) continue
          teamCountByBranch.set(branchId, (teamCountByBranch.get(branchId) ?? 0) + 1)
        }

        const now = new Date()
        const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

        const revenueByBranch = new Map<string, number>()
        const unpaidCountByBranch = new Map<string, number>()
        const unpaidAmountByBranch = new Map<string, number>()

        for (const doc of invoicesSnap.docs) {
          const inv = doc.data()
          const branchId = (inv.branchId as string | null | undefined) ?? null
          if (!branchId) continue
          if (inv.status === 'paid') {
            const inMonth =
              (inv.dueDate as string | undefined)?.startsWith(month) ||
              (inv.periodStart as string | undefined)?.startsWith(month)
            if (inMonth) {
              revenueByBranch.set(
                branchId,
                (revenueByBranch.get(branchId) ?? 0) + ((inv.amount as number) ?? 0)
              )
            }
          } else if (['pending', 'overdue', 'upcoming'].includes(inv.status)) {
            unpaidCountByBranch.set(branchId, (unpaidCountByBranch.get(branchId) ?? 0) + 1)
            unpaidAmountByBranch.set(
              branchId,
              (unpaidAmountByBranch.get(branchId) ?? 0) + ((inv.amount as number) ?? 0)
            )
          }
        }

        const stats = branches.map((b) => ({
          branchId: b.id,
          name: b.name,
          revenueThisMonth: revenueByBranch.get(b.id) ?? 0,
          unpaidCount: unpaidCountByBranch.get(b.id) ?? 0,
          unpaidAmount: unpaidAmountByBranch.get(b.id) ?? 0,
          teamCount: teamCountByBranch.get(b.id) ?? 0,
        }))

        const totals = stats.reduce(
          (acc, s) => ({
            revenueThisMonth: acc.revenueThisMonth + s.revenueThisMonth,
            unpaidCount: acc.unpaidCount + s.unpaidCount,
            unpaidAmount: acc.unpaidAmount + s.unpaidAmount,
            teamCount: acc.teamCount + s.teamCount,
          }),
          { revenueThisMonth: 0, unpaidCount: 0, unpaidAmount: 0, teamCount: 0 }
        )

        return { ok: true, month, stats, totals }
      } catch (error: any) {
        console.error('[BRANCHES] Error computing branch stats:', error)
        return reply
          .code(500)
          .send({ error: 'Failed to compute branch stats', details: error.message })
      }
    }
  )

  fastify.post<{ Params: { orgId: string }; Body: z.infer<typeof branchSchema> }>(
    '/orgs/:orgId/branches',
    async (request, reply) => {
      try {
        const { orgId } = request.params
        const member = await requireOrgMember(request, reply, orgId)
        if (reply.sent) return

        if (member.role !== 'org_admin') {
          return reply.code(403).send({ error: 'Only org admins can create branches' })
        }

        const featureCheck = await checkOrgHasFeature(orgId, 'branches')
        if (!featureCheck.ok) {
          return reply.code(403).send({ error: featureCheck.error, upgradeRequired: true })
        }

        const body = branchSchema.parse(request.body)
        const now = new Date()
        const db = getFirestore()

        const branchRef = db.collection(ORG_BRANCHES(orgId)).doc()
        const branchData = {
          name: body.name,
          address: body.address || null,
          phone: body.phone || null,
          contactPerson: body.contactPerson || null,
          description: body.description || null,
          photoUrl: body.photoUrl || null,
          createdAt: admin.firestore.Timestamp.fromDate(now),
          updatedAt: admin.firestore.Timestamp.fromDate(now),
        }

        await branchRef.set(branchData)

        return {
          ok: true,
          branch: {
            id: branchRef.id,
            ...branchData,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
        }
      } catch (error: any) {
        console.error('[BRANCHES] Error creating branch:', error)
        return reply.code(500).send({ error: 'Failed to create branch', details: error.message })
      }
    }
  )

  fastify.patch<{
    Params: { orgId: string; branchId: string }
    Body: Partial<z.infer<typeof branchSchema>>
  }>('/orgs/:orgId/branches/:branchId', async (request, reply) => {
    try {
      const { orgId, branchId } = request.params
      const member = await requireOrgMember(request, reply, orgId)
      if (reply.sent) return

      if (member.role !== 'org_admin') {
        return reply.code(403).send({ error: 'Only org admins can update branches' })
      }

      const db = getFirestore()
      const branchRef = db.doc(`${ORG_BRANCHES(orgId)}/${branchId}`)
      const snap = await branchRef.get()

      if (!snap.exists) {
        return reply.code(404).send({ error: 'Branch not found' })
      }

      const now = new Date()
      const body = request.body as any
      const updateData: any = {
        updatedAt: admin.firestore.Timestamp.fromDate(now),
      }

      if (body.name !== undefined) updateData.name = body.name
      if (body.address !== undefined) updateData.address = body.address || null
      if (body.phone !== undefined) updateData.phone = body.phone || null
      if (body.contactPerson !== undefined) updateData.contactPerson = body.contactPerson || null
      if (body.description !== undefined) updateData.description = body.description || null
      if (body.photoUrl !== undefined) updateData.photoUrl = body.photoUrl || null

      await branchRef.update(updateData)

      return { ok: true, message: 'Branch updated successfully' }
    } catch (error: any) {
      console.error('[BRANCHES] Error updating branch:', error)
      return reply.code(500).send({ error: 'Failed to update branch', details: error.message })
    }
  })

  fastify.delete<{ Params: { orgId: string; branchId: string } }>(
    '/orgs/:orgId/branches/:branchId',
    async (request, reply) => {
      try {
        const { orgId, branchId } = request.params
        const member = await requireOrgMember(request, reply, orgId)
        if (reply.sent) return

        if (member.role !== 'org_admin') {
          return reply.code(403).send({ error: 'Only org admins can delete branches' })
        }

        const db = getFirestore()
        const branchRef = db.doc(`${ORG_BRANCHES(orgId)}/${branchId}`)
        const snap = await branchRef.get()

        if (!snap.exists) {
          return reply.code(404).send({ error: 'Branch not found' })
        }

        await branchRef.delete()

        return { ok: true, message: 'Branch deleted successfully' }
      } catch (error: any) {
        console.error('[BRANCHES] Error deleting branch:', error)
        return reply.code(500).send({ error: 'Failed to delete branch', details: error.message })
      }
    }
  )
}

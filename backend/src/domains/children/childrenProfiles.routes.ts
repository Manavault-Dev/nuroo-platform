import { z } from 'zod'

import { getFirestore } from '../../infrastructure/database/firebase.js'
import {
  requireOrgMember,
  requireChildAccess,
  memberBranchScope,
} from '../../infrastructure/auth/rbac.js'
import { getChildProfile, updateChildProfile } from './children.service.js'

const childProfileUpdateSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().max(100).optional(),
  fullName: z.string().min(1).max(200).optional(),
  photoUrl: z.string().optional(),
  dateOfBirth: z.string().optional(),
  age: z.number().int().min(0).max(30).optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  status: z.enum(['active', 'paused', 'completed', 'archived']).optional(),
  startDate: z.string().optional(),
  branchId: z.string().optional(),
  primaryConcern: z.string().max(500).optional(),
  diagnosis: z.string().max(500).optional(),
  developmentalNotes: z.string().max(2000).optional(),
  communicationLevel: z.string().max(200).optional(),
  therapyGoals: z.string().max(2000).optional(),
  contraindications: z.string().max(1000).optional(),
  importantNotes: z.string().max(2000).optional(),
  internalCode: z.string().max(100).optional(),
})

export const childrenProfilesRoute: import('fastify').FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { orgId: string; childId: string } }>(
    '/orgs/:orgId/children/:childId/profile',
    async (request, reply) => {
      try {
        const { orgId, childId } = request.params
        await requireOrgMember(request, reply, orgId)
        const resolvedChildId = await requireChildAccess(request, reply, orgId, childId)

        const db = getFirestore()
        const profile = await getChildProfile(db, orgId, resolvedChildId)
        return { ok: true, profile }
      } catch (error: unknown) {
        fastify.log.error({ err: error }, 'Route handler failed')
        return reply.code(500).send({
          error: 'Failed to fetch child profile',
          details: error instanceof Error ? error.message : '',
        })
      }
    }
  )

  fastify.patch<{
    Params: { orgId: string; childId: string }
    Body: z.infer<typeof childProfileUpdateSchema>
  }>('/orgs/:orgId/children/:childId/profile', async (request, reply) => {
    try {
      const { orgId, childId } = request.params
      const member = await requireOrgMember(request, reply, orgId)
      const resolvedChildId = await requireChildAccess(request, reply, orgId, childId)

      const parse = childProfileUpdateSchema.safeParse(request.body)
      if (!parse.success) {
        return reply.code(400).send({ error: 'Invalid profile data', details: parse.error.errors })
      }

      const db = getFirestore()

      const scope = memberBranchScope(member)
      if (scope) {
        const currentProfile = await getChildProfile(db, orgId, resolvedChildId)
        if ((currentProfile?.branchId ?? null) !== scope) {
          return reply.code(403).send({ error: 'Child belongs to a different branch' })
        }
        if (parse.data.branchId !== undefined && parse.data.branchId !== scope) {
          return reply.code(403).send({ error: 'Cannot reassign child outside your branch' })
        }
      }

      const updatedData = await updateChildProfile(db, orgId, resolvedChildId, { ...parse.data })
      return { ok: true, profile: updatedData }
    } catch (error: unknown) {
      fastify.log.error({ err: error }, 'Route handler failed')
      return reply.code(500).send({
        error: 'Failed to update child profile',
        details: error instanceof Error ? error.message : '',
      })
    }
  })
}

import { FastifyPluginAsync } from 'fastify'
import admin from 'firebase-admin'
import { getFirestore } from '../../infrastructure/database/firebase.js'

const RATE = { max: 120, timeWindow: '1 minute' }

function transformPublicBranch(doc: admin.firestore.QueryDocumentSnapshot) {
  const data = doc.data()
  return {
    id: doc.id,
    name: data.name,
    address: data.address || null,
    phone: data.phone || null,
    description: data.description || null,
    photoUrl: data.photoUrl || null,
  }
}

/**
 * Public branch cards for an org's marketplace profile — no auth required.
 */
export const branchesMarketplaceRoute: FastifyPluginAsync = async (fastify) => {
  const db = getFirestore()

  fastify.get<{ Params: { orgId: string } }>(
    '/marketplace/orgs/:orgId/branches',
    { config: { rateLimit: RATE } },
    async (request, reply) => {
      const { orgId } = request.params
      const orgSnap = await db.doc(`organizations/${orgId}`).get()
      if (!orgSnap.exists) return reply.code(404).send({ error: 'Organization not found' })

      let snapshot: admin.firestore.QuerySnapshot
      try {
        snapshot = await db
          .collection(`organizations/${orgId}/branches`)
          .orderBy('createdAt', 'desc')
          .get()
      } catch {
        snapshot = await db.collection(`organizations/${orgId}/branches`).get()
      }

      const branches = snapshot.docs.map(transformPublicBranch)
      reply.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
      return { ok: true, branches }
    }
  )
}

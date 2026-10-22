import { FastifyPluginAsync } from 'fastify'

export const devRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/dev/check-super-admin',
    {
      schema: {
        tags: ['System'],
        summary: "Check the authenticated user's (deprecated) super-admin status",
        response: {
          200: {
            type: 'object',
            required: ['uid', 'isSuperAdmin', 'note'],
            properties: {
              uid: { type: 'string' },
              email: { type: ['string', 'null'] },
              isSuperAdmin: { type: 'boolean' },
              note: { type: 'string' },
            },
          },
          401: {
            type: 'object',
            required: ['error'],
            properties: { error: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      return {
        uid: request.user.uid,
        email: request.user.email,
        isSuperAdmin: false,
        note: 'Super Admin removed. Use organizations.',
      }
    }
  )
}

import { FastifyPluginAsync } from 'fastify'

export const healthRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/health',
    {
      schema: {
        tags: ['System'],
        summary: 'Health check — public, no authentication required',
        security: [],
        response: {
          200: {
            type: 'object',
            required: ['status', 'timestamp', 'service', 'revision', 'commit'],
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
              service: { type: 'string' },
              revision: { type: ['string', 'null'] },
              commit: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
    async () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'nuroo-backend',
      revision: process.env.K_REVISION || null,
      commit: process.env.GIT_SHA || null,
    })
  )
}

import type { FastifyPluginAsync } from 'fastify'
import { healthRoute, bootstrapRoute, devRoute, pushTokensRoute } from './system.routes.js'

// System routes without /v1 prefix (health, bootstrap, dev tools)
export const systemDomain: FastifyPluginAsync = async (fastify) => {
  await fastify.register(healthRoute)
  await fastify.register(bootstrapRoute)
  await fastify.register(devRoute)
}

// Notification + push token routes — versioned under /v1
export { pushTokensRoute as notificationsDomain } from './system.routes.js'

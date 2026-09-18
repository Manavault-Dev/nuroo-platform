import type { FastifyPluginAsync } from 'fastify'
import { leadsRoute } from './leads.routes.js'
import { leadsMarketplaceRoute } from './leads.marketplace.routes.js'

export const leadsDomain: FastifyPluginAsync = async (fastify) => {
  await fastify.register(leadsRoute)
  await fastify.register(leadsMarketplaceRoute)
}

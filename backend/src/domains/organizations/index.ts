import type { FastifyPluginAsync } from 'fastify'
import { orgsRoute, branchesRoute, teamRoute, brandingRoute } from './organizations.routes.js'
import { reviewsRoute } from './reviews.routes.js'
import { branchesMarketplaceRoute } from './branches.marketplace.routes.js'
import { orgClaimsRoute } from './orgClaims.routes.js'
import { orgClaimsAdminRoute } from './orgClaimsAdmin.routes.js'

export const organizationsDomain: FastifyPluginAsync = async (fastify) => {
  await fastify.register(orgsRoute)
  await fastify.register(branchesRoute)
  await fastify.register(teamRoute)
  await fastify.register(brandingRoute)
  await fastify.register(reviewsRoute)
  await fastify.register(branchesMarketplaceRoute)
  await fastify.register(orgClaimsRoute)
  await fastify.register(orgClaimsAdminRoute)
}

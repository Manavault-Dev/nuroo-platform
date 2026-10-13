import type { FastifyPluginAsync } from 'fastify'

import { inviteCreationRoute } from './inviteCreation.routes.js'
import { parentInviteLinkRoute } from './parentInviteLink.routes.js'
import { parentConnectionsRoute } from './parentConnections.routes.js'
import { childInvitesRoute } from './childInvites.routes.js'

export const invitesRoute: FastifyPluginAsync = async (fastify) => {
  await fastify.register(inviteCreationRoute)
  await fastify.register(parentInviteLinkRoute)
  await fastify.register(parentConnectionsRoute)
  await fastify.register(childInvitesRoute)
}

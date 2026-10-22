import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireOrgMember } from '../../infrastructure/auth/rbac.js'
import { createPayment, verifyPayment, getPlanPrices, getPlanNames } from './payments.service.js'
import { PLAN_LIMITS, type PlanId } from './planLimits.js'
import { createPaymentSchema } from './payments.schema.js'

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  properties: { error: { type: 'string' } },
} as const

const okFalseErrorResponseSchema = {
  type: 'object',
  required: ['ok', 'error'],
  properties: { ok: { type: 'boolean' }, error: { type: 'string' } },
} as const

const orgIdParamsSchema = {
  type: 'object',
  required: ['orgId'],
  properties: { orgId: { type: 'string', description: 'Organization ID' } },
} as const

export const paymentsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/plans',
    {
      schema: {
        tags: ['Payments'],
        summary: 'List available subscription plans with pricing and limits',
        response: {
          200: {
            type: 'object',
            required: ['ok', 'plans'],
            properties: {
              ok: { type: 'boolean' },
              plans: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'name', 'price', 'currency', 'limits'],
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    price: { type: 'number' },
                    currency: { type: 'string' },
                    limits: {
                      anyOf: [
                        {
                          type: 'object',
                          required: ['children', 'specialists'],
                          properties: {
                            // null means unlimited on that plan (e.g. growth's
                            // specialists, enterprise's children/specialists) —
                            // PLAN_LIMITS never omits the object itself, only
                            // these individual fields can be null.
                            children: { type: ['number', 'null'] },
                            specialists: { type: ['number', 'null'] },
                          },
                        },
                        { type: 'null' },
                      ],
                    },
                  },
                },
              },
            },
          },
          500: okFalseErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const prices = getPlanPrices()
        const names = getPlanNames()

        const plans = (Object.keys(prices) as PlanId[]).map((planId) => {
          const limits = PLAN_LIMITS[planId]
          return {
            id: planId,
            name: names[planId],
            price: prices[planId],
            currency: 'KGS',
            limits: limits ? { children: limits.children, specialists: limits.specialists } : null,
          }
        })

        return {
          ok: true,
          plans,
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to get plans'
        return reply.code(500).send({ ok: false, error: message })
      }
    }
  )

  fastify.post<{ Params: { orgId: string }; Body: z.infer<typeof createPaymentSchema> }>(
    '/orgs/:orgId/payments',
    {
      schema: {
        tags: ['Payments'],
        summary: 'Create a Finik payment for an organization plan (org admin only)',
        params: orgIdParamsSchema,
        body: {
          type: 'object',
          required: ['planId', 'orgId'],
          properties: {
            planId: { type: 'string', enum: ['starter', 'growth', 'enterprise'] },
            orgId: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['ok', 'paymentId', 'paymentUrl', 'transactionId'],
            properties: {
              ok: { type: 'boolean' },
              paymentId: { type: 'string' },
              paymentUrl: { type: 'string' },
              transactionId: { type: 'string' },
            },
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const { orgId } = request.params
      const { uid } = request.user

      const member = await requireOrgMember(request, reply, orgId)
      if (reply.sent) return

      if (member.role !== 'org_admin') {
        return reply.code(403).send({ error: 'Only organization admins can create payments' })
      }

      const body = createPaymentSchema.parse(request.body)

      if (body.orgId !== orgId) {
        return reply.code(400).send({ error: 'Organization ID mismatch' })
      }

      try {
        const result = await createPayment(body, uid)
        return result
      } catch (error: unknown) {
        console.error('Error creating payment:', error)
        return reply
          .code(500)
          .send({ error: error instanceof Error ? error.message : 'Failed to create payment' })
      }
    }
  )

  fastify.get<{ Params: { paymentId: string } }>(
    '/payments/:paymentId/verify',
    {
      schema: {
        tags: ['Payments'],
        summary: "Verify a payment's status (requires membership in the payment's organization)",
        params: {
          type: 'object',
          required: ['paymentId'],
          properties: { paymentId: { type: 'string', description: 'Payment ID' } },
        },
        response: {
          200: {
            type: 'object',
            required: ['ok', 'orgId', 'payment'],
            properties: {
              ok: { type: 'boolean' },
              orgId: { type: 'string' },
              payment: {
                type: 'object',
                required: ['id', 'status', 'planId', 'amount', 'currency'],
                properties: {
                  id: { type: 'string' },
                  status: { type: 'string' },
                  planId: { type: 'string' },
                  amount: { type: 'number' },
                  currency: { type: 'string' },
                },
              },
            },
          },
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const { paymentId } = request.params

      try {
        const result = await verifyPayment(paymentId)
        if (!result.ok) {
          return reply.code(404).send({ error: result.error })
        }

        if (!result.orgId) {
          return reply.code(403).send({ error: 'Payment record is missing organization context' })
        }
        await requireOrgMember(request, reply, result.orgId)
        if (reply.sent) return

        return result
      } catch (error: unknown) {
        fastify.log.error(error, 'Error verifying payment')
        return reply.code(500).send({ error: 'Failed to verify payment' })
      }
    }
  )
}

/**
 * Favorites — parent saves/removes specialist profiles for quick re-booking.
 *
 * GET  /marketplace/favorites              → list parent's saved specialists
 * POST /marketplace/favorites              → save a specialist
 * DELETE /marketplace/favorites/:specialistId  → remove from favorites
 * GET  /marketplace/favorites/:specialistId/check → is this specialist saved?
 */

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { getFirestore } from '../../infrastructure/database/firebase.js'
import type { FavoriteDoc } from '../booking/types.js'

const RATE = { max: 60, timeWindow: '1 minute' }
const RATE_READ = { max: 120, timeWindow: '1 minute' }

const addFavoriteSchema = z.object({
  orgId: z.string().trim().min(1),
  specialistId: z.string().trim().min(1),
  specialistName: z.string().trim().max(200).default(''),
  specialistAvatar: z.string().url().nullable().optional(),
  orgName: z.string().trim().max(200).default(''),
})

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  additionalProperties: true,
  properties: { error: { type: 'string' } },
} as const

const okResponseSchema = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
} as const

const favoriteResponseSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['id'],
  properties: {
    id: { type: 'string', description: 'The favorited specialist ID' },
    parentId: { type: 'string' },
    orgId: { type: 'string' },
    specialistId: { type: 'string' },
    specialistName: { type: 'string' },
    specialistAvatar: { type: ['string', 'null'] },
    orgName: { type: 'string' },
    savedAt: { type: 'string' },
  },
} as const

const addFavoriteBodySchema = {
  type: 'object',
  required: ['orgId', 'specialistId'],
  additionalProperties: true,
  properties: {
    orgId: { type: 'string', minLength: 1 },
    specialistId: { type: 'string', minLength: 1 },
    specialistName: { type: 'string', maxLength: 200 },
    specialistAvatar: { type: ['string', 'null'] },
    orgName: { type: 'string', maxLength: 200 },
  },
} as const

const specialistIdParamsSchema = {
  type: 'object',
  required: ['specialistId'],
  properties: { specialistId: { type: 'string', description: 'Specialist ID' } },
} as const

export const favoritesRoute: FastifyPluginAsync = async (fastify) => {
  const db = getFirestore()

  /** GET /marketplace/favorites — list authenticated parent's saved specialists */
  fastify.get(
    '/marketplace/favorites',
    {
      config: { rateLimit: RATE_READ },
      schema: {
        tags: ['Favorites'],
        summary: "List the authenticated parent's saved specialists",
        response: {
          200: {
            type: 'object',
            required: ['ok', 'favorites'],
            properties: {
              ok: { type: 'boolean' },
              favorites: { type: 'array', items: favoriteResponseSchema },
            },
          },
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const parentId = request.user.uid

      const snap = await db
        .collection(`userFavorites/${parentId}/specialists`)
        .orderBy('savedAt', 'desc')
        .limit(100)
        .get()

      const favorites = snap.docs.map((d) => ({ id: d.id, ...(d.data() as FavoriteDoc) }))
      return { ok: true, favorites }
    }
  )

  /** POST /marketplace/favorites — add specialist to favorites */
  fastify.post(
    '/marketplace/favorites',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Favorites'],
        summary: "Save a specialist to the authenticated parent's favorites",
        body: addFavoriteBodySchema,
        response: {
          201: okResponseSchema,
          400: {
            type: 'object',
            required: ['error'],
            additionalProperties: true,
            properties: { error: { type: 'string' }, issues: { type: 'array' } },
          },
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const parentId = request.user.uid

      const parse = addFavoriteSchema.safeParse(request.body)
      if (!parse.success)
        return reply.code(400).send({ error: 'Invalid input', issues: parse.error.issues })

      const { orgId, specialistId, specialistName, specialistAvatar, orgName } = parse.data

      // Use specialistId as doc ID for idempotency — re-saving is safe
      const docRef = db.doc(`userFavorites/${parentId}/specialists/${specialistId}`)

      const doc: FavoriteDoc = {
        parentId,
        orgId,
        specialistId,
        specialistName,
        specialistAvatar: specialistAvatar ?? null,
        orgName,
        savedAt: new Date().toISOString(),
      }

      await docRef.set(doc, { merge: true })
      return reply.code(201).send({ ok: true })
    }
  )

  /** DELETE /marketplace/favorites/:specialistId — remove from favorites */
  fastify.delete<{ Params: { specialistId: string } }>(
    '/marketplace/favorites/:specialistId',
    {
      config: { rateLimit: RATE },
      schema: {
        tags: ['Favorites'],
        summary: "Remove a specialist from the authenticated parent's favorites",
        params: specialistIdParamsSchema,
        response: {
          200: okResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const parentId = request.user.uid
      const { specialistId } = request.params

      await db.doc(`userFavorites/${parentId}/specialists/${specialistId}`).delete()
      return { ok: true }
    }
  )

  /** GET /marketplace/favorites/:specialistId/check — quick boolean check */
  fastify.get<{ Params: { specialistId: string } }>(
    '/marketplace/favorites/:specialistId/check',
    {
      config: { rateLimit: RATE_READ },
      schema: {
        tags: ['Favorites'],
        summary: "Check whether a specialist is saved to the authenticated parent's favorites",
        params: specialistIdParamsSchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'saved'],
            properties: { ok: { type: 'boolean' }, saved: { type: 'boolean' } },
          },
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const parentId = request.user.uid
      const { specialistId } = request.params

      const snap = await db.doc(`userFavorites/${parentId}/specialists/${specialistId}`).get()
      return { ok: true, saved: snap.exists }
    }
  )
}

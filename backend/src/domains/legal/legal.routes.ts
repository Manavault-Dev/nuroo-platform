/**
 * Legal / Consent API routes
 *
 * GET  /legal/documents        — current document versions (public)
 * GET  /legal/consents         — authenticated user's consent status
 * POST /legal/consents         — record consent acceptance
 * POST /legal/consents/withdraw — withdraw optional consent
 */

import { FastifyPluginAsync } from 'fastify'
import admin from 'firebase-admin'
import { z } from 'zod'
import { getFirestore } from '../../infrastructure/database/firebase.js'
import {
  ConsentType,
  ConsentRecord,
  LEGAL_DOCUMENTS,
  REQUIRED_CONSENT_TYPES,
  OPTIONAL_CONSENT_TYPES,
  CHILD_DATA_CONSENT_TYPES,
  getCurrentDocumentVersion,
} from './legal.types.js'

const CONSENT_TYPES: ConsentType[] = [
  ...REQUIRED_CONSENT_TYPES,
  ...OPTIONAL_CONSENT_TYPES,
  ...CHILD_DATA_CONSENT_TYPES,
]

const consentTypeSchema = z.enum([
  'PUBLIC_OFFER',
  'PRIVACY_POLICY',
  'LEGAL_REPRESENTATIVE',
  'MARKETING_COMMUNICATIONS',
  'ANONYMIZED_ANALYTICS',
  'SPECIALIST_CHILD_PROFILE_ACCESS',
  'MEDIA_MARKETING_USAGE',
] as [ConsentType, ...ConsentType[]])

const acceptConsentSchema = z.object({
  consentType: consentTypeSchema,
  documentVersion: z.string().min(1).max(50),
  locale: z.string().max(10).default('ru'),
  metadata: z.record(z.string()).optional(),
})

const withdrawConsentSchema = z.object({
  consentType: consentTypeSchema,
})

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  additionalProperties: true,
  properties: { error: { type: 'string' } },
} as const

const consentTypeJsonSchema = { type: 'string', enum: CONSENT_TYPES } as const

const legalDocumentSchema = {
  type: 'object',
  required: ['type', 'version', 'effectiveAt', 'titleRu', 'requiresReacceptance', 'path'],
  properties: {
    type: consentTypeJsonSchema,
    version: { type: 'string' },
    effectiveAt: { type: 'string' },
    titleRu: { type: 'string' },
    requiresReacceptance: { type: 'boolean' },
    path: { type: 'string' },
  },
} as const

const consentStatusSchema = {
  type: 'object',
  required: [
    'consentType',
    'isAccepted',
    'needsReacceptance',
    'documentVersion',
    'currentVersion',
    'acceptedAt',
    'withdrawnAt',
  ],
  properties: {
    consentType: consentTypeJsonSchema,
    isAccepted: { type: 'boolean' },
    needsReacceptance: { type: 'boolean' },
    documentVersion: { type: ['string', 'null'] },
    currentVersion: { type: 'string' },
    acceptedAt: { type: ['string', 'null'] },
    withdrawnAt: { type: ['string', 'null'] },
  },
} as const

const acceptConsentBodySchema = {
  type: 'object',
  required: ['consentType', 'documentVersion'],
  additionalProperties: true,
  properties: {
    consentType: consentTypeJsonSchema,
    documentVersion: { type: 'string', minLength: 1, maxLength: 50 },
    locale: { type: 'string', maxLength: 10 },
    metadata: { type: 'object', additionalProperties: { type: 'string' } },
  },
} as const

const withdrawConsentBodySchema = {
  type: 'object',
  required: ['consentType'],
  additionalProperties: true,
  properties: { consentType: consentTypeJsonSchema },
} as const

function consentsCollection(uid: string) {
  return `users/${uid}/consents`
}

/** Verify the client-submitted document version matches the current one */
function validateDocumentVersion(type: ConsentType, submittedVersion: string): boolean {
  const current = getCurrentDocumentVersion(type)
  return submittedVersion === current
}

export const legalRoutes: FastifyPluginAsync = async (fastify) => {
  // ── GET /legal/documents — public, no auth required ──────────────────────
  fastify.get(
    '/legal/documents',
    {
      schema: {
        tags: ['Legal'],
        summary: 'Get the current versions of all legal documents (public)',
        response: {
          200: {
            type: 'object',
            required: ['documents'],
            properties: { documents: { type: 'array', items: legalDocumentSchema } },
          },
        },
      },
    },
    async (_request, reply) => {
      return reply.send({
        documents: Object.values(LEGAL_DOCUMENTS),
      })
    }
  )

  // ── GET /legal/consents — get current user's consent status ──────────────
  fastify.get(
    '/legal/consents',
    {
      schema: {
        tags: ['Legal'],
        summary: "Get the authenticated user's consent status for every known consent type",
        response: {
          200: {
            type: 'object',
            required: ['consents'],
            properties: { consents: { type: 'array', items: consentStatusSchema } },
          },
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })

      const db = getFirestore()
      const { uid } = request.user

      const snapshot = await db
        .collection(consentsCollection(uid))
        .orderBy('createdAt', 'desc')
        .get()

      // Return latest accepted (not withdrawn) record per consent type
      const latestByType: Record<string, ConsentRecord> = {}
      for (const doc of snapshot.docs) {
        const data = doc.data() as ConsentRecord
        if (!latestByType[data.consentType]) {
          latestByType[data.consentType] = { ...data, id: doc.id }
        }
      }

      // Build status for all known types
      const statuses = CONSENT_TYPES.map((type) => {
        const record = latestByType[type] ?? null
        const currentVersion = getCurrentDocumentVersion(type)
        const isAccepted = record?.accepted === true && record.withdrawnAt === null
        const versionMatch = record?.documentVersion === currentVersion
        return {
          consentType: type,
          isAccepted,
          needsReacceptance:
            isAccepted && !versionMatch && (LEGAL_DOCUMENTS[type]?.requiresReacceptance ?? false),
          documentVersion: record?.documentVersion ?? null,
          currentVersion,
          acceptedAt: record?.acceptedAt ?? null,
          withdrawnAt: record?.withdrawnAt ?? null,
        }
      })

      return reply.send({ consents: statuses })
    }
  )

  // ── POST /legal/consents — record acceptance ──────────────────────────────
  fastify.post<{ Body: z.infer<typeof acceptConsentSchema> }>(
    '/legal/consents',
    {
      schema: {
        tags: ['Legal'],
        summary: "Record the authenticated user's acceptance of a legal document version",
        body: acceptConsentBodySchema,
        response: {
          201: {
            type: 'object',
            required: ['ok', 'id', 'acceptedAt'],
            properties: {
              ok: { type: 'boolean' },
              id: { type: 'string' },
              acceptedAt: { type: 'string' },
            },
          },
          400: {
            type: 'object',
            required: ['error'],
            additionalProperties: true,
            properties: { error: { type: 'string' }, message: { type: 'string' } },
          },
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })

      const body = acceptConsentSchema.safeParse(request.body)
      if (!body.success)
        return reply.code(400).send({ error: 'Invalid request', details: body.error.issues })

      const { consentType, documentVersion, locale, metadata } = body.data
      const { uid } = request.user

      // Validate document version server-side — prevent client spoofing
      if (!validateDocumentVersion(consentType, documentVersion)) {
        return reply.code(400).send({
          error: 'INVALID_DOCUMENT_VERSION',
          message: `Version "${documentVersion}" is not current for ${consentType}. Current: ${getCurrentDocumentVersion(consentType)}`,
        })
      }

      const db = getFirestore()
      const now = admin.firestore.Timestamp.now()
      const nowIso = now.toDate().toISOString()
      const userAgent = request.headers['user-agent'] ?? ''

      const record: Omit<ConsentRecord, 'id'> = {
        userId: uid,
        consentType,
        documentVersion,
        accepted: true,
        acceptedAt: nowIso,
        withdrawnAt: null,
        platform: 'web',
        userAgent: userAgent.slice(0, 500),
        locale,
        metadata: metadata ?? {},
        createdAt: nowIso,
        updatedAt: nowIso,
      }

      const docRef = await db.collection(consentsCollection(uid)).add({
        ...record,
        _serverTimestamp: admin.firestore.FieldValue.serverTimestamp(),
      })

      return reply.code(201).send({ ok: true, id: docRef.id, acceptedAt: nowIso })
    }
  )

  // ── POST /legal/consents/withdraw — withdraw optional consent ─────────────
  fastify.post<{ Body: z.infer<typeof withdrawConsentSchema> }>(
    '/legal/consents/withdraw',
    {
      schema: {
        tags: ['Legal'],
        summary: 'Withdraw a previously accepted optional consent for the authenticated user',
        body: withdrawConsentBodySchema,
        response: {
          200: {
            type: 'object',
            required: ['ok', 'withdrawnAt'],
            properties: { ok: { type: 'boolean' }, withdrawnAt: { type: 'string' } },
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: {
            type: 'object',
            required: ['error'],
            additionalProperties: true,
            properties: { error: { type: 'string' }, message: { type: 'string' } },
          },
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })

      const body = withdrawConsentSchema.safeParse(request.body)
      if (!body.success) return reply.code(400).send({ error: 'Invalid request' })

      const { consentType } = body.data

      // Required consents cannot be withdrawn via API (only account deletion)
      if ((REQUIRED_CONSENT_TYPES as ConsentType[]).includes(consentType)) {
        return reply.code(403).send({
          error: 'REQUIRED_CONSENT',
          message: 'Required consents can only be withdrawn by deleting your account.',
        })
      }

      const db = getFirestore()
      const { uid } = request.user
      const now = admin.firestore.Timestamp.now()
      const nowIso = now.toDate().toISOString()

      // Find latest accepted record for this type
      const snapshot = await db
        .collection(consentsCollection(uid))
        .where('consentType', '==', consentType)
        .where('accepted', '==', true)
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get()

      if (snapshot.empty) {
        return reply.code(404).send({ error: 'No active consent found for this type' })
      }

      // Mark as withdrawn — do NOT delete (preserve audit history)
      await snapshot.docs[0].ref.update({
        withdrawnAt: nowIso,
        updatedAt: nowIso,
        _serverWithdrawnAt: admin.firestore.FieldValue.serverTimestamp(),
      })

      return reply.send({ ok: true, withdrawnAt: nowIso })
    }
  )

  // ── GET /legal/consents/check — check if required consents are present ────
  // Used by onboarding to verify before allowing workspace access
  fastify.get(
    '/legal/consents/check',
    {
      schema: {
        tags: ['Legal'],
        summary: 'Check whether the authenticated user has accepted all required consents',
        response: {
          200: {
            type: 'object',
            required: ['allRequiredAccepted', 'missing'],
            properties: {
              allRequiredAccepted: { type: 'boolean' },
              missing: { type: 'array', items: consentTypeJsonSchema },
            },
          },
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })

      const db = getFirestore()
      const { uid } = request.user

      const snapshot = await db
        .collection(consentsCollection(uid))
        .where('accepted', '==', true)
        .get()

      const acceptedTypes = new Set<string>()
      for (const doc of snapshot.docs) {
        const data = doc.data() as ConsentRecord
        if (
          data.withdrawnAt === null &&
          data.documentVersion === getCurrentDocumentVersion(data.consentType)
        ) {
          acceptedTypes.add(data.consentType)
        }
      }

      const missing = REQUIRED_CONSENT_TYPES.filter((t) => !acceptedTypes.has(t))

      return reply.send({
        allRequiredAccepted: missing.length === 0,
        missing,
      })
    }
  )
}

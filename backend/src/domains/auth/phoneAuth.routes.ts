/**
 * Phone OTP authentication for parents (via WhatsApp) — the "invisible
 * registration" flow: QR → phone → OTP → inside the app.
 *
 * POST /auth/phone/send-otp    — public, generates + sends a 6-digit code
 * POST /auth/phone/verify-otp  — public, verifies the code and mints a
 *                                 Firebase custom token for the resolved uid
 *
 * We deliberately do NOT use Firebase's own signInWithPhoneNumber — the
 * mobile app runs the Firebase JS (web) SDK, which requires a DOM
 * RecaptchaVerifier that doesn't exist in React Native. This custom-token
 * flow also gives us control over UID resolution (see userPhones below),
 * which solves the "same person, two Firebase identities" problem by
 * construction rather than needing Firebase account-linking.
 */

import type { FastifyInstance } from 'fastify'
import admin from 'firebase-admin'
import { randomInt } from 'crypto'
import { z } from 'zod'

import { getFirestore } from '../../infrastructure/database/firebase.js'
import { getWhatsAppOtpProvider } from '../../modules/whatsapp/whatsapp.provider.js'

const OTP_TTL_MS = 5 * 60 * 1000
const OTP_RESEND_COOLDOWN_MS = 60 * 1000
const MAX_VERIFY_ATTEMPTS = 5

/** Accepts loose input, returns a strict "+<digits>" E.164-ish key or null. */
function normalizePhone(input: string): string | null {
  const trimmed = input.trim().replace(/[\s\-().]/g, '')
  if (!/^\+\d{8,15}$/.test(trimmed)) return null
  return trimmed
}

function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

const sendOtpSchema = z.object({
  phone: z.string().min(8).max(20),
})

const verifyOtpSchema = z.object({
  phone: z.string().min(8).max(20),
  code: z.string().length(6),
})

export async function phoneAuthRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: z.infer<typeof sendOtpSchema> }>(
    '/auth/phone/send-otp',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = sendOtpSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'A valid phone number is required' })
      }
      const phone = normalizePhone(parsed.data.phone)
      if (!phone) {
        return reply.code(400).send({ error: 'Invalid phone number format' })
      }

      const db = getFirestore()
      const otpRef = db.doc(`phoneOtps/${phone}`)

      try {
        const existing = await otpRef.get()
        if (existing.exists) {
          const data = existing.data()!
          const lastSentAt = (data.lastSentAt as admin.firestore.Timestamp | undefined)?.toMillis()
          if (lastSentAt && Date.now() - lastSentAt < OTP_RESEND_COOLDOWN_MS) {
            return reply.code(429).send({ error: 'Please wait before requesting another code' })
          }
        }

        const code = generateOtpCode()
        const now = admin.firestore.Timestamp.now()
        await otpRef.set({
          code,
          phone,
          expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + OTP_TTL_MS),
          lastSentAt: now,
          attempts: 0,
        })

        await getWhatsAppOtpProvider().sendOtp(phone, code)

        return { ok: true }
      } catch (error: unknown) {
        fastify.log.error({ err: error }, 'Failed to send phone OTP')
        return reply
          .code(500)
          .send({ error: error instanceof Error ? error.message : 'Failed to send code' })
      }
    }
  )

  fastify.post<{ Body: z.infer<typeof verifyOtpSchema> }>(
    '/auth/phone/verify-otp',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = verifyOtpSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Phone and 6-digit code are required' })
      }
      const phone = normalizePhone(parsed.data.phone)
      if (!phone) {
        return reply.code(400).send({ error: 'Invalid phone number format' })
      }
      const { code } = parsed.data

      const db = getFirestore()
      const otpRef = db.doc(`phoneOtps/${phone}`)

      try {
        const otpSnap = await otpRef.get()
        if (!otpSnap.exists) {
          return reply.code(400).send({ error: 'No code was requested for this number' })
        }
        const otpData = otpSnap.data()!

        const expiresAt = (otpData.expiresAt as admin.firestore.Timestamp).toMillis()
        if (Date.now() > expiresAt) {
          await otpRef.delete()
          return reply.code(400).send({ error: 'Code has expired, request a new one' })
        }

        const attempts = (otpData.attempts as number) ?? 0
        if (attempts >= MAX_VERIFY_ATTEMPTS) {
          await otpRef.delete()
          return reply.code(429).send({ error: 'Too many attempts, request a new code' })
        }

        if (otpData.code !== code) {
          await otpRef.update({ attempts: attempts + 1 })
          return reply.code(400).send({ error: 'Incorrect code' })
        }

        // Code is correct — resolve (or create) the single canonical uid for
        // this phone number, so repeat logins and a second device never
        // produce a second identity for the same person.
        const phoneIndexRef = db.doc(`userPhones/${phone}`)
        const phoneIndexSnap = await phoneIndexRef.get()

        let uid: string
        const now = admin.firestore.Timestamp.now()

        if (phoneIndexSnap.exists) {
          uid = phoneIndexSnap.data()!.uid as string
          await db.doc(`users/${uid}`).set({ phoneNumber: phone, updatedAt: now }, { merge: true })
        } else {
          const userRef = db.collection('users').doc()
          uid = userRef.id
          await userRef.set({
            phoneNumber: phone,
            createdAt: now,
            updatedAt: now,
          })
          await phoneIndexRef.set({ uid, phone, createdAt: now })
        }

        await otpRef.delete()

        const customToken = await admin.auth().createCustomToken(uid)

        return { ok: true, customToken, uid }
      } catch (error: unknown) {
        fastify.log.error({ err: error }, 'Failed to verify phone OTP')
        return reply
          .code(500)
          .send({ error: error instanceof Error ? error.message : 'Failed to verify code' })
      }
    }
  )
}

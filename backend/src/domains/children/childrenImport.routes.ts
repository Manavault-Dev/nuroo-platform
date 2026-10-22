import { FastifyPluginAsync } from 'fastify'
import multipart from '@fastify/multipart'
import admin from 'firebase-admin'
import { randomBytes } from 'crypto'
import { read, utils } from 'xlsx'
import { z } from 'zod'

import { getFirestore } from '../../infrastructure/database/firebase.js'
import { requireOrgMember, memberBranchScope } from '../../infrastructure/auth/rbac.js'
import { checkOrgCanAddChildren } from '../payments/planLimits.js'

/**
 * Bulk child + parent-invite import from an uploaded spreadsheet (.xlsx/.csv).
 * Two-step flow, mirroring the single-child-add + invite flow in
 * childInvites.routes.ts but batched: /preview parses and validates without
 * writing anything, /commit takes the (possibly client-edited) row list back
 * and actually creates the children + invites.
 */

const PHONE_PATTERN = /^[+\d\s\-().]*$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Header aliases are matched case-insensitively after trimming — admins fill
// this in by hand, so accept a few natural variants per column.
const HEADER_ALIASES: Record<string, string[]> = {
  firstName: ['имя', 'имя ребенка', 'имя ребёнка', 'first name', 'firstname'],
  lastName: ['фамилия', 'last name', 'lastname'],
  dateOfBirth: ['дата рождения', 'дата рожд', 'дата', 'date of birth', 'dateofbirth'],
  gender: ['пол', 'gender'],
  groupLabel: ['группа', 'группа/класс', 'group'],
  expectedParentName: ['имя родителя', 'родитель', 'parent name', 'parent'],
  contactPhone: ['телефон родителя', 'телефон', 'phone'],
  contactEmail: ['email родителя', 'email', 'почта', 'e-mail'],
}

interface ImportRow {
  firstName: string
  lastName?: string
  dateOfBirth?: string
  gender?: string
  groupLabel?: string
  expectedParentName?: string
  contactPhone?: string
  contactEmail?: string
}

interface PreviewRow {
  row: number
  data: ImportRow
  valid: boolean
  error?: string
}

function normalizeHeader(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function mapHeaders(headerRow: unknown[]): Map<number, keyof ImportRow> {
  const map = new Map<number, keyof ImportRow>()
  headerRow.forEach((cell, index) => {
    const normalized = normalizeHeader(cell)
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(normalized)) {
        map.set(index, field as keyof ImportRow)
        break
      }
    }
  })
  return map
}

function normalizeGender(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const v = raw.trim().toLowerCase()
  if (['м', 'муж', 'мужской', 'male', 'm'].includes(v)) return 'male'
  if (['ж', 'жен', 'женский', 'female', 'f'].includes(v)) return 'female'
  return undefined
}

function normalizeDate(raw: unknown): string | undefined {
  if (!raw) return undefined
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10)
  }
  const str = String(raw).trim()
  return str || undefined
}

function cellToString(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined
  const str = String(raw).trim()
  return str || undefined
}

function validateRow(data: {
  firstName?: string
  contactPhone?: string
  contactEmail?: string
}): string | undefined {
  if (!data.firstName?.trim()) return 'Укажите имя ребёнка'
  if (data.contactPhone && !PHONE_PATTERN.test(data.contactPhone)) {
    return 'Неверный формат телефона'
  }
  if (data.contactEmail && !EMAIL_PATTERN.test(data.contactEmail)) {
    return 'Неверный формат email'
  }
  return undefined
}

function parseWorkbook(buffer: Buffer): ImportRow[] {
  const workbook = read(buffer, { type: 'buffer', cellDates: true })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) return []
  const sheet = workbook.Sheets[firstSheetName]
  const rows = utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false })
  if (rows.length === 0) return []

  const headerMap = mapHeaders(rows[0])
  const dataRows = rows.slice(1)

  return dataRows.map((row) => {
    const data: ImportRow = { firstName: '' }
    headerMap.forEach((field, colIndex) => {
      const cell = row[colIndex]
      if (field === 'dateOfBirth') {
        data.dateOfBirth = normalizeDate(cell)
      } else if (field === 'gender') {
        data.gender = normalizeGender(cellToString(cell))
      } else {
        const strVal = cellToString(cell)
        if (strVal) (data as unknown as Record<string, string>)[field] = strVal
      }
    })
    return data
  })
}

const importRowSchema = z.object({
  firstName: z.string(),
  lastName: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  groupLabel: z.string().optional(),
  expectedParentName: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().optional(),
})

const commitSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(500),
})

function generateChildInviteToken(): string {
  return randomBytes(24).toString('base64url')
}

export const childrenImportRoute: FastifyPluginAsync = async (fastify) => {
  await fastify.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } })

  // POST /orgs/:orgId/children/import/preview — parse + validate, no writes
  fastify.post<{ Params: { orgId: string } }>(
    '/orgs/:orgId/children/import/preview',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const { orgId } = request.params
      const member = await requireOrgMember(request, reply, orgId)
      if (reply.sent) return
      if (member.role !== 'org_admin') {
        return reply.code(403).send({ error: 'Only organization admins can import children' })
      }

      try {
        const file = await request.file()
        if (!file) return reply.code(400).send({ error: 'File is required' })

        const chunks: Buffer[] = []
        for await (const chunk of file.file) chunks.push(chunk)
        const buffer = Buffer.concat(chunks)
        if (buffer.length === 0) return reply.code(400).send({ error: 'File is empty' })

        const parsedRows = parseWorkbook(buffer)
        if (parsedRows.length === 0) {
          return reply.code(400).send({ error: 'No data rows found in the file' })
        }

        const preview: PreviewRow[] = parsedRows.map((data, i) => {
          const error = validateRow(data)
          return { row: i + 2, data, valid: !error, error }
        })

        const validCount = preview.filter((r) => r.valid).length
        const limitCheck = await checkOrgCanAddChildren(orgId, validCount)

        return {
          ok: true,
          totalRows: preview.length,
          validCount,
          invalidCount: preview.length - validCount,
          rows: preview,
          planOk: limitCheck.ok,
          planError: limitCheck.error,
          maxImportable: limitCheck.maxImportable,
        }
      } catch (error: unknown) {
        fastify.log.error({ err: error }, 'Failed to preview children import')
        return reply.code(500).send({
          error: 'Failed to parse file',
          details: error instanceof Error ? error.message : '',
        })
      }
    }
  )

  // POST /orgs/:orgId/children/import/commit — actually create children + invites
  fastify.post<{ Params: { orgId: string } }>(
    '/orgs/:orgId/children/import/commit',
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
      const { orgId } = request.params
      const member = await requireOrgMember(request, reply, orgId)
      if (reply.sent) return
      if (member.role !== 'org_admin') {
        return reply.code(403).send({ error: 'Only organization admins can import children' })
      }

      const parsed = commitSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid request' })
      }

      const validated = parsed.data.rows.map((data, i) => ({
        row: i + 2,
        data,
        error: validateRow(data),
      }))
      const toCreate = validated.filter((r) => !r.error)
      const skipped = validated.filter((r) => r.error).map((r) => ({ row: r.row, error: r.error! }))

      if (toCreate.length === 0) {
        return reply.code(400).send({ error: 'No valid rows to import' })
      }

      const limitCheck = await checkOrgCanAddChildren(orgId, toCreate.length)
      if (!limitCheck.ok) {
        return reply.code(403).send({ error: limitCheck.error, upgradeRequired: true })
      }

      try {
        const db = getFirestore()
        const scope = memberBranchScope(member)
        const now = admin.firestore.Timestamp.fromDate(new Date())
        const created: {
          row: number
          childId: string
          childName: string
          token: string
          link: string
        }[] = []

        // 3 writes per child (child doc, org-link doc, invite doc) — chunk
        // well under Firestore's 500-ops-per-batch hard limit.
        const CHUNK_SIZE = 150
        for (let i = 0; i < toCreate.length; i += CHUNK_SIZE) {
          const chunk = toCreate.slice(i, i + CHUNK_SIZE)
          const batch = db.batch()

          for (const { data } of chunk) {
            const fullName = [data.firstName.trim(), data.lastName?.trim()]
              .filter(Boolean)
              .join(' ')
            const childRef = db.collection('children').doc()
            batch.set(childRef, {
              name: fullName,
              firstName: data.firstName.trim(),
              lastName: data.lastName?.trim() || null,
              dateOfBirth: data.dateOfBirth || null,
              gender: data.gender || null,
              diagnosis: null,
              primaryConcern: null,
              orgId,
              branchId: scope ?? null,
              createdBy: request.user!.uid,
              createdAt: now,
              updatedAt: now,
            })

            batch.set(db.doc(`organizations/${orgId}/children/${childRef.id}`), {
              assigned: true,
              childId: childRef.id,
              name: fullName,
              branchId: scope ?? null,
              createdAt: now,
              updatedAt: now,
            })

            const token = generateChildInviteToken()
            batch.set(db.doc(`childInvites/${token}`), {
              token,
              orgId,
              childId: childRef.id,
              childName: fullName,
              groupLabel: data.groupLabel || null,
              expectedParentName: data.expectedParentName || null,
              relationship: null,
              contactPhone: data.contactPhone || null,
              contactEmail: data.contactEmail || null,
              status: 'pending',
              createdAt: now,
              createdBy: request.user!.uid,
              claimedAt: null,
              claimedByUid: null,
            })

            created.push({
              row: chunk.find((c) => c.data === data)!.row,
              childId: childRef.id,
              childName: fullName,
              token,
              link: `https://usenuroo.com/join/${token}`,
            })
          }

          await batch.commit()
        }

        return { ok: true, created, skipped }
      } catch (error: unknown) {
        fastify.log.error({ err: error }, 'Failed to commit children import')
        return reply.code(500).send({
          error: 'Failed to import children',
          details: error instanceof Error ? error.message : '',
        })
      }
    }
  )
}

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — declared before the imports that use them
// ---------------------------------------------------------------------------
const mockGetUser = vi.fn()
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ getUser: mockGetUser }),
}))

const mockSend = vi.fn()
vi.mock('../../../modules/email/resend.provider.js', () => ({
  getEmailProvider: () => ({ send: mockSend }),
}))

vi.mock('../../../modules/email/email.templates.js', () => ({
  trialEndingTemplate: (data: { daysRemaining: number }) => ({
    subject: `ending-${data.daysRemaining}`,
    html: '<p>ending</p>',
  }),
  trialEndedTemplate: () => ({ subject: 'ended', html: '<p>ended</p>' }),
}))

const mockGetFirestore = vi.fn()
vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: () => mockGetFirestore(),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------
import admin from 'firebase-admin'
import { runTrialNotificationScan } from '../trialNotifications.routes.js'

function makeTimestamp(date: Date): admin.firestore.Timestamp {
  return { toDate: () => date } as unknown as admin.firestore.Timestamp
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

interface FakeOrg {
  id: string
  name?: string
  createdBy?: string
  billingExtra?: Record<string, unknown>
  trialEndsAt: Date
}

function makeMockDb(orgs: FakeOrg[]) {
  const docRefs = new Map<string, { set: ReturnType<typeof vi.fn> }>()

  const docs = orgs.map((org) => {
    const setSpy = vi.fn().mockResolvedValue(undefined)
    docRefs.set(org.id, { set: setSpy })
    return {
      id: org.id,
      ref: { set: setSpy },
      data: () => ({
        name: org.name ?? org.id,
        createdBy: org.createdBy,
        billing: {
          status: 'trialing',
          trialEndsAt: makeTimestamp(org.trialEndsAt),
          ...org.billingExtra,
        },
      }),
    }
  })

  const where = vi.fn().mockReturnValue({
    get: vi.fn().mockResolvedValue({ size: docs.length, docs }),
  })

  // resolveOrgAdminContact() also reads specialists/{uid} for the admin's
  // display name — not present here, which is fine, it just falls back to
  // deriving the name from the email.
  const doc = vi.fn().mockReturnValue({
    get: vi.fn().mockResolvedValue({ exists: false }),
  })

  return {
    db: { collection: vi.fn().mockReturnValue({ where }), doc },
    docRefs,
  }
}

const nullLogger = { error: vi.fn() } as unknown as import('fastify').FastifyBaseLogger

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue({ email: 'admin@example.com' })
  mockSend.mockResolvedValue(undefined)
})

describe('runTrialNotificationScan', () => {
  it('sends the "ending soon" email once when within the reminder window and not yet notified', async () => {
    const { db, docRefs } = makeMockDb([
      { id: 'org1', createdBy: 'uid1', trialEndsAt: daysFromNow(3) },
    ])
    mockGetFirestore.mockReturnValue(db)

    const result = await runTrialNotificationScan(nullLogger)

    expect(result.endingSoonSent).toBe(1)
    expect(result.endedSent).toBe(0)
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@example.com', subject: 'ending-3' })
    )
    expect(docRefs.get('org1')!.set).toHaveBeenCalledWith(
      { billing: { trialEndingNotifiedAt: expect.anything() } },
      { merge: true }
    )
  })

  it('does not re-send the "ending soon" email if already notified', async () => {
    const { db } = makeMockDb([
      {
        id: 'org1',
        createdBy: 'uid1',
        trialEndsAt: daysFromNow(2),
        billingExtra: { trialEndingNotifiedAt: makeTimestamp(new Date()) },
      },
    ])
    mockGetFirestore.mockReturnValue(db)

    const result = await runTrialNotificationScan(nullLogger)

    expect(result.endingSoonSent).toBe(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('sends the "ended" email once the trial has actually expired', async () => {
    const { db, docRefs } = makeMockDb([
      { id: 'org1', createdBy: 'uid1', trialEndsAt: daysFromNow(-1) },
    ])
    mockGetFirestore.mockReturnValue(db)

    const result = await runTrialNotificationScan(nullLogger)

    expect(result.endedSent).toBe(1)
    expect(result.endingSoonSent).toBe(0)
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@example.com', subject: 'ended' })
    )
    expect(docRefs.get('org1')!.set).toHaveBeenCalledWith(
      { billing: { trialEndedNotifiedAt: expect.anything() } },
      { merge: true }
    )
  })

  it('does not re-send the "ended" email if already notified', async () => {
    const { db } = makeMockDb([
      {
        id: 'org1',
        createdBy: 'uid1',
        trialEndsAt: daysFromNow(-5),
        billingExtra: { trialEndedNotifiedAt: makeTimestamp(new Date()) },
      },
    ])
    mockGetFirestore.mockReturnValue(db)

    const result = await runTrialNotificationScan(nullLogger)

    expect(result.endedSent).toBe(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('does nothing for orgs whose trial is not near expiry', async () => {
    const { db } = makeMockDb([{ id: 'org1', createdBy: 'uid1', trialEndsAt: daysFromNow(20) }])
    mockGetFirestore.mockReturnValue(db)

    const result = await runTrialNotificationScan(nullLogger)

    expect(result.endingSoonSent).toBe(0)
    expect(result.endedSent).toBe(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('skips orgs with no resolvable admin contact instead of throwing', async () => {
    const { db } = makeMockDb([{ id: 'org1', trialEndsAt: daysFromNow(1) }]) // no createdBy
    mockGetFirestore.mockReturnValue(db)

    const result = await runTrialNotificationScan(nullLogger)

    expect(result.skippedNoContact).toBe(1)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('counts a failed send as an error and continues scanning the rest', async () => {
    const { db } = makeMockDb([
      { id: 'org1', createdBy: 'uid1', trialEndsAt: daysFromNow(1) },
      { id: 'org2', createdBy: 'uid2', trialEndsAt: daysFromNow(2) },
    ])
    mockGetFirestore.mockReturnValue(db)
    mockSend.mockRejectedValueOnce(new Error('Resend down')).mockResolvedValueOnce(undefined)

    const result = await runTrialNotificationScan(nullLogger)

    expect(result.errors).toBe(1)
    expect(result.endingSoonSent).toBe(1)
    expect(mockSend).toHaveBeenCalledTimes(2)
  })
})

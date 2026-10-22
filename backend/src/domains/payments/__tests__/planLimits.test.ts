/**
 * Unit tests for planLimits.ts — the plan-gating/quota logic used across the
 * whole app to decide what an org can/can't do on its current plan. Covers
 * each tier's real limits, boundary conditions (exactly-at-limit vs
 * one-over), trial/expired/active status transitions, and the bulk
 * (checkOrgCanAddChildren) partial-failure behavior.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockGetBillingPlan = vi.fn()

vi.mock('../payments.repository.js', () => ({
  getBillingPlan: (...args: unknown[]) => mockGetBillingPlan(...args),
}))

let orgDocData: Record<string, unknown> | undefined
let childrenCount = 0
let membersCount = 0

vi.mock('../../../infrastructure/database/firebase.js', () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn((_path: string) => ({
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({
          exists: orgDocData !== undefined,
          data: () => orgDocData,
        }),
        collection: vi.fn((sub: string) => ({
          get: vi.fn().mockResolvedValue({
            size: sub === 'children' ? childrenCount : sub === 'members' ? membersCount : 0,
          }),
        })),
      })),
    })),
  })),
}))

vi.mock('firebase-admin', () => ({
  default: {
    firestore: {
      Timestamp: {
        now: () => ({ toDate: () => new Date() }),
      },
    },
  },
}))

import {
  PLAN_IDS,
  PLAN_CONFIG,
  PLAN_LIMITS,
  PLAN_DISPLAY_NAMES,
  isPlanId,
  normalizePlanId,
  getPlanLimits,
  getPlanConfig,
  isSubscriptionActive,
  getFreeTrialStatus,
  getSubscriptionStatus,
  getBillingBadgeKey,
  hasFeature,
  checkOrgCanAddChild,
  checkOrgCanAddChildren,
  checkOrgCanAddSpecialist,
  checkOrgHasFeature,
} from '../planLimits.js'

function daysFromNow(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d
}

function fsTimestamp(date: Date) {
  return { toDate: () => date }
}

describe('planLimits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    orgDocData = undefined
    childrenCount = 0
    membersCount = 0
    mockGetBillingPlan.mockResolvedValue(null)
  })

  // ── Static plan data sanity ──────────────────────────────────────────────

  describe('plan tier data', () => {
    it('exposes exactly the 3 known plan ids', () => {
      expect(PLAN_IDS).toEqual(['starter', 'growth', 'enterprise'])
    })

    it('starter: 30 children, 3 specialists', () => {
      expect(PLAN_CONFIG.starter.maxChildren).toBe(30)
      expect(PLAN_CONFIG.starter.maxSpecialists).toBe(3)
      expect(PLAN_LIMITS.starter).toEqual({ children: 30, specialists: 3 })
    })

    it('growth: 80 children, unlimited (null) specialists', () => {
      expect(PLAN_CONFIG.growth.maxChildren).toBe(80)
      expect(PLAN_CONFIG.growth.maxSpecialists).toBeNull()
    })

    it('enterprise: unlimited (null) children and specialists', () => {
      expect(PLAN_CONFIG.enterprise.maxChildren).toBeNull()
      expect(PLAN_CONFIG.enterprise.maxSpecialists).toBeNull()
    })

    it('only starter includes "reports" among the 5 org-tier features gated off for it', () => {
      expect(PLAN_CONFIG.starter.features.reports).toBe(true)
      expect(PLAN_CONFIG.starter.features.orgChildren).toBe(false)
      expect(PLAN_CONFIG.starter.features.teamSchedule).toBe(false)
      expect(PLAN_CONFIG.starter.features.attendance).toBe(false)
      expect(PLAN_CONFIG.starter.features.assignmentsProgress).toBe(false)
    })

    it('growth unlocks team/org features but not branches/finance/enterprise-only features', () => {
      expect(PLAN_CONFIG.growth.features.teamManagement).toBe(true)
      expect(PLAN_CONFIG.growth.features.crm).toBe(true)
      expect(PLAN_CONFIG.growth.features.branches).toBe(false)
      expect(PLAN_CONFIG.growth.features.finance).toBe(false)
      expect(PLAN_CONFIG.growth.features.customIntegrations).toBe(false)
    })

    it('enterprise unlocks every feature', () => {
      for (const value of Object.values(PLAN_CONFIG.enterprise.features)) {
        expect(value).toBe(true)
      }
    })

    it('public display names map internal ids to marketing names', () => {
      expect(PLAN_DISPLAY_NAMES).toEqual({
        starter: 'Nuroo Solo',
        growth: 'Nuroo Business',
        enterprise: 'Nuroo Enterprise',
      })
    })
  })

  // ── isPlanId / normalizePlanId / getPlanLimits / getPlanConfig ──────────

  describe('isPlanId', () => {
    it('accepts the 3 known ids and rejects anything else', () => {
      expect(isPlanId('starter')).toBe(true)
      expect(isPlanId('growth')).toBe(true)
      expect(isPlanId('enterprise')).toBe(true)
      expect(isPlanId('basic')).toBe(false)
      expect(isPlanId('')).toBe(false)
    })
  })

  describe('normalizePlanId', () => {
    it('maps legacy plan ids to their current equivalents', () => {
      expect(normalizePlanId('basic')).toBe('starter')
      expect(normalizePlanId('professional')).toBe('growth')
      expect(normalizePlanId('pro')).toBe('growth')
      expect(normalizePlanId('corporate')).toBe('enterprise')
      expect(normalizePlanId('corp')).toBe('enterprise')
      expect(normalizePlanId('корпоративный')).toBe('enterprise')
    })

    it('is case-insensitive and trims whitespace', () => {
      expect(normalizePlanId('  STARTER  ')).toBe('starter')
      expect(normalizePlanId('Pro')).toBe('growth')
    })

    it('returns null for an unrecognized id', () => {
      expect(normalizePlanId('totally-unknown-plan')).toBeNull()
    })
  })

  describe('getPlanLimits / getPlanConfig', () => {
    it('resolves through legacy aliases', () => {
      expect(getPlanLimits('pro')).toEqual({ children: 80, specialists: null })
      expect(getPlanConfig('basic')?.maxChildren).toBe(30)
    })

    it('returns null for an unknown plan id', () => {
      expect(getPlanLimits('nonsense')).toBeNull()
      expect(getPlanConfig('nonsense')).toBeNull()
    })
  })

  // ── isSubscriptionActive ─────────────────────────────────────────────────

  describe('isSubscriptionActive', () => {
    it('returns false for a null billing record', () => {
      expect(isSubscriptionActive(null)).toBe(false)
    })

    it('returns false when status is not "active"', () => {
      expect(
        isSubscriptionActive({
          planId: 'growth',
          orgId: 'org1',
          status: 'expired',
          currentPlan: 'growth',
        } as never)
      ).toBe(false)
    })

    it('returns false when active but expiresAt is in the past', () => {
      expect(
        isSubscriptionActive({
          planId: 'growth',
          orgId: 'org1',
          status: 'active',
          currentPlan: 'growth',
          expiresAt: fsTimestamp(daysFromNow(-1)),
        } as never)
      ).toBe(false)
    })

    it('returns true when active and expiresAt is in the future', () => {
      expect(
        isSubscriptionActive({
          planId: 'growth',
          orgId: 'org1',
          status: 'active',
          currentPlan: 'growth',
          expiresAt: fsTimestamp(daysFromNow(1)),
        } as never)
      ).toBe(true)
    })

    it('returns true when active with no expiresAt at all', () => {
      expect(
        isSubscriptionActive({
          planId: 'growth',
          orgId: 'org1',
          status: 'active',
          currentPlan: 'growth',
        } as never)
      ).toBe(true)
    })
  })

  // ── getFreeTrialStatus ───────────────────────────────────────────────────

  describe('getFreeTrialStatus', () => {
    it('returns null when the org does not exist', async () => {
      orgDocData = undefined
      expect(await getFreeTrialStatus('missing-org')).toBeNull()
    })

    it('returns null when the org has no freeTrial field', async () => {
      orgDocData = {}
      expect(await getFreeTrialStatus('org1')).toBeNull()
    })

    it('reports an error when trial is missing an expiresAt', async () => {
      orgDocData = { freeTrial: { planId: 'enterprise' } }
      const result = await getFreeTrialStatus('org1')
      expect(result?.active).toBe(false)
      expect(result?.error).toMatch(/missing an expiration date/)
    })

    it('reports expired when expiresAt is in the past', async () => {
      orgDocData = { freeTrial: { planId: 'enterprise', expiresAt: fsTimestamp(daysFromNow(-1)) } }
      const result = await getFreeTrialStatus('org1')
      expect(result?.active).toBe(false)
      expect(result?.error).toMatch(/expired/)
    })

    it('reports active with the stored planId when expiresAt is in the future', async () => {
      orgDocData = { freeTrial: { planId: 'growth', expiresAt: fsTimestamp(daysFromNow(5)) } }
      const result = await getFreeTrialStatus('org1')
      expect(result).toMatchObject({ active: true, planId: 'growth' })
    })

    it('falls back to FREE_TRIAL_PLAN_ID (enterprise) when planId is missing/invalid', async () => {
      orgDocData = { freeTrial: { expiresAt: fsTimestamp(daysFromNow(5)) } }
      const result = await getFreeTrialStatus('org1')
      expect(result?.planId).toBe('enterprise')
    })
  })

  // ── getSubscriptionStatus ────────────────────────────────────────────────

  describe('getSubscriptionStatus — billing plan record (payments.repository) takes priority', () => {
    it('active billing plan with future expiresAt → active:true, source:subscription', async () => {
      mockGetBillingPlan.mockResolvedValue({
        planId: 'growth',
        status: 'active',
        expiresAt: fsTimestamp(daysFromNow(10)),
      })

      const result = await getSubscriptionStatus('org1')
      expect(result).toMatchObject({ active: true, planId: 'growth', source: 'subscription' })
    })

    it('active billing plan with past expiresAt → active:false, billingStatus:expired', async () => {
      mockGetBillingPlan.mockResolvedValue({
        planId: 'growth',
        status: 'active',
        expiresAt: fsTimestamp(daysFromNow(-1)),
      })

      const result = await getSubscriptionStatus('org1')
      expect(result).toMatchObject({ active: false, billingStatus: 'expired' })
    })

    it('cancelled billing plan → active:false, billingStatus:cancelled', async () => {
      mockGetBillingPlan.mockResolvedValue({ planId: 'growth', status: 'cancelled' })

      const result = await getSubscriptionStatus('org1')
      expect(result).toMatchObject({ active: false, billingStatus: 'cancelled' })
    })

    it('non-active, non-cancelled billing plan status → billingStatus:expired', async () => {
      mockGetBillingPlan.mockResolvedValue({ planId: 'growth', status: 'past_due' })

      const result = await getSubscriptionStatus('org1')
      expect(result).toMatchObject({ active: false, billingStatus: 'expired' })
    })
  })

  describe('getSubscriptionStatus — org.billing fallback (manual/legacy records)', () => {
    it('trialing with future trialEndsAt → active:true, source:free_trial', async () => {
      orgDocData = {
        billing: {
          status: 'trialing',
          plan: 'enterprise',
          trialEndsAt: fsTimestamp(daysFromNow(5)),
        },
      }

      const result = await getSubscriptionStatus('org1')
      expect(result).toMatchObject({
        active: true,
        planId: 'enterprise',
        source: 'free_trial',
        billingStatus: 'trialing',
      })
    })

    it('trialing with past trialEndsAt → active:false, expired', async () => {
      orgDocData = {
        billing: {
          status: 'trialing',
          plan: 'enterprise',
          trialEndsAt: fsTimestamp(daysFromNow(-1)),
        },
      }

      const result = await getSubscriptionStatus('org1')
      expect(result).toMatchObject({
        active: false,
        billingStatus: 'expired',
        source: 'free_trial',
      })
    })

    it('manual_active with no currentPeriodEnd → active:true indefinitely', async () => {
      orgDocData = { billing: { status: 'manual_active', plan: 'growth' } }

      const result = await getSubscriptionStatus('org1')
      expect(result).toMatchObject({
        active: true,
        planId: 'growth',
        billingStatus: 'manual_active',
      })
    })

    it('manual_active with future currentPeriodEnd → active:true', async () => {
      orgDocData = {
        billing: {
          status: 'manual_active',
          plan: 'growth',
          currentPeriodEnd: fsTimestamp(daysFromNow(5)),
        },
      }

      const result = await getSubscriptionStatus('org1')
      expect(result.active).toBe(true)
    })

    it('manual_active with past currentPeriodEnd → active:false, expired', async () => {
      orgDocData = {
        billing: {
          status: 'manual_active',
          plan: 'growth',
          currentPeriodEnd: fsTimestamp(daysFromNow(-1)),
        },
      }

      const result = await getSubscriptionStatus('org1')
      expect(result).toMatchObject({
        active: false,
        billingStatus: 'expired',
        source: 'subscription',
      })
    })

    it('normalizes a legacy plan name stored on org.billing.plan', async () => {
      orgDocData = { billing: { status: 'active', plan: 'pro' } }

      const result = await getSubscriptionStatus('org1')
      expect(result).toMatchObject({ active: true, planId: 'growth' })
    })
  })

  describe('getSubscriptionStatus — falls through to free-trial doc, then "no subscription"', () => {
    it('uses org.freeTrial when there is no billing plan and no org.billing', async () => {
      orgDocData = { freeTrial: { planId: 'enterprise', expiresAt: fsTimestamp(daysFromNow(5)) } }

      const result = await getSubscriptionStatus('org1')
      expect(result).toMatchObject({ active: true, source: 'free_trial', planId: 'enterprise' })
    })

    it('surfaces the free trial expiration error when the trial has expired', async () => {
      orgDocData = { freeTrial: { planId: 'enterprise', expiresAt: fsTimestamp(daysFromNow(-5)) } }

      const result = await getSubscriptionStatus('org1')
      expect(result.active).toBe(false)
      expect(result.error).toMatch(/expired/)
    })

    it('returns "No subscription" when there is nothing at all', async () => {
      orgDocData = {}

      const result = await getSubscriptionStatus('org1')
      expect(result).toMatchObject({ active: false, billingStatus: 'expired' })
      expect(result.error).toMatch(/No subscription/)
    })
  })

  // ── getBillingBadgeKey ───────────────────────────────────────────────────

  describe('getBillingBadgeKey', () => {
    it.each([
      ['trialing', 'freeTrial'],
      ['active', 'active'],
      ['manual_active', 'active'],
      ['past_due', 'pastDue'],
      ['expired', 'expired'],
      ['canceled', 'cancelled'],
      ['cancelled', 'cancelled'],
      [undefined, 'expired'],
    ] as const)('%s → %s', (status, expected) => {
      expect(getBillingBadgeKey(status)).toBe(expected)
    })
  })

  // ── hasFeature / checkOrgHasFeature ──────────────────────────────────────

  describe('hasFeature', () => {
    it('returns false when the subscription is not active', async () => {
      orgDocData = {}
      expect(await hasFeature('org1', 'branding')).toBe(false)
    })

    it("returns false when active but the plan doesn't include the feature", async () => {
      orgDocData = { billing: { status: 'active', plan: 'starter' } }
      expect(await hasFeature('org1', 'branding')).toBe(false)
    })

    it('returns true when active and the plan includes the feature', async () => {
      orgDocData = { billing: { status: 'active', plan: 'growth' } }
      expect(await hasFeature('org1', 'branding')).toBe(true)
    })
  })

  describe('checkOrgHasFeature', () => {
    it('returns an upgrade-prompt error naming the plan that unlocks the feature', async () => {
      orgDocData = { billing: { status: 'active', plan: 'starter' } }
      const result = await checkOrgHasFeature('org1', 'finance')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('Nuroo Enterprise')
    })

    it('returns ok:true when the org has the feature', async () => {
      orgDocData = { billing: { status: 'active', plan: 'enterprise' } }
      const result = await checkOrgHasFeature('org1', 'finance')
      expect(result).toEqual({ ok: true })
    })
  })

  // ── checkOrgCanAddChild — boundary conditions ───────────────────────────

  describe('checkOrgCanAddChild', () => {
    it('blocks when the org has no active subscription', async () => {
      orgDocData = {}
      const result = await checkOrgCanAddChild('org1')
      expect(result.ok).toBe(false)
    })

    it('allows adding a child one below the limit (29 of 30 on starter)', async () => {
      orgDocData = { billing: { status: 'active', plan: 'starter' } }
      childrenCount = 29
      const result = await checkOrgCanAddChild('org1')
      expect(result).toEqual({ ok: true })
    })

    it('blocks exactly at the limit (30 of 30 on starter)', async () => {
      orgDocData = { billing: { status: 'active', plan: 'starter' } }
      childrenCount = 30
      const result = await checkOrgCanAddChild('org1')
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/limit of 30 children/)
    })

    it('blocks when already over the limit (31 of 30)', async () => {
      orgDocData = { billing: { status: 'active', plan: 'starter' } }
      childrenCount = 31
      const result = await checkOrgCanAddChild('org1')
      expect(result.ok).toBe(false)
    })

    it('always allows on enterprise (unlimited/null maxChildren), regardless of current count', async () => {
      orgDocData = { billing: { status: 'active', plan: 'enterprise' } }
      childrenCount = 100000
      const result = await checkOrgCanAddChild('org1')
      expect(result).toEqual({ ok: true })
    })
  })

  // ── checkOrgCanAddChildren — bulk variant with partial-failure info ────

  describe('checkOrgCanAddChildren (bulk import)', () => {
    it('allows importing exactly the remaining headroom', async () => {
      orgDocData = { billing: { status: 'active', plan: 'starter' } } // max 30
      childrenCount = 25
      const result = await checkOrgCanAddChildren('org1', 5)
      expect(result).toEqual({ ok: true })
    })

    it('blocks importing one more than the remaining headroom and reports maxImportable', async () => {
      orgDocData = { billing: { status: 'active', plan: 'starter' } } // max 30
      childrenCount = 25
      const result = await checkOrgCanAddChildren('org1', 6)
      expect(result.ok).toBe(false)
      expect(result.maxImportable).toBe(5)
      expect(result.error).toMatch(/5 slots left/)
    })

    it('clamps maxImportable to 0 (not negative) when already over the limit', async () => {
      orgDocData = { billing: { status: 'active', plan: 'starter' } }
      childrenCount = 35 // already 5 over the 30 limit
      const result = await checkOrgCanAddChildren('org1', 1)
      expect(result.ok).toBe(false)
      expect(result.maxImportable).toBe(0)
    })

    it('blocks the whole batch when the org has no active subscription (no maxImportable)', async () => {
      orgDocData = {}
      const result = await checkOrgCanAddChildren('org1', 3)
      expect(result.ok).toBe(false)
      expect(result.maxImportable).toBeUndefined()
    })

    it('always allows any count on enterprise (unlimited)', async () => {
      orgDocData = { billing: { status: 'active', plan: 'enterprise' } }
      childrenCount = 9999
      const result = await checkOrgCanAddChildren('org1', 1000)
      expect(result).toEqual({ ok: true })
    })
  })

  // ── checkOrgCanAddSpecialist — boundary conditions ──────────────────────

  describe('checkOrgCanAddSpecialist', () => {
    it('allows one below the limit (2 of 3 on starter)', async () => {
      orgDocData = { billing: { status: 'active', plan: 'starter' } }
      membersCount = 2
      expect(await checkOrgCanAddSpecialist('org1')).toEqual({ ok: true })
    })

    it('blocks exactly at the limit (3 of 3 on starter)', async () => {
      orgDocData = { billing: { status: 'active', plan: 'starter' } }
      membersCount = 3
      const result = await checkOrgCanAddSpecialist('org1')
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/limit of 3 specialists/)
    })

    it('always allows on growth (unlimited/null maxSpecialists)', async () => {
      orgDocData = { billing: { status: 'active', plan: 'growth' } }
      membersCount = 500
      expect(await checkOrgCanAddSpecialist('org1')).toEqual({ ok: true })
    })

    it('blocks when there is no active subscription', async () => {
      orgDocData = {}
      const result = await checkOrgCanAddSpecialist('org1')
      expect(result.ok).toBe(false)
    })
  })
})

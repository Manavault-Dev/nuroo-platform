'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from '@/i18n/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { usePageAuth } from '@/lib/b2b/usePageAuth'
import { apiClient } from '@/lib/b2b/api'
import { Analytics } from '@/lib/analytics'
import {
  Loader2,
  Building2,
  Star,
  TrendingUp,
  Users,
  ArrowRight,
  CreditCard,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Mail,
  Clock,
  CheckCircle2,
  Info,
} from 'lucide-react'
import { BillingBadge, type BillingBadgeKey } from '@/components/ui/BillingBadge'
import type { BillingMode } from '@/lib/b2b/api'

interface BillingStatus {
  active: boolean
  planId: string | null
  source: 'subscription' | 'free_trial' | null
  billingStatus:
    | 'trialing'
    | 'active'
    | 'manual_active'
    | 'past_due'
    | 'expired'
    | 'cancelled'
    | 'canceled'
    | null
  badge: string | null
  expiresAt: string | null
  usage: {
    children: number
    specialists: number
    childrenLimit: number | null
    specialistsLimit: number | null
  } | null
  features: Record<string, boolean> | null
  error?: string
  trial: {
    active: boolean
    planId: string | null
    startedAt: string | null
    expiresAt: string | null
  } | null
  // Stripe fields
  stripeStatus?: 'trialing' | 'active' | 'past_due' | 'canceled' | null
  stripeCustomerId?: string
  trialEndsAt?: string | null
  currentPeriodEnd?: string | null
  // Billing mode from backend
  billingMode?: BillingMode
  // Direct billing doc fields (manual/nuroo provider)
  billing?: {
    status?: string | null
    plan?: string | null
    provider?: string | null
    trialEndsAt?: string | null
    currentPeriodEnd?: string | null
  }
}

type DateLike =
  | string
  | number
  | Date
  | { seconds?: number; _seconds?: number; toDate?: () => Date }
  | null
  | undefined

function parseDateLike(value: DateLike): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate()
    return Number.isNaN(date.getTime()) ? null : date
  }
  const seconds = value.seconds ?? value._seconds
  if (typeof seconds === 'number') {
    const date = new Date(seconds * 1000)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

export default function BillingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useTranslations('b2b.pages.billing')
  const tPricing = useTranslations('landing.pricing')
  const locale = useLocale()
  const { profile, orgId: currentOrgId, isAdmin, isLoading } = usePageAuth()
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null)
  const [billingStatusLoading, setBillingStatusLoading] = useState(true)
  const [billingStatusOrgId, setBillingStatusOrgId] = useState<string | null>(null)
  const [creatingCheckout, setCreatingCheckout] = useState<string | null>(null)
  const [startingTrial, setStartingTrial] = useState(false)
  const [trialStarted, setTrialStarted] = useState(false)
  const [openingPortal, setOpeningPortal] = useState(false)
  const [error, setError] = useState('')
  const currentOrg =
    profile?.organizations.find((org) => org.orgId === currentOrgId) ?? profile?.organizations[0]

  const numberLocale =
    locale === 'en' ? 'en-US' : locale === 'ru' ? 'ru-RU' : locale === 'ky' ? 'ky-KG' : 'en-US'
  const formatDate = (value: DateLike, options?: Intl.DateTimeFormatOptions): string | null =>
    parseDateLike(value)?.toLocaleDateString(numberLocale, options) ?? null

  const stripeReturn = searchParams?.get('stripe')

  useEffect(() => {
    if (!isLoading && !profile) router.push('/b2b/login')
  }, [isLoading, profile, router])

  useEffect(() => {
    if (!currentOrgId) {
      setBillingStatus(null)
      setBillingStatusOrgId(null)
      setBillingStatusLoading(false)
      return
    }
    let cancelled = false
    setBillingStatus(null)
    setBillingStatusOrgId(null)
    setBillingStatusLoading(true)
    const loadStatus = async () => {
      try {
        const statusRes = await apiClient.getBillingStatus(currentOrgId)
        if (cancelled) return
        if (statusRes?.ok !== false) {
          setBillingStatus({
            active: statusRes?.active ?? false,
            planId: statusRes?.planId ?? statusRes?.billing?.plan ?? null,
            source: statusRes?.source ?? null,
            billingStatus: (statusRes?.billing?.status ??
              statusRes?.billingStatus) as BillingStatus['billingStatus'],
            badge: statusRes?.badge ?? null,
            expiresAt: statusRes?.expiresAt ?? statusRes?.billing?.currentPeriodEnd ?? null,
            usage: statusRes?.usage ?? null,
            features: statusRes?.features ?? null,
            trial: statusRes?.trial ?? null,
            stripeStatus: statusRes?.stripeStatus ?? null,
            stripeCustomerId: statusRes?.stripeCustomerId,
            trialEndsAt: statusRes?.trialEndsAt ?? statusRes?.billing?.trialEndsAt ?? null,
            currentPeriodEnd:
              statusRes?.currentPeriodEnd ?? statusRes?.billing?.currentPeriodEnd ?? null,
            billingMode: statusRes?.billingMode,
            billing: statusRes?.billing,
          })
        }
      } catch {
        // optional
      } finally {
        if (!cancelled) {
          setBillingStatusOrgId(currentOrgId)
          setBillingStatusLoading(false)
        }
      }
    }
    loadStatus()
    return () => {
      cancelled = true
    }
  }, [currentOrgId])

  useEffect(() => {
    if (!isLoading && profile) {
      if (!profile.organizations?.length) {
        router.push('/b2b/onboarding')
        return
      }
      if (!isAdmin) {
        router.push(
          profile.organizations[0] ? `/b2b?orgId=${profile.organizations[0].orgId}` : '/b2b'
        )
      }
    }
  }, [isLoading, profile, isAdmin, router])

  useEffect(() => {
    Analytics.billingPageOpened()
  }, [])

  const effectiveStripeStatus = billingStatus?.stripeStatus ?? billingStatus?.billingStatus

  const handleStripeCheckout = async (planId: 'starter' | 'growth' | 'enterprise') => {
    if (!currentOrgId) {
      setError(t('missingOrgId'))
      return
    }
    setCreatingCheckout(planId)
    setError('')
    Analytics.paymentStarted({ planId })
    try {
      const result = await apiClient.createStripeCheckout(currentOrgId, planId)
      if (result.url) {
        window.location.href = result.url
      } else {
        setError(t('paymentUrlMissing'))
        setCreatingCheckout(null)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('createPaymentError'))
      setCreatingCheckout(null)
    }
  }

  const handleOpenPortal = async () => {
    if (!currentOrgId) return
    setOpeningPortal(true)
    setError('')
    try {
      const result = await apiClient.createBillingPortalSession(currentOrgId)
      if (result.url) {
        window.location.href = result.url
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('loadError'))
    } finally {
      setOpeningPortal(false)
    }
  }

  const handleStartTrial = async () => {
    if (!currentOrgId) return
    setStartingTrial(true)
    setError('')
    try {
      const result = await apiClient.startTrial(currentOrgId)
      if (result.ok) {
        setTrialStarted(true)
        // Refresh billing status
        const statusRes = await apiClient.getBillingStatus(currentOrgId)
        if (statusRes?.ok !== false) {
          setBillingStatus((prev) => ({
            active: statusRes?.active ?? prev?.active ?? true,
            planId: statusRes?.planId ?? statusRes?.billing?.plan ?? prev?.planId ?? 'growth',
            source: statusRes?.source ?? prev?.source ?? 'free_trial',
            badge: statusRes?.badge ?? prev?.badge ?? null,
            expiresAt:
              statusRes?.expiresAt ??
              statusRes?.billing?.currentPeriodEnd ??
              prev?.expiresAt ??
              null,
            usage: statusRes?.usage ?? prev?.usage ?? null,
            features: statusRes?.features ?? prev?.features ?? null,
            trial: statusRes?.trial ?? prev?.trial ?? null,
            stripeStatus: statusRes?.stripeStatus ?? prev?.stripeStatus ?? null,
            stripeCustomerId: statusRes?.stripeCustomerId ?? prev?.stripeCustomerId,
            currentPeriodEnd:
              statusRes?.currentPeriodEnd ??
              statusRes?.billing?.currentPeriodEnd ??
              prev?.currentPeriodEnd ??
              null,
            billingMode: statusRes?.billingMode ?? prev?.billingMode,
            billing: statusRes?.billing ?? prev?.billing,
            billingStatus: 'trialing',
            trialEndsAt:
              statusRes?.trialEndsAt ??
              statusRes?.billing?.trialEndsAt ??
              result.trialEndsAt ??
              prev?.trialEndsAt ??
              null,
          }))
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('trialStartError'))
    } finally {
      setStartingTrial(false)
    }
  }

  const billingMode: BillingMode = billingStatus?.billingMode ?? 'manual'
  const isManualMode = billingMode === 'manual'
  const isStripeMode = billingMode === 'stripe_test' || billingMode === 'stripe_live'

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {t('profileLoadError')}
        </div>
      </div>
    )
  }

  if (!profile.organizations?.length) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-lg">
          {t('organizationRequired')}
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-lg">
          {t('adminRequired')}
        </div>
      </div>
    )
  }

  if (!currentOrg) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {t('organizationNotFound')}
        </div>
      </div>
    )
  }

  const planLabel = (planId: string | null) => {
    if (planId === 'starter') return t('starterPlan')
    if (planId === 'growth' || planId === 'professional') return t('growthPlan')
    if (planId === 'enterprise') return t('enterprisePlan')
    return planId || ''
  }

  const statusLabel = () => {
    if (billingStatusLoading || (currentOrgId && billingStatusOrgId !== currentOrgId)) {
      return t('loadingStatus')
    }

    if (billingStatus?.source === 'free_trial') {
      const exp = parseDateLike(billingStatus.expiresAt)
      if (!billingStatus.active) return t('trialExpired')
      if (exp)
        return `${t('freeTrial')} - ${t('trialActive')} (${t('trialExpires')} ${exp.toLocaleDateString(numberLocale)})`
      return `${t('freeTrial')} - ${t('trialActive')}`
    }

    if (billingStatus?.billingStatus === 'trialing') {
      const date = formatDate(billingStatus.trialEndsAt ?? billingStatus.billing?.trialEndsAt)
      if (!billingStatus.active) return t('trialExpired')
      const label = `${t('freeTrial')} - ${t('trialActive')}`
      return date ? `${label} (${t('trialExpires')} ${date})` : label
    }

    if (!billingStatus?.active || !billingStatus.planId) return t('noPlan')
    const exp = parseDateLike(billingStatus.expiresAt)
    if (exp && exp.getTime() < Date.now())
      return `${planLabel(billingStatus.planId)} — ${t('planExpired')}`
    if (exp)
      return `${planLabel(billingStatus.planId)} — ${t('planActive')} (${t('planExpires')} ${exp.toLocaleDateString(numberLocale)})`
    return `${planLabel(billingStatus.planId)} — ${t('planActive')}`
  }

  const stripeStatusBadge = () => {
    if (!effectiveStripeStatus) return null
    const cfg: Record<string, { cls: string; label: string }> = {
      trialing: { cls: 'bg-blue-100 text-blue-700 border-blue-200', label: t('statusTrialing') },
      active: { cls: 'bg-green-100 text-green-700 border-green-200', label: t('statusActive') },
      manual_active: {
        cls: 'bg-teal-100 text-teal-700 border-teal-200',
        label: t('statusActive'),
      },
      past_due: { cls: 'bg-red-100 text-red-700 border-red-200', label: t('statusPastDue') },
      expired: { cls: 'bg-gray-100 text-gray-500 border-gray-200', label: t('statusExpired') },
      canceled: { cls: 'bg-gray-100 text-gray-600 border-gray-200', label: t('statusCanceled') },
      cancelled: { cls: 'bg-gray-100 text-gray-600 border-gray-200', label: t('statusCanceled') },
    }
    const c = cfg[effectiveStripeStatus]
    if (!c) return null
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${c.cls}`}
      >
        <CreditCard className="w-3 h-3" />
        {c.label}
      </span>
    )
  }

  const hasStripeCustomer = Boolean(billingStatus?.stripeCustomerId)
  const trialEndDate = formatDate(billingStatus?.trialEndsAt)
  const manualStatus = billingStatus?.billingStatus
  const manualPlanEndDate =
    billingStatus?.currentPeriodEnd ?? billingStatus?.billing?.currentPeriodEnd
  const hasManualActiveBilling = manualStatus === 'manual_active' || manualStatus === 'active'
  const manualTrialUnavailable =
    manualStatus === 'expired' || manualStatus === 'canceled' || manualStatus === 'cancelled'
  const canStartManualTrial =
    isManualMode &&
    !billingStatusLoading &&
    !billingStatus?.active &&
    !trialStarted &&
    !manualTrialUnavailable
  const shouldShowManualContact =
    isManualMode &&
    !billingStatusLoading &&
    !billingStatus?.active &&
    !trialStarted &&
    manualTrialUnavailable

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900">{t('title')}</h2>
        <p className="text-gray-600 mt-2">{t('subtitle')}</p>
      </div>

      {/* Plan distinction banner */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
        <div className="flex items-start gap-3 bg-teal-50 border border-teal-200 rounded-xl p-4">
          <div className="bg-teal-100 rounded-lg p-2 shrink-0">
            <Star className="w-4 h-4 text-teal-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-teal-900">Nuroo</p>
            <p className="text-xs text-teal-700 mt-0.5">
              {t('nurooLabel')} — {t('planDistinctionNuroo')}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-200 rounded-xl p-4">
          <div className="bg-indigo-100 rounded-lg p-2 shrink-0">
            <Building2 className="w-4 h-4 text-indigo-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-indigo-900">Nuroo Business</p>
            <p className="text-xs text-indigo-700 mt-0.5">
              {t('nurooBusinessLabel')} — {t('planDistinctionBusiness')}
            </p>
          </div>
        </div>
      </div>

      {/* Stripe return banners */}
      {stripeReturn === 'success' && (
        <div className="mb-6 flex items-center gap-3 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg">
          <CreditCard className="w-5 h-5 shrink-0" />
          <span>{t('paymentSuccessMessage')}</span>
        </div>
      )}
      {stripeReturn === 'cancel' && (
        <div className="mb-6 flex items-center gap-3 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{t('paymentCancelledMessage')}</span>
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* past_due warning */}
      {effectiveStripeStatus === 'past_due' && !billingStatusLoading && (
        <div className="mb-6 flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 px-4 py-4 rounded-xl">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">{t('paymentFailed')}</p>
          </div>
          <button
            onClick={handleOpenPortal}
            disabled={openingPortal}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-60"
          >
            {openingPortal ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ExternalLink className="w-4 h-4" />
            )}
            {t('stripePortal')}
          </button>
        </div>
      )}

      <div className="max-w-7xl">
        {/* Current plan status card */}
        <div className="mb-8 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="flex items-start space-x-4 flex-1 min-w-0">
              <div className="bg-primary-100 p-3 rounded-lg shrink-0">
                <Building2 className="w-7 h-7 text-primary-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap mb-1">
                  <h3 className="text-lg font-semibold text-gray-900 truncate">
                    {currentOrg.orgName}
                  </h3>
                  {billingStatus?.badge && !billingStatusLoading && (
                    <BillingBadge
                      badge={billingStatus.badge as BillingBadgeKey}
                      trialEndsAt={billingStatus.trial?.expiresAt}
                    />
                  )}
                  {!billingStatusLoading && stripeStatusBadge()}
                </div>
                <p className="text-sm text-gray-500">
                  {t('currentPlan')}:{' '}
                  <span className="font-medium text-gray-800">{statusLabel()}</span>
                </p>

                {/* Trial end date */}
                {effectiveStripeStatus === 'trialing' && trialEndDate && !billingStatusLoading && (
                  <p className="mt-1 text-sm text-blue-600">
                    {t('trialEndsOn', { date: trialEndDate })}
                  </p>
                )}

                {/* Expired / payment required alert */}
                {billingStatus &&
                  !billingStatus.active &&
                  !isManualMode &&
                  effectiveStripeStatus !== 'past_due' && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                      {billingStatus.error ?? t('subscriptionRequired')}
                      <span className="font-semibold"> {t('upgradeToUnlock')}</span>
                    </div>
                  )}
              </div>
            </div>

            {/* Manage subscription button for Stripe customers */}
            {hasStripeCustomer &&
              (effectiveStripeStatus === 'active' ||
                effectiveStripeStatus === 'trialing' ||
                effectiveStripeStatus === 'past_due' ||
                effectiveStripeStatus === 'canceled' ||
                effectiveStripeStatus === 'cancelled') && (
                <button
                  onClick={handleOpenPortal}
                  disabled={openingPortal}
                  className="shrink-0 flex items-center gap-2 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-60"
                >
                  {openingPortal ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CreditCard className="w-4 h-4" />
                  )}
                  {t('stripePortal')}
                </button>
              )}
          </div>

          {/* Reactivate prompt for canceled */}
          {(effectiveStripeStatus === 'canceled' || effectiveStripeStatus === 'cancelled') &&
            !billingStatusLoading && (
              <div className="mt-4 flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                <RefreshCw className="w-4 h-4 shrink-0 text-gray-400" />
                <span>{t('subscriptionRequired')}</span>
              </div>
            )}

          {/* Usage meters */}
          {billingStatus?.usage && !billingStatusLoading && (
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Children */}
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <TrendingUp className="w-4 h-4 text-primary-500" />
                    {t('usageChildren')}
                  </div>
                  <span className="text-sm font-semibold text-gray-900">
                    {billingStatus.usage.children}
                    {billingStatus.usage.childrenLimit !== null
                      ? ` / ${billingStatus.usage.childrenLimit}`
                      : ' / ∞'}
                  </span>
                </div>
                {billingStatus.usage.childrenLimit !== null && (
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all ${
                        billingStatus.usage.children >= billingStatus.usage.childrenLimit
                          ? 'bg-red-500'
                          : billingStatus.usage.children >= billingStatus.usage.childrenLimit * 0.8
                            ? 'bg-amber-400'
                            : 'bg-primary-500'
                      }`}
                      style={{
                        width: `${Math.min(100, (billingStatus.usage.children / billingStatus.usage.childrenLimit) * 100)}%`,
                      }}
                    />
                  </div>
                )}
                {billingStatus.usage.childrenLimit !== null &&
                  billingStatus.usage.children >= billingStatus.usage.childrenLimit && (
                    <p className="mt-1.5 text-xs text-red-600 font-medium">{t('limitReached')}</p>
                  )}
              </div>

              {/* Specialists */}
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <Users className="w-4 h-4 text-primary-500" />
                    {t('usageSpecialists')}
                  </div>
                  <span className="text-sm font-semibold text-gray-900">
                    {billingStatus.usage.specialists}
                    {billingStatus.usage.specialistsLimit !== null
                      ? ` / ${billingStatus.usage.specialistsLimit}`
                      : ' / ∞'}
                  </span>
                </div>
                {billingStatus.usage.specialistsLimit !== null && (
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all ${
                        billingStatus.usage.specialists >= billingStatus.usage.specialistsLimit
                          ? 'bg-red-500'
                          : billingStatus.usage.specialists >=
                              billingStatus.usage.specialistsLimit * 0.8
                            ? 'bg-amber-400'
                            : 'bg-primary-500'
                      }`}
                      style={{
                        width: `${Math.min(100, (billingStatus.usage.specialists / billingStatus.usage.specialistsLimit) * 100)}%`,
                      }}
                    />
                  </div>
                )}
                {billingStatus.usage.specialistsLimit !== null &&
                  billingStatus.usage.specialists >= billingStatus.usage.specialistsLimit && (
                    <p className="mt-1.5 text-xs text-red-600 font-medium">{t('limitReached')}</p>
                  )}
              </div>
            </div>
          )}
        </div>

        {/* ── MANUAL BILLING MODE ── */}
        {isManualMode && (
          <div className="space-y-6">
            {canStartManualTrial && (
              <div className="bg-white border border-primary-100 rounded-2xl p-5 sm:p-6 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="bg-primary-100 p-3 rounded-xl shrink-0">
                      <Clock className="w-6 h-6 text-primary-600" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-gray-900 mb-1">
                        {t('manualTrialTitle')}
                      </h3>
                      <p className="text-sm text-gray-600 max-w-3xl">
                        {t('manualTrialDescription')}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleStartTrial}
                    disabled={startingTrial}
                    className="inline-flex shrink-0 items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-colors disabled:opacity-60"
                  >
                    {startingTrial ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    {t('startFreeTrial')}
                  </button>
                </div>
              </div>
            )}

            {trialStarted && (
              <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-xl p-4">
                <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                <p className="text-sm text-green-800 font-medium">{t('trialStartedSuccess')}</p>
              </div>
            )}

            {billingStatus?.billingStatus === 'trialing' && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-blue-900 mb-1">
                      {t('trialActiveTitle')}
                    </p>
                    {(billingStatus.trialEndsAt ?? billingStatus.billing?.trialEndsAt) && (
                      <p className="text-sm text-blue-700">
                        {t('trialEndsOn', {
                          date:
                            formatDate(
                              billingStatus.trialEndsAt ?? billingStatus.billing?.trialEndsAt,
                              {
                                day: 'numeric',
                                month: 'long',
                                year: 'numeric',
                              }
                            ) ?? '',
                        })}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {hasManualActiveBilling && (
              <div className="bg-teal-50 border border-teal-200 rounded-xl p-5">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-teal-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-teal-900 mb-1">
                      {t('manualActiveTitle')}
                    </p>
                    {manualPlanEndDate ? (
                      <p className="text-sm text-teal-700">
                        {t('activeUntil', {
                          date:
                            formatDate(manualPlanEndDate, {
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                            }) ?? '',
                        })}
                      </p>
                    ) : (
                      <p className="text-sm text-amber-700">{t('activeUntilMissing')}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {shouldShowManualContact && (
              <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="bg-gray-100 p-3 rounded-xl shrink-0">
                      <Mail className="w-6 h-6 text-gray-600" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-gray-900 mb-1">
                        {t('contactToSubscribeTitle')}
                      </h3>
                      <p className="text-sm text-gray-600 max-w-3xl">
                        {t('trialExpiredDescription')}
                      </p>
                    </div>
                  </div>
                  <a
                    href="mailto:tilek.dzenisev@gmail.com?subject=Nuroo%20Subscription%20Request"
                    className="inline-flex shrink-0 items-center justify-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition-colors"
                  >
                    <Mail className="w-4 h-4" />
                    {t('contactNurooTeam')}
                    <ArrowRight className="w-4 h-4" />
                  </a>
                </div>
              </div>
            )}

            {/* Plans overview (informational only — no checkout button) */}
            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-6">{t('plansOverviewTitle')}</h3>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 max-w-4xl">
                {/* Nuroo */}
                <div className="flex flex-col rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
                  <div className="mb-5">
                    <h3 className="text-xl font-bold text-gray-900 mb-1">
                      {tPricing('nurooName')}
                    </h3>
                    <p className="text-sm text-gray-500">{tPricing('nurooSubtitle')}</p>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed mb-6">
                    {tPricing('nurooValueProp')}
                  </p>
                  <div className="mb-7">
                    <div className="inline-flex items-center px-2.5 py-1 rounded-full bg-teal-50 border border-teal-200 text-teal-700 text-xs font-semibold mb-3">
                      {tPricing('trialBadge')}
                    </div>
                    <div className="flex items-end gap-1">
                      <span className="text-sm text-gray-400 pb-1.5">$</span>
                      <span className="text-5xl font-bold text-gray-900 tracking-tight leading-none">
                        15
                      </span>
                      <span className="text-sm text-gray-400 pb-1.5 ml-1">
                        / {tPricing('perMonth')}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-gray-400">{tPricing('afterTrialCaption')}</p>
                  </div>
                  <ul className="space-y-2.5 mb-8 flex-1">
                    {(
                      [
                        'nF1',
                        'nF2',
                        'nF3',
                        'nF4',
                        'nF5',
                        'nF6',
                        'nF7',
                        'nF8',
                        'nF9',
                        'nF10',
                        'nF11',
                      ] as const
                    ).map((key) => (
                      <li key={key} className="flex items-start gap-2.5">
                        <div className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-teal-100 flex items-center justify-center">
                          <CheckCircle2 className="w-2.5 h-2.5 text-teal-600" />
                        </div>
                        <span className="text-sm text-gray-600">{tPricing(key)}</span>
                      </li>
                    ))}
                  </ul>
                  <a
                    href="mailto:tilek.dzenisev@gmail.com?subject=Nuroo%20Subscription%20Request"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition-colors"
                  >
                    {t('contactUs')}
                    <ArrowRight className="w-4 h-4 flex-shrink-0" />
                  </a>
                  <p className="mt-2.5 text-center text-xs text-gray-400">
                    {tPricing('microCopy')}
                  </p>
                </div>

                {/* Nuroo Business */}
                <div className="flex flex-col rounded-2xl border border-teal-200 bg-teal-50/40 p-8 shadow-sm">
                  <div className="mb-5">
                    <h3 className="text-xl font-bold text-gray-900 mb-1">
                      {tPricing('businessName')}
                    </h3>
                    <p className="text-sm text-gray-500">{tPricing('businessSubtitle')}</p>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed mb-6">
                    {tPricing('businessValueProp')}
                  </p>
                  <div className="mb-7">
                    <div className="inline-flex items-center px-2.5 py-1 rounded-full bg-teal-50 border border-teal-200 text-teal-700 text-xs font-semibold mb-3">
                      {tPricing('trialBadge')}
                    </div>
                    <div className="flex items-end gap-1">
                      <span className="text-sm text-gray-400 pb-1.5">$</span>
                      <span className="text-5xl font-bold text-gray-900 tracking-tight leading-none">
                        50
                      </span>
                      <span className="text-sm text-gray-400 pb-1.5 ml-1">
                        / {tPricing('perMonth')}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs text-gray-400">{tPricing('afterTrialCaption')}</p>
                  </div>
                  <ul className="space-y-2.5 mb-8 flex-1">
                    <li className="text-xs font-semibold text-gray-400 uppercase tracking-wide pb-1">
                      {tPricing('businessIntro')}
                    </li>
                    {(
                      ['bF1', 'bF2', 'bF4', 'bF5', 'bF7', 'bF8', 'bF9', 'bF10', 'bF11'] as const
                    ).map((key) => (
                      <li key={key} className="flex items-start gap-2.5">
                        <div className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-teal-100 flex items-center justify-center">
                          <CheckCircle2 className="w-2.5 h-2.5 text-teal-600" />
                        </div>
                        <span className="text-sm text-gray-600">{tPricing(key)}</span>
                      </li>
                    ))}
                  </ul>
                  <a
                    href="mailto:tilek.dzenisev@gmail.com?subject=Nuroo%20Subscription%20Request"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold transition-colors"
                  >
                    {t('contactUs')}
                    <ArrowRight className="w-4 h-4 flex-shrink-0" />
                  </a>
                  <p className="mt-2.5 text-center text-xs text-gray-400">
                    {tPricing('microCopy')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── STRIPE BILLING MODE ── */}
        {isStripeMode && (
          <>
            <div className="mb-6">
              <h3 className="text-base font-semibold text-gray-700 mb-2">{t('upgradeplan')}</h3>
              {billingMode === 'stripe_test' && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {t('stripeTestModeNotice')}
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 max-w-4xl">
              {/* Nuroo — Stripe */}
              {(() => {
                const isCurrentStarter =
                  billingStatus?.active === true &&
                  billingStatus?.planId === 'starter' &&
                  (billingStatus.source === 'subscription' || billingStatus.source === null)
                return (
                  <div className="flex flex-col rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
                    <div className="mb-5">
                      {isCurrentStarter && (
                        <span className="inline-flex items-center gap-1 mb-3 px-2.5 py-1 rounded-full bg-teal-50 border border-teal-200 text-teal-700 text-xs font-semibold">
                          <Star className="w-3 h-3" />
                          {t('current')}
                        </span>
                      )}
                      <h3 className="text-xl font-bold text-gray-900 mb-1">
                        {tPricing('nurooName')}
                      </h3>
                      <p className="text-sm text-gray-500">{tPricing('nurooSubtitle')}</p>
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed mb-6">
                      {tPricing('nurooValueProp')}
                    </p>
                    <div className="mb-7">
                      <div className="inline-flex items-center px-2.5 py-1 rounded-full bg-teal-50 border border-teal-200 text-teal-700 text-xs font-semibold mb-3">
                        {tPricing('trialBadge')}
                      </div>
                      <div className="flex items-end gap-1">
                        <span className="text-sm text-gray-400 pb-1.5">$</span>
                        <span className="text-5xl font-bold text-gray-900 tracking-tight leading-none">
                          15
                        </span>
                        <span className="text-sm text-gray-400 pb-1.5 ml-1">
                          / {tPricing('perMonth')}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs text-gray-400">
                        {tPricing('afterTrialCaption')}
                      </p>
                    </div>
                    <ul className="space-y-2.5 mb-8 flex-1">
                      {(
                        [
                          'nF1',
                          'nF2',
                          'nF3',
                          'nF4',
                          'nF5',
                          'nF6',
                          'nF7',
                          'nF8',
                          'nF9',
                          'nF10',
                          'nF11',
                        ] as const
                      ).map((key) => (
                        <li key={key} className="flex items-start gap-2.5">
                          <div className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-teal-100 flex items-center justify-center">
                            <CheckCircle2 className="w-2.5 h-2.5 text-teal-600" />
                          </div>
                          <span className="text-sm text-gray-600">{tPricing(key)}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={() => handleStripeCheckout('starter')}
                      disabled={creatingCheckout === 'starter' || isCurrentStarter}
                      className={`w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-semibold transition-colors ${
                        isCurrentStarter
                          ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
                          : creatingCheckout === 'starter'
                            ? 'bg-teal-400 text-white cursor-wait'
                            : 'bg-teal-600 hover:bg-teal-700 text-white'
                      }`}
                    >
                      {creatingCheckout === 'starter' ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {t('creatingPayment')}
                        </>
                      ) : isCurrentStarter ? (
                        t('current')
                      ) : (
                        <>
                          {t('startTrial')}
                          <ArrowRight className="w-4 h-4 flex-shrink-0" />
                        </>
                      )}
                    </button>
                    <p className="mt-2.5 text-center text-xs text-gray-400">
                      {tPricing('microCopy')}
                    </p>
                  </div>
                )
              })()}

              {/* Nuroo Business — Stripe */}
              {(() => {
                const isCurrentGrowth =
                  billingStatus?.active === true &&
                  billingStatus?.planId === 'growth' &&
                  (billingStatus.source === 'subscription' || billingStatus.source === null)
                return (
                  <div className="flex flex-col rounded-2xl border border-teal-200 bg-teal-50/40 p-8 shadow-sm">
                    <div className="mb-5">
                      {isCurrentGrowth && (
                        <span className="inline-flex items-center gap-1 mb-3 px-2.5 py-1 rounded-full bg-teal-50 border border-teal-200 text-teal-700 text-xs font-semibold">
                          <Star className="w-3 h-3" />
                          {t('current')}
                        </span>
                      )}
                      <h3 className="text-xl font-bold text-gray-900 mb-1">
                        {tPricing('businessName')}
                      </h3>
                      <p className="text-sm text-gray-500">{tPricing('businessSubtitle')}</p>
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed mb-6">
                      {tPricing('businessValueProp')}
                    </p>
                    <div className="mb-7">
                      <div className="inline-flex items-center px-2.5 py-1 rounded-full bg-teal-50 border border-teal-200 text-teal-700 text-xs font-semibold mb-3">
                        {tPricing('trialBadge')}
                      </div>
                      <div className="flex items-end gap-1">
                        <span className="text-sm text-gray-400 pb-1.5">$</span>
                        <span className="text-5xl font-bold text-gray-900 tracking-tight leading-none">
                          50
                        </span>
                        <span className="text-sm text-gray-400 pb-1.5 ml-1">
                          / {tPricing('perMonth')}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs text-gray-400">
                        {tPricing('afterTrialCaption')}
                      </p>
                    </div>
                    <ul className="space-y-2.5 mb-8 flex-1">
                      <li className="text-xs font-semibold text-gray-400 uppercase tracking-wide pb-1">
                        {tPricing('businessIntro')}
                      </li>
                      {(
                        ['bF1', 'bF2', 'bF4', 'bF5', 'bF7', 'bF8', 'bF9', 'bF10', 'bF11'] as const
                      ).map((key) => (
                        <li key={key} className="flex items-start gap-2.5">
                          <div className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-teal-100 flex items-center justify-center">
                            <CheckCircle2 className="w-2.5 h-2.5 text-teal-600" />
                          </div>
                          <span className="text-sm text-gray-600">{tPricing(key)}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={() => handleStripeCheckout('growth')}
                      disabled={creatingCheckout === 'growth' || isCurrentGrowth}
                      className={`w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-semibold transition-colors ${
                        isCurrentGrowth
                          ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
                          : creatingCheckout === 'growth'
                            ? 'bg-teal-400 text-white cursor-wait'
                            : 'bg-teal-600 hover:bg-teal-700 text-white'
                      }`}
                    >
                      {creatingCheckout === 'growth' ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {t('creatingPayment')}
                        </>
                      ) : isCurrentGrowth ? (
                        t('current')
                      ) : (
                        <>
                          {t('startTrial')}
                          <ArrowRight className="w-4 h-4 flex-shrink-0" />
                        </>
                      )}
                    </button>
                    <p className="mt-2.5 text-center text-xs text-gray-400">
                      {tPricing('microCopy')}
                    </p>
                  </div>
                )
              })()}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

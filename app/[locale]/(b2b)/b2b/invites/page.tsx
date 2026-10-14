'use client'

import { useEffect, useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { usePageAuth } from '@/lib/b2b/usePageAuth'
import { apiClient } from '@/lib/b2b/api'
import { Key, Plus, Copy, Check, Loader2, ExternalLink, Smartphone, RefreshCw } from 'lucide-react'
import { useBranding } from '@/lib/b2b/brandingContext'
import { resolveBrandingAccent } from '@/lib/b2b/themePresets'
import { useAlert } from '@/components/ui/AlertDialog'
import QRCode from 'qrcode'

interface ChildInvite {
  childId: string
  childName: string
  groupLabel: string | null
  token: string
  link: string
  status: 'pending' | 'claimed' | 'pending_review'
}

function ChildInviteQr({ link }: { link: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(link, { width: 160, margin: 1 })
      .then((url) => {
        if (!cancelled) setDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [link])

  if (!dataUrl) {
    return <div className="w-[160px] h-[160px] bg-gray-100 rounded-lg animate-pulse" />
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={dataUrl} alt="QR" className="w-[160px] h-[160px] rounded-lg" />
}

interface InviteCode {
  inviteCode: string
  expiresAt: string
  role?: 'specialist' | 'org_admin' | 'admin'
  maxUses?: number | null
  orgId?: string
  type?: 'specialist' | 'parent'
}

function valueOrDefault(value: number | null | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

type TabKey = 'child' | 'parent' | 'specialist'

export default function InvitesPage() {
  const router = useRouter()
  const t = useTranslations('b2b.pages.invites')
  const { profile, orgId: currentOrgId, isAdmin, isLoading } = usePageAuth()
  const [activeTab, setActiveTab] = useState<TabKey>('child')
  const [invites, setInvites] = useState<InviteCode[]>([])
  const [parentInvites, setParentInvites] = useState<InviteCode[]>([])
  const [creating, setCreating] = useState(false)
  const [creatingParentInvite, setCreatingParentInvite] = useState(false)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const [childInvites, setChildInvites] = useState<ChildInvite[]>([])
  const [childName, setChildName] = useState('')
  const [childGroupLabel, setChildGroupLabel] = useState('')
  const [creatingChildInvite, setCreatingChildInvite] = useState(false)
  const [regeneratingChildId, setRegeneratingChildId] = useState<string | null>(null)
  const [reviewingChildId, setReviewingChildId] = useState<string | null>(null)
  const { alert } = useAlert()
  const currentOrg =
    profile?.organizations.find((org) => org.orgId === currentOrgId) ?? profile?.organizations[0]

  const isSpecialist =
    isAdmin ||
    profile?.organizations?.some((o) => o.orgId === currentOrgId && o.role === 'specialist')

  useEffect(() => {
    if (!isLoading && !profile) {
      router.push('/b2b/login')
      return
    }
    if (!isLoading && profile) {
      if (!profile.organizations?.length) {
        router.push('/b2b/onboarding')
        return
      }
      if (!isSpecialist) {
        router.push(
          profile.organizations[0] ? `/b2b?orgId=${profile.organizations[0].orgId}` : '/b2b'
        )
      }
    }
  }, [isLoading, profile, isSpecialist, router])

  const handleCreateInvite = async (role: 'specialist' | 'org_admin' = 'specialist') => {
    if (!currentOrgId || !isAdmin) return

    setCreating(true)
    try {
      const newInvite = await apiClient.createInvite(currentOrgId, {
        role,
        expiresInDays: 30,
      })

      setInvites([...invites, { ...newInvite, type: 'specialist' }])
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : t('failedCreateInvite')
      alert(errorMessage, { type: 'error' })
    } finally {
      setCreating(false)
    }
  }

  const handleCreateParentInvite = async () => {
    if (!currentOrgId || !isSpecialist) return

    setCreatingParentInvite(true)
    try {
      const newInvite = await apiClient.createParentInvite(currentOrgId)

      setParentInvites([...parentInvites, { ...newInvite, type: 'parent' }])
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : t('failedCreateParentInvite')
      alert(errorMessage, { type: 'error' })
    } finally {
      setCreatingParentInvite(false)
    }
  }

  const tChild = useTranslations('b2b.pages.invites.childInvites')

  const handleCreateChildInvite = async () => {
    if (!currentOrgId || !childName.trim()) return

    setCreatingChildInvite(true)
    try {
      const { child } = await apiClient.createChild(currentOrgId, { firstName: childName.trim() })
      const { token, link } = await apiClient.createChildInvite(currentOrgId, child.id, {
        groupLabel: childGroupLabel.trim() || undefined,
      })

      setChildInvites([
        {
          childId: child.id,
          childName: child.name,
          groupLabel: childGroupLabel.trim() || null,
          token,
          link,
          status: 'pending',
        },
        ...childInvites,
      ])
      setChildName('')
      setChildGroupLabel('')
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : tChild('failedCreateInvite')
      alert(errorMessage, { type: 'error' })
    } finally {
      setCreatingChildInvite(false)
    }
  }

  const handleRegenerateChildInvite = async (invite: ChildInvite) => {
    if (!currentOrgId) return
    setRegeneratingChildId(invite.childId)
    try {
      const { token, link } = await apiClient.createChildInvite(currentOrgId, invite.childId, {
        groupLabel: invite.groupLabel || undefined,
      })
      setChildInvites(
        childInvites.map((ci) =>
          ci.childId === invite.childId ? { ...ci, token, link, status: 'pending' } : ci
        )
      )
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : tChild('failedCreateInvite')
      alert(errorMessage, { type: 'error' })
    } finally {
      setRegeneratingChildId(null)
    }
  }

  const handleReviewClaim = async (childId: string, approve: boolean) => {
    if (!currentOrgId) return
    setReviewingChildId(childId)
    try {
      const { status } = await apiClient.reviewChildInviteClaim(currentOrgId, childId, approve)
      setChildInvites(childInvites.map((ci) => (ci.childId === childId ? { ...ci, status } : ci)))
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : tChild('failedCreateInvite')
      alert(errorMessage, { type: 'error' })
    } finally {
      setReviewingChildId(null)
    }
  }

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  const { branding } = useBranding()
  const brandPrimary = resolveBrandingAccent(branding)
  const logoCropStyle = {
    objectPosition: `${valueOrDefault(branding?.logoPositionX, 50)}% ${valueOrDefault(
      branding?.logoPositionY,
      50
    )}%`,
    transform: `scale(${valueOrDefault(branding?.logoScale, 1)})`,
  }

  const getInviteUrl = (code: string) => {
    return `${typeof window !== 'undefined' ? window.location.origin : ''}/b2b/register?invite=${code}`
  }

  const getParentConnectUrl = (code: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const params = new URLSearchParams({ code })
    if (currentOrgId) params.set('orgId', currentOrgId)
    if (profile?.name) params.set('specialist', profile.name)
    return `${origin}/connect?${params.toString()}`
  }

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

  if (!isSpecialist) {
    return null
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'child', label: tChild('title') },
    { key: 'parent', label: t('parentInvites') },
    ...(isAdmin ? [{ key: 'specialist' as TabKey, label: t('specialistInvites') }] : []),
  ]

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">{t('title')}</h2>
        <p className="text-gray-600 mt-2">{isAdmin ? t('introAdmin') : t('introSpecialist')}</p>
      </div>

      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.key
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="w-full max-w-4xl space-y-6">
        {isAdmin && activeTab === 'specialist' && (
          <div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap mb-4">
              <button
                onClick={() => handleCreateInvite('specialist')}
                disabled={creating || !currentOrgId}
                className="flex w-full items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors sm:w-auto"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('creating')}</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    <span>{t('newSpecialistInvite')}</span>
                  </>
                )}
              </button>
              <button
                onClick={() => handleCreateInvite('org_admin')}
                disabled={creating || !currentOrgId}
                className="flex w-full items-center justify-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors sm:w-auto"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('creating')}</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    <span>{t('newAdminInvite')}</span>
                  </>
                )}
              </button>
            </div>
            {invites.length === 0 ? (
              <p className="text-sm text-gray-500">{t('noSpecialistCodes')}</p>
            ) : (
              <div className="space-y-4">
                {invites.map((invite) => (
                  <div
                    key={invite.inviteCode}
                    className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6"
                  >
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Key className="w-5 h-5 text-primary-600" />
                          <code className="break-all font-mono text-base font-semibold text-gray-900 sm:text-lg">
                            {invite.inviteCode}
                          </code>
                          <span className="px-2 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded">
                            {t('specialist')}
                          </span>
                        </div>
                        <div className="space-y-1 text-sm text-gray-600 sm:ml-8">
                          <p>
                            {t('role')}{' '}
                            <span className="font-medium">
                              {invite.role === 'org_admin' || invite.role === 'admin'
                                ? t('administrator')
                                : t('specialist')}
                            </span>
                          </p>
                          <p>
                            {t('expires')}{' '}
                            <span className="font-medium">
                              {new Date(invite.expiresAt).toLocaleDateString()}
                            </span>
                          </p>
                          {invite.maxUses && (
                            <p>
                              {t('maxUses')} <span className="font-medium">{invite.maxUses}</span>
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 self-start sm:self-auto">
                        <button
                          onClick={() => handleCopy(invite.inviteCode)}
                          className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
                          title={t('copyCode')}
                        >
                          {copiedCode === invite.inviteCode ? (
                            <Check className="w-5 h-5 text-green-600" />
                          ) : (
                            <Copy className="w-5 h-5" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="border-t border-gray-200 pt-4 sm:ml-8">
                      <p className="text-xs text-gray-500 mb-2">{t('registrationUrl')}</p>
                      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                        <input
                          type="text"
                          value={getInviteUrl(invite.inviteCode)}
                          readOnly
                          className="w-full min-w-0 flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50 font-mono"
                        />
                        <button
                          onClick={() => handleCopy(getInviteUrl(invite.inviteCode))}
                          className="w-full px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors sm:w-auto"
                        >
                          {copiedCode === getInviteUrl(invite.inviteCode)
                            ? t('copied')
                            : t('copyUrl')}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'parent' && (
          <div>
            <button
              onClick={handleCreateParentInvite}
              disabled={creatingParentInvite || !currentOrgId}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mb-4"
            >
              {creatingParentInvite ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t('creating')}</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>{t('newParentInvite')}</span>
                </>
              )}
            </button>
            {parentInvites.length === 0 ? (
              <p className="text-sm text-gray-500">{t('noParentCodes')}</p>
            ) : (
              <div className="space-y-4">
                {parentInvites.map((invite) => {
                  const connectUrl = getParentConnectUrl(invite.inviteCode)
                  return (
                    <div
                      key={invite.inviteCode}
                      className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden"
                    >
                      {/* Branded top bar */}
                      <div className="h-1.5 w-full" style={{ background: brandPrimary }} />

                      <div className="p-5 sm:p-6">
                        {/* Header row */}
                        <div className="flex items-start justify-between gap-4 mb-5">
                          <div className="flex items-center gap-3">
                            {branding?.logo ? (
                              <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg">
                                <img
                                  src={branding.logo}
                                  alt="logo"
                                  className="h-full w-full object-cover"
                                  style={logoCropStyle}
                                  onError={(e) => {
                                    ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                                  }}
                                />
                              </div>
                            ) : (
                              <div
                                className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0"
                                style={{ background: brandPrimary }}
                              >
                                {(branding?.name || currentOrg?.orgName || 'N')
                                  .charAt(0)
                                  .toUpperCase()}
                              </div>
                            )}
                            <div>
                              <p className="text-sm font-semibold text-gray-900">
                                {branding?.name || currentOrg?.orgName}
                              </p>
                              <p className="text-xs text-gray-400">
                                {t('parent')} · {t('expires')}{' '}
                                {new Date(invite.expiresAt).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <span
                            className="px-2.5 py-1 text-xs font-semibold rounded-full"
                            style={{ background: `${brandPrimary}18`, color: brandPrimary }}
                          >
                            {t('parent')}
                          </span>
                        </div>

                        {/* Invite code */}
                        <div
                          className="rounded-xl px-4 py-4 mb-5 text-center"
                          style={{
                            background: `${brandPrimary}10`,
                            border: `1px solid ${brandPrimary}25`,
                          }}
                        >
                          <p className="text-xs font-medium text-gray-500 mb-1">
                            {t('inviteCodeForApp')}
                          </p>
                          <p
                            className="text-2xl font-bold tracking-widest font-mono"
                            style={{ color: brandPrimary }}
                          >
                            {invite.inviteCode}
                          </p>
                          <button
                            onClick={() => handleCopy(invite.inviteCode)}
                            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
                          >
                            {copiedCode === invite.inviteCode ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-green-500" /> {t('copied')}
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" /> {t('copyCodeBtn')}
                              </>
                            )}
                          </button>
                        </div>

                        {/* Branded connect link */}
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                            <Smartphone className="w-3.5 h-3.5" />
                            Branded parent link
                          </p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={connectUrl}
                              readOnly
                              className="flex-1 min-w-0 px-3 py-2 text-xs border border-gray-200 rounded-lg bg-gray-50 font-mono text-gray-600"
                            />
                            <button
                              onClick={() => handleCopy(connectUrl)}
                              className="px-3 py-2 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors whitespace-nowrap"
                            >
                              {copiedCode === connectUrl ? t('copied') : t('copyUrl')}
                            </button>
                            <a
                              href={connectUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-center w-9 h-9 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors shrink-0"
                            >
                              <ExternalLink className="w-3.5 h-3.5 text-gray-500" />
                            </a>
                          </div>
                          <p className="text-xs text-gray-400">{t('shareWithParents')}</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'child' && (
          <div>
            <p className="text-sm text-gray-500 mb-4">{tChild('subtitle')}</p>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6 mb-6">
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={childName}
                  onChange={(e) => setChildName(e.target.value)}
                  placeholder={tChild('childNamePlaceholder')}
                  className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-300 rounded-lg"
                />
                <input
                  type="text"
                  value={childGroupLabel}
                  onChange={(e) => setChildGroupLabel(e.target.value)}
                  placeholder={tChild('groupPlaceholder')}
                  className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-300 rounded-lg"
                />
                <button
                  onClick={handleCreateChildInvite}
                  disabled={creatingChildInvite || !childName.trim() || !currentOrgId}
                  className="flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                >
                  {creatingChildInvite ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  <span>{tChild('create')}</span>
                </button>
              </div>
            </div>

            {childInvites.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center text-gray-500">
                {tChild('noInvites')}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {childInvites.map((invite) => (
                  <div
                    key={invite.childId}
                    className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col items-center text-center"
                  >
                    <p className="font-semibold text-gray-900">{invite.childName}</p>
                    {invite.groupLabel && (
                      <p className="text-xs text-gray-500 mb-3">{invite.groupLabel}</p>
                    )}
                    <ChildInviteQr link={invite.link} />
                    <p className="text-xs text-gray-400 mt-3 mb-3">
                      {tChild('scanToConnect', { name: invite.childName })}
                    </p>
                    <span
                      className={`px-2.5 py-1 text-xs font-semibold rounded-full mb-3 ${
                        invite.status === 'claimed'
                          ? 'bg-green-100 text-green-700'
                          : invite.status === 'pending_review'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {invite.status === 'claimed'
                        ? tChild('statusClaimed')
                        : invite.status === 'pending_review'
                          ? tChild('statusPendingReview')
                          : tChild('statusPending')}
                    </span>
                    {invite.status === 'pending_review' && (
                      <div className="w-full mb-2">
                        <p className="text-xs text-amber-600 mb-2">{tChild('pendingReviewHint')}</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleReviewClaim(invite.childId, true)}
                            disabled={reviewingChildId === invite.childId}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                          >
                            {reviewingChildId === invite.childId ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              tChild('approveBtn')
                            )}
                          </button>
                          <button
                            onClick={() => handleReviewClaim(invite.childId, false)}
                            disabled={reviewingChildId === invite.childId}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-red-50 text-red-600 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
                          >
                            {tChild('rejectBtn')}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2 w-full">
                      <button
                        onClick={() => handleCopy(invite.link)}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                      >
                        {copiedCode === invite.link ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-green-600" /> {t('copied')}
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" /> {tChild('copyLink')}
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => handleRegenerateChildInvite(invite)}
                        disabled={
                          regeneratingChildId === invite.childId ||
                          invite.status === 'claimed' ||
                          invite.status === 'pending_review'
                        }
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {regeneratingChildId === invite.childId ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        {tChild('regenerate')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

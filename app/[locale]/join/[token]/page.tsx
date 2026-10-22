'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Loader2, Building2, CheckCircle2, Clock, ArrowRight } from 'lucide-react'
import { AppStoreButton } from '@/components/landing/AppStoreButton'
import { GooglePlayButton } from '@/components/landing/GooglePlayButton'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3101'

interface InviteInfo {
  orgName: string
  childName: string
  status: 'pending' | 'claimed' | 'pending_review'
}

function PageBackground({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-gradient-to-b from-primary-50/50 to-white flex items-center justify-center p-4 sm:p-6">
      <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-primary-200/30 blur-3xl" />
      <div className="absolute -bottom-20 -left-20 w-64 h-64 rounded-full bg-primary-100/40 blur-3xl" />
      <div className="relative w-full flex items-center justify-center">{children}</div>
    </div>
  )
}

export default function JoinChildInvitePage() {
  const t = useTranslations('joinPage')
  const { token } = useParams<{ token: string }>()

  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!token) {
      setLoading(false)
      setError(true)
      return
    }

    fetch(`${API_BASE}/v1/invites/child/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setInvite({ orgName: data.orgName, childName: data.childName, status: data.status })
        } else {
          setError(true)
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [token])

  const handleContinue = () => {
    // The app is the single place this flow actually completes (registration,
    // or accept-while-already-signed-in) — see the plan: no separate
    // parent-facing web auth exists. If it's not installed, the store badges
    // below are the fallback; the same link works again once it is.
    window.location.href = `nuroo://join/${token}`
  }

  if (loading) {
    return (
      <PageBackground>
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </PageBackground>
    )
  }

  if (error || !invite) {
    return (
      <PageBackground>
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 max-w-sm w-full p-8 sm:p-10 text-center">
          <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-5 ring-1 ring-gray-100">
            <Building2 className="w-8 h-8 text-gray-400" />
          </div>
          <h1 className="text-lg font-bold text-gray-900 mb-2">{t('linkNotFound')}</h1>
          <p className="text-sm text-gray-500">{t('linkInvalid')}</p>
        </div>
      </PageBackground>
    )
  }

  return (
    <PageBackground>
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 max-w-sm w-full p-8 sm:p-10 text-center">
        <div className="w-20 h-20 bg-primary-50 rounded-3xl flex items-center justify-center mx-auto mb-6 ring-1 ring-primary-100">
          {invite.status === 'claimed' ? (
            <CheckCircle2 className="w-10 h-10 text-primary-600" />
          ) : invite.status === 'pending_review' ? (
            <Clock className="w-10 h-10 text-amber-500" />
          ) : (
            <Building2 className="w-10 h-10 text-primary-600" />
          )}
        </div>

        <p className="text-xs font-semibold uppercase tracking-wide text-primary-600 mb-2">
          {t('invitedBy', { orgName: invite.orgName })}
        </p>
        <h1 className="text-2xl font-bold text-gray-900 mb-7 tracking-tight">
          {t('connectWith', { childName: invite.childName })}
        </h1>

        {invite.status === 'claimed' ? (
          <p className="text-sm text-gray-500">{t('alreadyClaimed')}</p>
        ) : invite.status === 'pending_review' ? (
          <p className="text-sm text-gray-500">{t('pendingReview')}</p>
        ) : (
          <>
            <button
              onClick={handleContinue}
              className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-primary-600 hover:bg-primary-700 text-white font-semibold rounded-2xl shadow-sm shadow-primary-600/20 transition-colors mb-7"
            >
              {t('continue')}
              <ArrowRight className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3 mb-6">
              <div className="flex-1 h-px bg-gray-100" />
              <p className="text-xs text-gray-400">{t('noAppYet')}</p>
              <div className="flex-1 h-px bg-gray-100" />
            </div>

            <div className="flex items-center justify-center gap-3">
              <AppStoreButton />
              <GooglePlayButton />
            </div>
            <p className="text-xs text-gray-400 mt-5">{t('openLinkAgain')}</p>
          </>
        )}
      </div>
    </PageBackground>
  )
}

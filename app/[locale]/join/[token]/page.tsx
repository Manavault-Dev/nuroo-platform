'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Loader2, Building2, CheckCircle2 } from 'lucide-react'
import { AppStoreButton } from '@/components/landing/AppStoreButton'
import { GooglePlayButton } from '@/components/landing/GooglePlayButton'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3101'

interface InviteInfo {
  orgName: string
  childName: string
  status: 'pending' | 'claimed'
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-teal-500" />
      </div>
    )
  }

  if (error || !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Building2 className="w-7 h-7 text-gray-400" />
          </div>
          <h1 className="text-lg font-semibold text-gray-900 mb-2">{t('linkNotFound')}</h1>
          <p className="text-sm text-gray-500">{t('linkInvalid')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="text-center max-w-sm w-full">
        <div className="w-16 h-16 bg-teal-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
          {invite.status === 'claimed' ? (
            <CheckCircle2 className="w-8 h-8 text-teal-600" />
          ) : (
            <Building2 className="w-8 h-8 text-teal-600" />
          )}
        </div>

        <p className="text-sm text-gray-500 mb-1">{t('invitedBy', { orgName: invite.orgName })}</p>
        <h1 className="text-xl font-bold text-gray-900 mb-6">
          {t('connectWith', { childName: invite.childName })}
        </h1>

        {invite.status === 'claimed' ? (
          <p className="text-sm text-gray-500">{t('alreadyClaimed')}</p>
        ) : (
          <>
            <button
              onClick={handleContinue}
              className="w-full px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white font-semibold rounded-xl transition-colors mb-6"
            >
              {t('continue')}
            </button>

            <p className="text-xs text-gray-400 mb-3">{t('noAppYet')}</p>
            <div className="flex items-center justify-center gap-3">
              <AppStoreButton />
              <GooglePlayButton />
            </div>
            <p className="text-xs text-gray-400 mt-3">{t('openLinkAgain')}</p>
          </>
        )}
      </div>
    </div>
  )
}

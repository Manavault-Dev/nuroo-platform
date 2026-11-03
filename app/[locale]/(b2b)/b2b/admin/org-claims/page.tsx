'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { useAuth } from '@/lib/b2b/AuthContext'
import { getIdToken } from '@/lib/b2b/authClient'
import { db as _db } from '@/lib/firebase/config'
import { doc, getDoc, type Firestore } from 'firebase/firestore'
import { Building2, Check, Loader2, X } from 'lucide-react'

// db is undefined during SSR — all usage is client-only (guarded by useEffect)
const db = _db as Firestore

const API_URL = `${(process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3101').replace(/\/+$/, '')}/v1`

interface PendingClaim {
  claimId: string
  orgId: string
  orgName: string
  uid: string
  contactName: string | null
  contactPhone: string | null
  note: string | null
  submittedAt: unknown
}

async function adminFetch<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  })
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    throw new Error(body.error || r.statusText)
  }
  return r.json()
}

// Organization claim requests — imported/unclaimed marketplace listings that
// someone has asked to connect to their Nuroo account. Approving grants
// org_admin membership and starts the free trial; rejecting reopens the
// listing for another claim. Reuses the same platformRole check as the
// System App Control page.
export default function OrgClaimsAdminPage() {
  const { user } = useAuth()
  const router = useRouter()

  const [checking, setChecking] = useState(true)
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const [claims, setClaims] = useState<PendingClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actioningId, setActioningId] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid))
        const data = snap.data() as Record<string, unknown> | undefined
        if (data?.platformRole === 'platform_admin') {
          setIsPlatformAdmin(true)
        } else {
          router.replace('/b2b')
        }
      } catch {
        router.replace('/b2b')
      } finally {
        setChecking(false)
      }
    })()
  }, [user, router])

  const loadClaims = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const token = await getIdToken()
      if (!token) throw new Error('No session')
      const res = await adminFetch<{ claims: PendingClaim[] }>('/admin/orgs/claims', token)
      setClaims(res.claims)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load claims')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isPlatformAdmin) return
    void loadClaims()
  }, [isPlatformAdmin, loadClaims])

  const handleApprove = async (claim: PendingClaim) => {
    setActioningId(claim.claimId)
    try {
      const token = await getIdToken()
      if (!token) throw new Error('No session')
      await adminFetch(`/admin/orgs/${claim.orgId}/claims/${claim.claimId}/approve`, token, {
        method: 'POST',
      })
      setClaims((prev) => prev.filter((c) => c.claimId !== claim.claimId))
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to approve claim')
    } finally {
      setActioningId(null)
    }
  }

  const handleReject = async (claim: PendingClaim) => {
    // window.prompt returns null specifically when the user clicks Cancel —
    // '' means they clicked OK with an empty field, which should still
    // proceed. Only null aborts the rejection.
    const reason = window.prompt('Причина отказа (необязательно):')
    if (reason === null) return
    setActioningId(claim.claimId)
    try {
      const token = await getIdToken()
      if (!token) throw new Error('No session')
      await adminFetch(`/admin/orgs/${claim.orgId}/claims/${claim.claimId}/reject`, token, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      })
      setClaims((prev) => prev.filter((c) => c.claimId !== claim.claimId))
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to reject claim')
    } finally {
      setActioningId(null)
    }
  }

  if (checking) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }
  if (!isPlatformAdmin) return null

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
        Заявки на подключение организаций
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Запросы владельцев импортированных листингов. Одобрение даёт роль org_admin и запускает
        бесплатный пробный период; отказ снова делает листинг доступным для подключения.
      </p>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : loadError ? (
        <p className="text-red-500 text-sm">{loadError}</p>
      ) : claims.length === 0 ? (
        <p className="text-gray-400 text-sm">Нет заявок, ожидающих рассмотрения.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {claims.map((claim) => (
            <div
              key={claim.claimId}
              className="flex items-start gap-3 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4"
            >
              <Building2 className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 dark:text-white text-sm">
                  {claim.orgName}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">UID: {claim.uid}</p>
                {claim.contactName && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Контакт: {claim.contactName}
                    {claim.contactPhone ? ` · ${claim.contactPhone}` : ''}
                  </p>
                )}
                {claim.note && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{claim.note}</p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => handleReject(claim)}
                  disabled={actioningId === claim.claimId}
                  className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                  title="Отклонить"
                >
                  <X className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleApprove(claim)}
                  disabled={actioningId === claim.claimId}
                  className="p-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-50"
                  title="Одобрить"
                >
                  {actioningId === claim.claimId ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

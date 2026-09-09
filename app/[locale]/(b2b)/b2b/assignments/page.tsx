'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'
import { usePageAuth } from '@/lib/b2b/usePageAuth'
import { PlanGate } from '@/components/b2b/PlanGate'

// Dynamic import — keeps ContentManagement (~1648 lines) out of the initial bundle
const ContentManagement = dynamic(
  () =>
    import('@/components/b2b/ContentManagement').then((m) => ({ default: m.ContentManagement })),
  {
    loading: () => (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
      </div>
    ),
  }
)

export default function AssignmentsPage() {
  const router = useRouter()
  const t = useTranslations('b2b.pages.assignments')
  const { profile, orgId, isLoading } = usePageAuth()

  useEffect(() => {
    if (!isLoading && !profile) router.push('/b2b/login')
  }, [isLoading, profile, router])

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </div>
    )
  }

  if (!orgId) return null

  return (
    <PlanGate feature="assignments_progress">
      <ContentManagement
        mode="org"
        orgId={orgId}
        pageTitle={t('title')}
        pageSubtitle={t('subtitle')}
      />
    </PlanGate>
  )
}

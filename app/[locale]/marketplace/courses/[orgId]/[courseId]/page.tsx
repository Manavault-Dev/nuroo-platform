'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, BookOpen, Calendar, Users, Wifi, MapPin, User } from 'lucide-react'
import { EnrollModal, type PublicCohort } from '../../../MarketplaceClient'

const API_URL = `${(process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3101').replace(/\/+$/, '')}/v1`

interface FullCohort extends PublicCohort {
  description: string
  instructorName: string | null
  targetAudience: 'children' | 'parents' | 'specialists'
  endDate: string
  maxParticipants: number
  enrolledCount: number
  status: 'draft' | 'open' | 'in_progress' | 'full' | 'completed' | 'cancelled'
}

export default function CourseDetailPage() {
  const params = useParams<{ locale: string; orgId: string; courseId: string }>()
  const { locale, orgId, courseId } = params

  const [cohort, setCohort] = useState<FullCohort | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [enrollOpen, setEnrollOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`${API_URL}/marketplace/cohorts/${orgId}/${courseId}`)
      .then((res) => {
        if (!res.ok) throw new Error('not found')
        return res.json()
      })
      .then((data) => {
        if (!cancelled) setCohort(data.cohort)
      })
      .catch(() => {
        if (!cancelled) setNotFound(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [orgId, courseId])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pt-14 md:pt-16 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (notFound || !cohort) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pt-14 md:pt-16 flex flex-col items-center justify-center px-4 text-center">
        <BookOpen className="w-12 h-12 text-gray-300 mb-4" />
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
          Программа не найдена
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Возможно, набор уже закрыт или программа больше не доступна.
        </p>
        <Link
          href={`/${locale}/marketplace?tab=programs`}
          className="text-sm font-semibold text-primary-600 hover:text-primary-700"
        >
          ← Смотреть все программы
        </Link>
      </div>
    )
  }

  const startLabel = new Date(cohort.startDate).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  })
  const endLabel = cohort.endDate
    ? new Date(cohort.endDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    : null
  const ageLabel =
    cohort.ageMin != null
      ? cohort.ageMax != null
        ? `${cohort.ageMin}–${cohort.ageMax} лет`
        : `от ${cohort.ageMin} лет`
      : null
  const isEnrollable = cohort.status === 'open' || cohort.status === 'in_progress'
  const spotsLow = cohort.spotsLeft > 0 && cohort.spotsLeft <= 5

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pt-14 md:pt-16">
      {enrollOpen && <EnrollModal cohort={cohort} onClose={() => setEnrollOpen(false)} />}

      {/* Cover */}
      <div className="relative h-56 md:h-72 bg-gradient-to-br from-primary-600 to-primary-700 overflow-hidden">
        {cohort.coverUrl && (
          <Image
            src={cohort.coverUrl}
            alt=""
            fill
            sizes="100vw"
            className="object-cover"
            priority
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
        <Link
          href={`/${locale}/marketplace?tab=programs`}
          className="absolute top-4 left-4 flex items-center gap-2 text-white/90 hover:text-white text-sm bg-black/25 hover:bg-black/40 px-3 py-2 rounded-full transition-colors z-10"
        >
          <ArrowLeft className="w-4 h-4" />
          Назад
        </Link>
      </div>

      <div className="max-w-3xl mx-auto px-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 -mt-4 mb-6 pt-8 pb-6 px-6">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{cohort.title}</h1>
            {isEnrollable && (
              <button
                onClick={() => setEnrollOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-colors shrink-0"
              >
                Записаться
              </button>
            )}
          </div>

          <Link
            href={`/${locale}/marketplace/${orgId}`}
            className="text-sm text-primary-600 hover:text-primary-700 font-medium"
          >
            {cohort.orgName}
          </Link>

          <div className="flex flex-wrap gap-3 text-sm text-gray-500 dark:text-gray-400 mt-3 mb-3">
            <span className="flex items-center gap-1">
              <Calendar className="w-4 h-4" />
              {startLabel}
              {endLabel ? ` — ${endLabel}` : ''}
            </span>
            <span className="flex items-center gap-1">
              {cohort.format === 'online' ? (
                <Wifi className="w-4 h-4" />
              ) : (
                <MapPin className="w-4 h-4" />
              )}
              {cohort.format === 'online' ? 'Онлайн' : 'Офлайн'}
            </span>
            {ageLabel && (
              <span className="flex items-center gap-1">
                <Users className="w-4 h-4" />
                {ageLabel}
              </span>
            )}
            {cohort.instructorName && (
              <span className="flex items-center gap-1">
                <User className="w-4 h-4" />
                {cohort.instructorName}
              </span>
            )}
          </div>

          {cohort.description && (
            <p className="text-gray-600 dark:text-gray-300 text-sm whitespace-pre-line">
              {cohort.description}
            </p>
          )}

          {cohort.category && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              <span className="px-2.5 py-1 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-xs font-medium rounded-full">
                {cohort.category}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between mt-5 pt-5 border-t border-gray-100 dark:border-gray-800">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Стоимость</div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                {cohort.price === 0
                  ? 'Бесплатно'
                  : `${cohort.price.toLocaleString('ru-RU')} ${cohort.currency} / мес.`}
              </div>
            </div>
            {!isEnrollable ? (
              <span className="text-sm font-medium text-gray-400">Набор закрыт</span>
            ) : spotsLow ? (
              <span className="text-sm font-semibold text-red-500">
                Осталось {cohort.spotsLeft} мест
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

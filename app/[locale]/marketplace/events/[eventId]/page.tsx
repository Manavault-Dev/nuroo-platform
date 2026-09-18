'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Calendar, MapPin, Users, Wifi, CalendarX } from 'lucide-react'
import { getIdToken } from '@/lib/b2b/authClient'

const API_URL = `${(process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3101').replace(/\/+$/, '')}/v1`

interface FullEvent {
  id: string
  orgId: string
  orgName: string
  orgLogoUrl: string | null
  title: string
  description: string
  coverUrl: string | null
  date: string
  endDate: string | null
  location: string
  city: string | null
  format: 'online' | 'offline' | 'hybrid'
  price: number
  currency: string
  spotsTotal: number
  spotsLeft: number
  registeredCount: number
  category: string | null
  ageMin: number | null
  ageMax: number | null
}

const FORMAT_LABEL: Record<FullEvent['format'], string> = {
  online: 'Онлайн',
  offline: 'Офлайн',
  hybrid: 'Гибрид',
}

export default function EventDetailPage() {
  const params = useParams<{ locale: string; eventId: string }>()
  const { locale, eventId } = params

  const [event, setEvent] = useState<FullEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [registered, setRegistered] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`${API_URL}/marketplace/events/${eventId}`)
      .then((res) => {
        if (!res.ok) throw new Error('not found')
        return res.json()
      })
      .then((data) => {
        if (!cancelled) setEvent(data.event)
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
  }, [eventId])

  const handleRegister = async () => {
    if (registered || saving) return
    setSaving(true)
    setError(null)
    try {
      const token = await getIdToken()
      if (!token) {
        setError('Войдите в аккаунт, чтобы зарегистрироваться')
        return
      }
      const res = await fetch(`${API_URL}/marketplace/events/${eventId}/register`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok || res.status === 409) {
        setRegistered(true)
      } else {
        const d = await res.json().catch(() => ({}))
        setError(d?.error ?? 'Не удалось зарегистрироваться')
      }
    } catch {
      setError('Произошла ошибка')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pt-14 md:pt-16 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (notFound || !event) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pt-14 md:pt-16 flex flex-col items-center justify-center px-4 text-center">
        <CalendarX className="w-12 h-12 text-gray-300 mb-4" />
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
          Мероприятие не найдено
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Возможно, оно уже прошло или было отменено.
        </p>
        <Link
          href={`/${locale}/marketplace?tab=events`}
          className="text-sm font-semibold text-primary-600 hover:text-primary-700"
        >
          ← Смотреть все мероприятия
        </Link>
      </div>
    )
  }

  const isPast = new Date(event.date) < new Date()
  const isFree = event.price === 0
  const spotsLow = event.spotsTotal > 0 && event.spotsLeft <= 5
  const dateLabel = new Date(event.date).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
  })
  const timeLabel = new Date(event.date).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pt-14 md:pt-16">
      {/* Cover */}
      <div className="relative h-56 md:h-72 bg-gradient-to-br from-violet-500 to-purple-700 overflow-hidden">
        {event.coverUrl && (
          <Image src={event.coverUrl} alt="" fill sizes="100vw" className="object-cover" priority />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
        <Link
          href={`/${locale}/marketplace?tab=events`}
          className="absolute top-4 left-4 flex items-center gap-2 text-white/90 hover:text-white text-sm bg-black/25 hover:bg-black/40 px-3 py-2 rounded-full transition-colors z-10"
        >
          <ArrowLeft className="w-4 h-4" />
          Назад
        </Link>
      </div>

      <div className="max-w-3xl mx-auto px-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 -mt-4 mb-6 pt-8 pb-6 px-6">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{event.title}</h1>
            {!isPast && (
              <button
                onClick={handleRegister}
                disabled={saving || registered}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors shrink-0 ${
                  registered
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : 'bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-60'
                }`}
              >
                {registered
                  ? '✓ Вы зарегистрированы'
                  : saving
                    ? 'Отправляем…'
                    : 'Зарегистрироваться'}
              </button>
            )}
          </div>

          <Link
            href={`/${locale}/marketplace/${event.orgId}`}
            className="text-sm text-violet-600 hover:text-violet-700 font-medium"
          >
            {event.orgName}
          </Link>

          <div className="flex flex-wrap gap-3 text-sm text-gray-500 dark:text-gray-400 mt-3 mb-3">
            <span className="flex items-center gap-1">
              <Calendar className="w-4 h-4" />
              {dateLabel}, {timeLabel}
            </span>
            <span className="flex items-center gap-1">
              {event.format === 'online' ? (
                <Wifi className="w-4 h-4" />
              ) : (
                <MapPin className="w-4 h-4" />
              )}
              {FORMAT_LABEL[event.format]}
              {event.format !== 'online' && event.location ? ` · ${event.location}` : ''}
            </span>
            {event.registeredCount > 0 && (
              <span className="flex items-center gap-1">
                <Users className="w-4 h-4" />
                {event.registeredCount} участников
              </span>
            )}
          </div>

          {event.description && (
            <p className="text-gray-600 dark:text-gray-300 text-sm whitespace-pre-line">
              {event.description}
            </p>
          )}

          {event.category && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              <span className="px-2.5 py-1 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs font-medium rounded-full">
                {event.category}
              </span>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg mt-3">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between mt-5 pt-5 border-t border-gray-100 dark:border-gray-800">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Стоимость</div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">
                {isFree ? (
                  <span className="text-emerald-600">Бесплатно</span>
                ) : (
                  `${event.price.toLocaleString('ru-RU')} ${event.currency}`
                )}
              </div>
            </div>
            {isPast ? (
              <span className="text-sm font-medium text-gray-400">Мероприятие прошло</span>
            ) : spotsLow ? (
              <span className="text-sm font-semibold text-red-500">
                Осталось {event.spotsLeft} мест
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

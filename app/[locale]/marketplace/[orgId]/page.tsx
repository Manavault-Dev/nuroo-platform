'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { useParams } from 'next/navigation'
import {
  ArrowLeft,
  MapPin,
  Phone,
  Globe,
  Star,
  ChevronRight,
  CheckCircle2,
  X,
  Building2,
  User,
  Clock,
  Calendar,
  ChevronLeft,
  GitBranch,
  Send,
  Loader2,
} from 'lucide-react'
import Link from 'next/link'

const API_URL = `${(process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3101').replace(/\/+$/, '')}/v1`

interface Org {
  id: string
  name: string
  logoUrl: string | null
  coverImageUrl: string | null
  photos?: string[]
  description: string | null
  city: string | null
  country: string | null
  address: string | null
  contactPhone: string | null
  whatsappNumber: string | null
  websiteUrl: string | null
  categories: string[]
  reviewCount: number
  averageRating: number
}

interface Specialist {
  id: string
  fullName: string
  avatarUrl: string | null
  specialization: string | null
  bio: string | null
}

interface Branch {
  id: string
  name: string
  address: string | null
  phone: string | null
  description: string | null
  photoUrl: string | null
}

interface Service {
  id: string
  name: string
  description?: string | null
  durationMinutes: number
  price: number
  currency: string
}

interface Slot {
  id: string
  date: string
  startTime: string
  endTime: string
  status: string
}

type Step = 'specialist' | 'service' | 'slot' | 'confirm' | 'success'

function useUser() {
  const [user, setUser] = useState<{ uid: string; token: string } | null>(null)
  useEffect(() => {
    // Try to get auth from b2b auth context via localStorage token
    const token = localStorage.getItem('nuroo_auth_token')
    const uid = localStorage.getItem('nuroo_uid')
    if (token && uid) setUser({ uid, token })
  }, [])
  return user
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, options)
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    const err = Object.assign(new Error(body.error || r.statusText), { status: r.status, body })
    throw err
  }
  return r.json()
}

// Formats YYYY-MM-DD to locale-aware display string
function formatDate(dateStr: string, locale: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

// Returns array of YYYY-MM-DD strings starting from today
function getDateRange(startOffset: number, count = 7): string[] {
  const dates: string[] = []
  const base = new Date()
  base.setDate(base.getDate() + startOffset)
  for (let i = 0; i < count; i++) {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    dates.push(d.toISOString().split('T')[0])
  }
  return dates
}

export default function OrgPage() {
  const t = useTranslations('marketplace.orgPage')
  const { locale, orgId } = useParams<{ locale: string; orgId: string }>()
  const user = useUser()

  const [org, setOrg] = useState<Org | null>(null)
  const [coverIdx, setCoverIdx] = useState(0)
  const [specialists, setSpecialists] = useState<Specialist[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Admission request ("leave a request") form state
  const [requestModal, setRequestModal] = useState<{ branch: Branch | null } | null>(null)

  // Booking flow state
  const [step, setStep] = useState<Step>('specialist')
  const [selectedSpecialist, setSelectedSpecialist] = useState<Specialist | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [servicesLoading, setServicesLoading] = useState(false)
  const [selectedService, setSelectedService] = useState<Service | null>(null)
  const [dateOffset, setDateOffset] = useState(0)
  const [dates] = useState(() => getDateRange(0, 30))
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [slots, setSlots] = useState<Slot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [booking, setBooking] = useState(false)
  const [bookError, setBookError] = useState<string | null>(null)

  // Load org + specialists + branches
  useEffect(() => {
    Promise.all([
      apiFetch<{ organizations?: Org[] }>('/api/organizations/public').then(
        (d) => d.organizations?.find((o) => o.id === orgId) ?? null
      ),
      apiFetch<{ ok: boolean; specialists: Specialist[] }>(
        `/marketplace/organizations/${orgId}/specialists`
      ).then((d) => d.specialists),
      apiFetch<{ ok: boolean; branches: Branch[] }>(`/marketplace/orgs/${orgId}/branches`)
        .then((d) => d.branches)
        .catch(() => [] as Branch[]),
    ])
      .then(([orgData, specs, branchList]) => {
        if (!orgData) {
          setLoadError(t('loadError'))
          return
        }
        setOrg(orgData)
        setSpecialists(specs)
        setBranches(branchList)
      })
      .catch(() => setLoadError(t('loadError')))
      .finally(() => setLoading(false))
  }, [orgId, t])

  // Load services when specialist selected
  useEffect(() => {
    if (!selectedSpecialist) return
    setServicesLoading(true)
    apiFetch<{ ok: boolean; services: Service[] }>(
      `/marketplace/organizations/${orgId}/specialists/${selectedSpecialist.id}/services`
    )
      .then((d) => setServices(d.services))
      .catch(() => setServices([]))
      .finally(() => setServicesLoading(false))
  }, [selectedSpecialist, orgId])

  // Load slots when date selected
  useEffect(() => {
    if (!selectedDate || !selectedSpecialist) return
    setSlotsLoading(true)
    const params = new URLSearchParams({ date: selectedDate, days: '1' })
    if (selectedService) params.set('serviceId', selectedService.id)
    apiFetch<{ ok: boolean; slots: Slot[] }>(
      `/marketplace/organizations/${orgId}/specialists/${selectedSpecialist.id}/slots?${params}`
    )
      .then((d) => setSlots(d.slots))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false))
  }, [selectedDate, selectedSpecialist, selectedService, orgId])

  const handleSelectSpecialist = (spec: Specialist) => {
    setSelectedSpecialist(spec)
    setSelectedService(null)
    setSelectedSlot(null)
    setSelectedDate(null)
    setSlots([])
    setStep('service')
  }

  const handleSelectService = (svc: Service) => {
    setSelectedService(svc)
    setStep('slot')
  }

  const handleSelectSlot = (slot: Slot) => {
    setSelectedSlot(slot)
    setStep('confirm')
  }

  const handleBook = useCallback(async () => {
    if (!selectedSlot || !selectedSpecialist || !user) return
    setBooking(true)
    setBookError(null)
    try {
      await apiFetch(`/marketplace/organizations/${orgId}/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({
          specialistId: selectedSpecialist.id,
          serviceId: selectedService?.id ?? null,
          slotId: selectedSlot.id,
          date: selectedSlot.date,
          startTime: selectedSlot.startTime,
          endTime: selectedSlot.endTime,
        }),
      })
      setStep('success')
    } catch (err: any) {
      if (err?.status === 409) {
        setBookError(t('slotTaken'))
      } else {
        setBookError(t('bookError'))
      }
    } finally {
      setBooking(false)
    }
  }, [selectedSlot, selectedSpecialist, selectedService, user, orgId, t])

  const visibleDates = dates.slice(dateOffset, dateOffset + 7)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-10 h-10 border-4 border-primary-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (loadError || !org) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-red-500">{loadError || t('loadError')}</p>
        <Link href={`/${locale}/marketplace`} className="text-primary-600 hover:underline">
          {t('back')}
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pt-14 md:pt-16">
      {/* Cover / Gallery carousel */}
      {(() => {
        const allImages = [
          ...(org.coverImageUrl ? [org.coverImageUrl] : []),
          ...(org.photos ?? []).filter((p) => p !== org.coverImageUrl),
        ]
        const total = allImages.length
        const currentImg = allImages[coverIdx] ?? null
        return (
          <div className="relative h-72 md:h-96 bg-gradient-to-br from-primary-600 to-primary-700 overflow-hidden group">
            {/* Blurred background — fills space, any aspect ratio */}
            {currentImg && (
              <Image
                key={`bg-${currentImg}`}
                src={currentImg}
                alt=""
                fill
                sizes="100vw"
                className="object-cover scale-110 blur-xl brightness-50"
                priority
                aria-hidden
              />
            )}
            {/* Full image — no crop, centered */}
            {currentImg && (
              <Image
                key={currentImg}
                src={currentImg}
                alt=""
                fill
                sizes="100vw"
                className="object-contain transition-opacity duration-300"
                priority
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />

            {/* Back button */}
            <Link
              href={`/${locale}/marketplace`}
              className="absolute top-4 left-4 flex items-center gap-2 text-white/90 hover:text-white text-sm bg-black/25 hover:bg-black/40 px-3 py-2 rounded-full transition-colors z-10"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('back')}
            </Link>

            {/* Prev arrow */}
            {total > 1 && coverIdx > 0 && (
              <button
                onClick={() => setCoverIdx((i) => i - 1)}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/85 hover:bg-white flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-10"
              >
                <ChevronLeft className="w-5 h-5 text-gray-800" />
              </button>
            )}

            {/* Next arrow */}
            {total > 1 && coverIdx < total - 1 && (
              <button
                onClick={() => setCoverIdx((i) => i + 1)}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/85 hover:bg-white flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-10"
              >
                <ChevronRight className="w-5 h-5 text-gray-800" />
              </button>
            )}

            {/* Counter badge */}
            {total > 1 && (
              <div className="absolute top-4 right-4 bg-black/50 text-white text-xs font-bold px-2.5 py-1 rounded-full z-10">
                {coverIdx + 1}/{total}
              </div>
            )}

            {/* Dot indicators */}
            {total > 1 && total <= 8 && (
              <div className="absolute bottom-16 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
                {allImages.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCoverIdx(i)}
                    className={`w-1.5 h-1.5 rounded-full transition-all ${i === coverIdx ? 'bg-white w-4' : 'bg-white/50'}`}
                  />
                ))}
              </div>
            )}

            {/* Logo */}
            <div className="absolute bottom-4 left-6 w-16 h-16 rounded-2xl bg-white dark:bg-gray-800 shadow-lg overflow-hidden flex items-center justify-center z-10">
              {org.logoUrl ? (
                <div className="relative w-full h-full">
                  <Image
                    src={org.logoUrl}
                    alt={org.name}
                    fill
                    sizes="64px"
                    className="object-cover scale-[1.3]"
                  />
                </div>
              ) : (
                <Building2 className="w-8 h-8 text-primary-400" />
              )}
            </div>
          </div>
        )
      })()}

      <div className="max-w-5xl mx-auto px-4">
        {/* Org header */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 -mt-4 mb-6 pt-8 pb-5 px-6">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{org.name}</h1>
            <button
              onClick={() => setRequestModal({ branch: null })}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-colors shrink-0"
            >
              <Send className="w-4 h-4" />
              Оставить заявку
            </button>
          </div>

          <div className="flex flex-wrap gap-3 text-sm text-gray-500 dark:text-gray-400 mb-3">
            {(org.city || org.country) && (
              <span className="flex items-center gap-1">
                <MapPin className="w-4 h-4" />
                {[org.city, org.country].filter(Boolean).join(', ')}
              </span>
            )}
            {org.contactPhone && (
              <a
                href={`tel:${org.contactPhone}`}
                className="flex items-center gap-1 hover:text-primary-600"
              >
                <Phone className="w-4 h-4" />
                {org.contactPhone}
              </a>
            )}
            {org.websiteUrl && (
              <a
                href={org.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-primary-600"
              >
                <Globe className="w-4 h-4" />
                {org.websiteUrl.replace(/^https?:\/\//, '')}
              </a>
            )}
            {org.averageRating > 0 && (
              <span className="flex items-center gap-1 text-amber-500">
                <Star className="w-4 h-4 fill-amber-500" />
                {org.averageRating.toFixed(1)} ({org.reviewCount})
              </span>
            )}
          </div>

          {org.description && (
            <p className="text-gray-600 dark:text-gray-300 text-sm">{org.description}</p>
          )}

          {org.categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {org.categories.map((cat) => (
                <span
                  key={cat}
                  className="px-2.5 py-1 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-xs font-medium rounded-full"
                >
                  {cat}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Branches */}
        {branches.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <GitBranch className="w-5 h-5 text-primary-500" />
              Филиалы
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {branches.map((branch) => (
                <div
                  key={branch.id}
                  className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                >
                  {branch.photoUrl ? (
                    <div className="relative h-32 w-full bg-gray-100 dark:bg-gray-800">
                      <Image
                        src={branch.photoUrl}
                        alt={branch.name}
                        fill
                        sizes="400px"
                        className="object-cover"
                      />
                    </div>
                  ) : (
                    <div className="h-32 w-full bg-gradient-to-br from-primary-50 to-primary-100 dark:from-primary-900/30 dark:to-primary-900/10 flex items-center justify-center">
                      <GitBranch className="w-8 h-8 text-primary-300" />
                    </div>
                  )}
                  <div className="p-4">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                      {branch.name}
                    </h3>
                    {branch.description && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2 line-clamp-2">
                        {branch.description}
                      </p>
                    )}
                    <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400 mb-3">
                      {branch.address && (
                        <div className="flex items-start gap-1.5">
                          <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{branch.address}</span>
                        </div>
                      )}
                      {branch.phone && (
                        <a
                          href={`tel:${branch.phone}`}
                          className="flex items-center gap-1.5 hover:text-primary-600"
                        >
                          <Phone className="w-3.5 h-3.5 shrink-0" />
                          {branch.phone}
                        </a>
                      )}
                    </div>
                    <button
                      onClick={() => setRequestModal({ branch })}
                      className="w-full py-2 rounded-lg border border-primary-200 text-primary-700 dark:text-primary-300 text-sm font-medium hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
                    >
                      Записаться в этот филиал
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 pb-16">
          {/* Specialists list */}
          <div className="lg:col-span-2">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              {t('specialists')}
            </h2>
            {specialists.length === 0 ? (
              <p className="text-gray-400 text-sm">{t('noSpecialists')}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {specialists.map((spec) => (
                  <button
                    key={spec.id}
                    onClick={() => handleSelectSpecialist(spec)}
                    className={`text-left p-4 rounded-xl border transition-all ${
                      selectedSpecialist?.id === spec.id
                        ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/20'
                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-primary-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-800 overflow-hidden flex items-center justify-center flex-shrink-0">
                        {spec.avatarUrl ? (
                          <Image
                            src={spec.avatarUrl}
                            alt={spec.fullName}
                            fill
                            sizes="40px"
                            className="object-cover"
                          />
                        ) : (
                          <User className="w-5 h-5 text-primary-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white text-sm truncate">
                          {spec.fullName}
                        </p>
                        {spec.specialization && (
                          <p className="text-gray-400 text-xs truncate">{spec.specialization}</p>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-400 ml-auto flex-shrink-0" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Booking panel */}
          <div className="lg:col-span-3">
            {!selectedSpecialist ? (
              <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-8 text-center text-gray-400">
                <Calendar className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">{t('selectService')}</p>
              </div>
            ) : step === 'success' ? (
              <SuccessPanel locale={locale} t={t} />
            ) : (
              <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                {/* Steps breadcrumb */}
                <div className="flex border-b border-gray-100 dark:border-gray-800">
                  {(['service', 'slot', 'confirm'] as Step[]).map((s, i) => {
                    const stepLabels: Record<string, string> = {
                      service: t('services'),
                      slot: t('selectDate'),
                      confirm: t('confirmTitle'),
                    }
                    const isActive = step === s
                    const isDone =
                      (s === 'service' && ['slot', 'confirm'].includes(step)) ||
                      (s === 'slot' && step === 'confirm')
                    return (
                      <button
                        key={s}
                        onClick={() => {
                          if (isDone) setStep(s)
                        }}
                        disabled={!isDone && !isActive}
                        className={`flex-1 py-3 text-xs font-medium text-center transition-colors ${
                          isActive
                            ? 'text-primary-600 border-b-2 border-primary-500'
                            : isDone
                              ? 'text-gray-500 hover:text-primary-500 cursor-pointer'
                              : 'text-gray-300 cursor-not-allowed'
                        }`}
                      >
                        {i + 1}. {stepLabels[s]}
                      </button>
                    )
                  })}
                </div>

                <div className="p-5">
                  {/* Step: Services */}
                  {step === 'service' && (
                    <div>
                      {servicesLoading ? (
                        <div className="flex justify-center py-8">
                          <div className="w-7 h-7 border-3 border-primary-400 border-t-transparent rounded-full animate-spin" />
                        </div>
                      ) : services.length === 0 ? (
                        <p className="text-gray-400 text-sm text-center py-6">{t('noServices')}</p>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {services.map((svc) => (
                            <button
                              key={svc.id}
                              onClick={() => handleSelectService(svc)}
                              className="flex items-center justify-between p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-primary-400 bg-gray-50 dark:bg-gray-800 transition-all text-left"
                            >
                              <div>
                                <p className="font-medium text-gray-900 dark:text-white text-sm">
                                  {svc.name}
                                </p>
                                {svc.description && (
                                  <p className="text-gray-400 text-xs mt-0.5 line-clamp-1">
                                    {svc.description}
                                  </p>
                                )}
                                <div className="flex items-center gap-2 mt-1.5">
                                  <span className="flex items-center gap-1 text-gray-400 text-xs">
                                    <Clock className="w-3 h-3" />
                                    {t('duration', { min: svc.durationMinutes })}
                                  </span>
                                </div>
                              </div>
                              <div className="text-right ml-4 flex-shrink-0">
                                <p className="font-semibold text-gray-900 dark:text-white text-sm">
                                  {svc.price > 0
                                    ? `${svc.price.toLocaleString()} ${svc.currency}`
                                    : t('free')}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Step: Date + Slot */}
                  {step === 'slot' && (
                    <div>
                      {/* Date picker */}
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                        {t('selectDate')}
                      </p>
                      <div className="flex items-center gap-1 mb-4">
                        <button
                          onClick={() => setDateOffset(Math.max(0, dateOffset - 7))}
                          disabled={dateOffset === 0}
                          className="px-2 py-1.5 text-xs text-gray-500 hover:text-primary-600 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          {t('back7Days')}
                        </button>
                        <div className="flex-1 flex gap-1 overflow-x-auto pb-1">
                          {visibleDates.map((d) => (
                            <button
                              key={d}
                              onClick={() => {
                                setSelectedDate(d)
                                setSelectedSlot(null)
                              }}
                              className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                                selectedDate === d
                                  ? 'bg-primary-600 text-white'
                                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-primary-100'
                              }`}
                            >
                              {formatDate(d, locale).split(',')[0]}
                              <br />
                              <span className="text-[10px] opacity-70">
                                {d.split('-').slice(1).join('/')}
                              </span>
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={() => setDateOffset(Math.min(dates.length - 7, dateOffset + 7))}
                          disabled={dateOffset + 7 >= dates.length}
                          className="px-2 py-1.5 text-xs text-gray-500 hover:text-primary-600 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          {t('next7Days')}
                        </button>
                      </div>

                      {/* Slots */}
                      {selectedDate && (
                        <>
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            {t('selectTime')}
                          </p>
                          {slotsLoading ? (
                            <div className="flex justify-center py-4">
                              <div className="w-6 h-6 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
                            </div>
                          ) : slots.length === 0 ? (
                            <p className="text-gray-400 text-sm text-center py-4">{t('noSlots')}</p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {slots.map((slot) => (
                                <button
                                  key={slot.id}
                                  onClick={() => handleSelectSlot(slot)}
                                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                    selectedSlot?.id === slot.id
                                      ? 'bg-primary-600 text-white'
                                      : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-primary-100'
                                  }`}
                                >
                                  {slot.startTime}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Step: Confirm */}
                  {step === 'confirm' && selectedSlot && (
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white mb-4">
                        {t('confirmTitle')}
                      </h3>
                      <dl className="space-y-3 mb-6">
                        <Row
                          label={t('confirmSpecialist')}
                          value={selectedSpecialist?.fullName ?? ''}
                        />
                        {selectedService && (
                          <Row label={t('confirmService')} value={selectedService.name} />
                        )}
                        <Row
                          label={t('confirmDate')}
                          value={formatDate(selectedSlot.date, locale)}
                        />
                        <Row
                          label={t('confirmTime')}
                          value={`${selectedSlot.startTime} – ${selectedSlot.endTime}`}
                        />
                      </dl>

                      {bookError && (
                        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm flex items-start gap-2">
                          <X className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          {bookError}
                        </div>
                      )}

                      {user ? (
                        <div className="flex gap-3">
                          <button
                            onClick={() => setStep('slot')}
                            className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 transition-colors"
                          >
                            {t('cancelBtn')}
                          </button>
                          <button
                            onClick={handleBook}
                            disabled={booking}
                            className="flex-1 py-3 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                          >
                            {booking ? t('booking') : t('confirmBtn')}
                          </button>
                        </div>
                      ) : (
                        <div className="text-center">
                          <p className="text-gray-500 text-sm mb-3">{t('loginRequired')}</p>
                          <Link
                            href={`/${locale}/(b2b)/login`}
                            className="inline-block px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-colors"
                          >
                            {t('loginBtn')}
                          </Link>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {requestModal && (
        <AdmissionRequestModal
          orgId={orgId}
          branch={requestModal.branch}
          branches={branches}
          onClose={() => setRequestModal(null)}
        />
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between text-sm">
      <dt className="text-gray-500 dark:text-gray-400 flex-shrink-0">{label}</dt>
      <dd className="text-gray-900 dark:text-white font-medium text-right ml-4">{value}</dd>
    </div>
  )
}

function SuccessPanel({
  locale,
  t,
}: {
  locale: string
  t: ReturnType<typeof useTranslations<'marketplace.orgPage'>>
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-10 text-center">
      <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-4" />
      <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t('bookSuccess')}</h3>
      <p className="text-gray-500 text-sm mb-6">{t('loginRequired')}</p>
      <Link
        href={`/${locale}/marketplace`}
        className="inline-block px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-colors"
      >
        {t('back')}
      </Link>
    </div>
  )
}

// ---------- admission request ("leave a request") form ----------

function AdmissionRequestModal({
  orgId,
  branch,
  branches,
  onClose,
}: {
  orgId: string
  branch: Branch | null
  branches: Branch[]
  onClose: () => void
}) {
  const [form, setForm] = useState({
    branchId: branch?.id ?? '',
    parentName: '',
    phone: '',
    email: '',
    childName: '',
    childAge: '',
    programInterest: '',
    message: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((p) => ({ ...p, [key]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.parentName.trim() || !form.phone.trim()) {
      setError('Укажите имя и телефон')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await apiFetch(`/marketplace/orgs/${orgId}/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId: form.branchId || undefined,
          parentName: form.parentName.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() || undefined,
          childName: form.childName.trim() || undefined,
          childAge: form.childAge.trim() || undefined,
          programInterest: form.programInterest.trim() || undefined,
          message: form.message.trim() || undefined,
        }),
      })
      setSubmitted(true)
    } catch {
      setError('Не удалось отправить заявку. Попробуйте ещё раз.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-800">
          <h3 className="font-semibold text-gray-900 dark:text-white">
            {branch ? `Заявка · ${branch.name}` : 'Оставить заявку'}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {submitted ? (
          <div className="p-10 text-center">
            <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-4" />
            <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
              Заявка отправлена!
            </h4>
            <p className="text-gray-500 text-sm mb-6">Мы свяжемся с вами в ближайшее время.</p>
            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-colors"
            >
              Закрыть
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {branches.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Филиал
                </label>
                <select
                  value={form.branchId}
                  onChange={set('branchId')}
                  className="w-full border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                >
                  <option value="">Любой / не важно</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Ваше имя *
              </label>
              <input
                value={form.parentName}
                onChange={set('parentName')}
                required
                className="w-full border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Телефон *
              </label>
              <input
                value={form.phone}
                onChange={set('phone')}
                required
                placeholder="+996 XXX XXX XXX"
                className="w-full border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Ребёнок
                </label>
                <input
                  value={form.childName}
                  onChange={set('childName')}
                  className="w-full border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Возраст
                </label>
                <input
                  value={form.childAge}
                  onChange={set('childAge')}
                  placeholder="5 лет"
                  className="w-full border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Интересующая программа
              </label>
              <input
                value={form.programInterest}
                onChange={set('programInterest')}
                className="w-full border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Комментарий
              </label>
              <textarea
                value={form.message}
                onChange={set('message')}
                rows={3}
                className="w-full border border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
              />
            </div>

            {error && (
              <p className="text-red-500 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Отправить заявку
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

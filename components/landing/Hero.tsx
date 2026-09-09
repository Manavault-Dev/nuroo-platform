import Image from 'next/image'
import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'
import { Search, CheckCircle } from 'lucide-react'
import { AppStoreButton } from './AppStoreButton'
import { GooglePlayButton } from './GooglePlayButton'

type LandingOrg = {
  id: string
  name: string
  logoUrl: string | null
  coverImageUrl: string | null
  city: string | null
  categories: string[]
  averageRating: number
  reviewCount: number
  plan?: 'nuroo' | 'nuroo_business'
  specialization?: string
  priceFrom?: number | null
  currency?: string
}

type LandingMarketplaceData = {
  orgs: LandingOrg[]
}

type HeroCard = {
  src: string
  imageMode: 'cover' | 'logo'
  name: string
  role: string
  price: string
  rating: string
  href: string
}

const MARKETPLACE_TABS = [
  { id: 'centers', label: 'Центры' },
  { id: 'specialists', label: 'Специалисты' },
  { id: 'programs', label: 'Программы' },
  { id: 'events', label: 'Мероприятия' },
] as const

const HERO_CENTER_CARDS: Array<Omit<HeroCard, 'href'>> = [
  {
    src: '/hero-center.png',
    imageMode: 'cover',
    name: 'Happy Kids',
    role: 'Детский центр',
    price: 'от 2 500 сом',
    rating: '4.8',
  },
  {
    src: '/hero-program.png',
    imageMode: 'cover',
    name: 'Центр развития',
    role: 'Детский центр',
    price: 'от 3 500 сом',
    rating: '4.9',
  },
  {
    src: '/cat-centers.png',
    imageMode: 'cover',
    name: 'Семейный центр',
    role: 'Детский центр',
    price: 'Онлайн-запись',
    rating: 'Новый',
  },
]

const SLOTS = ['10:00', '11:30', '16:00', '17:30']

function getHeroCards(orgs: LandingOrg[]): HeroCard[] {
  const centers = orgs.filter((org) => org.plan !== 'nuroo')
  const realCards = centers.slice(0, 3).map((org) => {
    const hasCover = Boolean(org.coverImageUrl)

    return {
      src: org.coverImageUrl || org.logoUrl || '/hero-center.png',
      imageMode: hasCover ? 'cover' : 'logo',
      name: org.name,
      role: org.categories?.[0] || 'Детский центр',
      price: org.priceFrom
        ? `от ${org.priceFrom.toLocaleString('ru-RU')} ${org.currency || 'KGS'}`
        : 'Онлайн-запись',
      rating: org.averageRating > 0 ? org.averageRating.toFixed(1) : 'Новый',
      href: `/marketplace/${org.id}`,
    } satisfies HeroCard
  })

  return [
    ...realCards,
    ...HERO_CENTER_CARDS.map((card) => ({ ...card, href: '/marketplace?tab=centers' })),
  ].slice(0, 3)
}

function HeroImage({
  src,
  alt,
  priority,
  mode,
}: {
  src: string
  alt: string
  priority: boolean
  mode: HeroCard['imageMode']
}) {
  const className = mode === 'cover' ? 'object-cover' : 'object-contain p-4'

  if (src.startsWith('/')) {
    return (
      <Image src={src} alt={alt} fill className={className} sizes="120px" priority={priority} />
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      className={`h-full w-full ${className}`}
      loading={priority ? 'eager' : 'lazy'}
    />
  )
}

export async function Hero({ marketplace }: { marketplace?: LandingMarketplaceData }) {
  const t = await getTranslations('landing.hero')
  const locale = await getLocale()
  const heroCards = getHeroCards(marketplace?.orgs ?? [])

  return (
    <section className="relative pt-28 pb-0 md:pt-32 bg-white dark:bg-gray-950 overflow-hidden">
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-teal-50/50 dark:bg-teal-950/20 rounded-full blur-3xl" />
      </div>

      <div className="container-custom relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* LEFT — copy */}
          <div className="py-8 lg:py-16">
            <div className="mb-5">
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300 text-sm font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse flex-shrink-0" />
                {t('eyebrow')}
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl md:text-[3.25rem] font-bold tracking-tight text-gray-900 dark:text-white mb-5 leading-[1.1]">
              {t('headline')}
            </h1>

            <p className="text-lg text-gray-500 dark:text-gray-400 mb-8 leading-relaxed max-w-md">
              {t('subtitle')}
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mb-5">
              <Link
                href={`/${locale}/marketplace`}
                prefetch={false}
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-base transition-colors shadow-sm"
              >
                <Search className="w-4 h-4" />
                {t('ctaPrimary')}
              </Link>
              <Link
                href={`/${locale}/b2b/register`}
                prefetch={false}
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-semibold text-base transition-colors"
              >
                {t('ctaSecondary')}
              </Link>
            </div>

            <p className="text-sm text-gray-400 dark:text-gray-500 mb-7">{t('trustLine')}</p>

            <div className="flex flex-wrap items-center gap-3">
              <AppStoreButton />
              <GooglePlayButton />
            </div>
          </div>

          {/* RIGHT — product composition */}
          <div className="relative pb-8 lg:pb-16 flex flex-col items-end gap-4">
            {/* Search bar */}
            <div className="w-full bg-white dark:bg-gray-900 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-800 px-4 py-3 flex items-center gap-3">
              <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="text-sm text-gray-400 flex-1">
                Поиск центров, специалистов, программ...
              </span>
              <span className="hidden sm:inline-flex items-center px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold">
                Бишкек
              </span>
            </div>

            {/* Category tabs */}
            <div className="w-full flex gap-2">
              {MARKETPLACE_TABS.map((tab) => (
                <Link
                  key={tab.id}
                  href={`/${locale}/marketplace?tab=${tab.id}`}
                  prefetch={false}
                  className={`flex-1 text-center py-2 rounded-xl text-xs font-semibold border transition-colors ${
                    tab.id === 'centers'
                      ? 'bg-teal-600 text-white border-teal-600'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 hover:border-teal-300 hover:text-teal-600'
                  }`}
                >
                  {tab.label}
                </Link>
              ))}
            </div>

            {/* Photo cards + booking calendar row */}
            <div className="w-full flex gap-3 items-start">
              {/* 3 photo cards */}
              <div className="flex-1 grid grid-cols-3 gap-2">
                {heroCards.map((card, i) => (
                  <Link
                    key={card.name}
                    href={`/${locale}${card.href}`}
                    prefetch={false}
                    className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div
                      className={`relative w-full aspect-square overflow-hidden ${
                        card.imageMode === 'logo'
                          ? 'bg-gradient-to-br from-teal-50 via-white to-cyan-50 dark:from-gray-800 dark:via-gray-900 dark:to-teal-950/40'
                          : 'bg-gray-100 dark:bg-gray-800'
                      }`}
                    >
                      {card.imageMode === 'logo' ? (
                        <div className="absolute inset-3 rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 dark:bg-white overflow-hidden">
                          <HeroImage
                            src={card.src}
                            alt={card.name}
                            priority={i === 0}
                            mode={card.imageMode}
                          />
                        </div>
                      ) : (
                        <HeroImage
                          src={card.src}
                          alt={card.name}
                          priority={i === 0}
                          mode={card.imageMode}
                        />
                      )}
                    </div>
                    <div className="p-2">
                      <div className="text-[11px] font-semibold text-gray-900 dark:text-white leading-tight truncate">
                        {card.name}
                      </div>
                      <div className="text-[9px] text-gray-400 truncate">{card.role}</div>
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-amber-400 text-[9px]">★ {card.rating}</span>
                      </div>
                      <div className="text-[9px] font-semibold text-teal-600 dark:text-teal-400 mt-0.5">
                        {card.price}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>

              {/* Booking calendar */}
              <div className="w-[140px] flex-shrink-0 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-3 shadow-sm">
                <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-2">
                  Выберите время
                </div>
                {/* Mini calendar header */}
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[9px] font-semibold text-gray-700 dark:text-gray-200">
                    Май 2025
                  </span>
                </div>
                <div className="grid grid-cols-7 gap-0.5 mb-2">
                  {['П', 'В', 'С', 'Ч', 'П', 'С', 'В'].map((d, i) => (
                    <div key={i} className="text-[7px] text-gray-400 text-center">
                      {d}
                    </div>
                  ))}
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                    <div
                      key={day}
                      className={`text-[8px] text-center py-0.5 rounded ${
                        day === 14
                          ? 'bg-teal-600 text-white font-bold'
                          : [3, 10, 17].includes(day)
                            ? 'text-gray-300 dark:text-gray-600'
                            : 'text-gray-600 dark:text-gray-300'
                      }`}
                    >
                      {day}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {SLOTS.map((s, i) => (
                    <div
                      key={s}
                      className={`text-[9px] text-center py-1 rounded-lg font-medium ${
                        i === 3
                          ? 'bg-teal-600 text-white'
                          : 'border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                      }`}
                    >
                      {s}
                    </div>
                  ))}
                </div>
                <button className="w-full mt-2 py-1.5 rounded-lg bg-teal-600 text-white text-[9px] font-semibold">
                  Записаться
                </button>
              </div>
            </div>

            {/* Booking confirmed card */}
            <div className="self-end bg-white dark:bg-gray-900 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-800 px-4 py-3 flex items-center gap-3 hero-float-card">
              <div className="w-8 h-8 rounded-full bg-teal-100 dark:bg-teal-900/50 flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-4 h-4 text-teal-600" />
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-900 dark:text-white">
                  Запись подтверждена!
                </div>
                <div className="text-[10px] text-gray-400">
                  17:30 · Сегодня · Айзада М. · Логопед
                </div>
              </div>
              <div className="ml-2 flex flex-col gap-1">
                <div className="text-[9px] text-teal-600 font-medium">Открыть встречу</div>
                <div className="text-[9px] text-gray-400">Добавить в календарь</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

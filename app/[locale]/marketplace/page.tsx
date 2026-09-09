import type { Metadata } from 'next'
import { setRequestLocale } from 'next-intl/server'
import { getAbsoluteUrl, getSiteUrl } from '@/lib/seo/site'
import { MarketplaceClient } from './MarketplaceClient'

// ISR: revalidate marketplace data every 60 seconds
export const revalidate = 60

type Props = {
  params: { locale: string }
  searchParams?: { q?: string }
}

const SERVER_API_URL = `${(process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3101').replace(/\/+$/, '')}/v1`

async function fetchMarketplaceData() {
  try {
    const [orgRes, cohortRes, eventRes] = await Promise.all([
      fetch(`${SERVER_API_URL}/api/organizations/public`, { next: { revalidate: 60 } }),
      fetch(`${SERVER_API_URL}/marketplace/cohorts?limit=100`, { next: { revalidate: 60 } }),
      fetch(`${SERVER_API_URL}/marketplace/events?limit=100`, { next: { revalidate: 60 } }),
    ])

    const [orgData, cohortData, eventData] = await Promise.all([
      orgRes.ok ? orgRes.json() : { organizations: [] },
      cohortRes.ok ? cohortRes.json().catch(() => ({ cohorts: [] })) : { cohorts: [] },
      eventRes.ok ? eventRes.json().catch(() => ({ events: [] })) : { events: [] },
    ])

    return {
      orgs: orgData.organizations ?? [],
      cohorts: Array.isArray(cohortData) ? cohortData : (cohortData?.cohorts ?? []),
      events: Array.isArray(eventData?.events) ? eventData.events : [],
    }
  } catch {
    return { orgs: [], cohorts: [], events: [] }
  }
}

const BASE = getSiteUrl()

const MARKETPLACE_META = {
  ru: {
    title: 'Найти детского специалиста, логопеда, психолога или детский центр | Nuroo',
    description:
      'Каталог детских центров и специалистов: логопеды, психологи, дефектологи, ABA, подготовка к школе и программы развития. Найдите центр и запишитесь онлайн в Nuroo.',
    keywords: [
      'детские центры',
      'детский центр Бишкек',
      'найти логопеда',
      'логопед для ребёнка',
      'детский психолог',
      'дефектолог',
      'ABA терапия',
      'подготовка к школе',
      'детские занятия',
      'развитие ребёнка',
      'Nuroo',
    ],
    ogLocale: 'ru_RU',
  },
  en: {
    title: 'Find child specialists, therapists and development centers | Nuroo',
    description:
      'Browse child development centers, speech therapists, psychologists, ABA, school preparation and child programs. Find a trusted provider and book online with Nuroo.',
    keywords: [
      'child development centers',
      'find speech therapist',
      'child psychologist',
      'ABA therapy',
      'school preparation',
      'children classes',
      'Nuroo',
    ],
    ogLocale: 'en_US',
  },
  ky: {
    title: 'Балдар адистерин, логопеддерди жана балдар борборлорун табуу | Nuroo',
    description:
      'Балдар борборлорун, логопеддерди, психологдорду, ABA терапиясын, мектепке даярдоону жана өнүктүрүү программаларын Nuroo аркылуу табыңыз.',
    keywords: [
      'балдар борбору',
      'логопед',
      'балдар психологу',
      'ABA терапия',
      'мектепке даярдоо',
      'Nuroo',
    ],
    ogLocale: 'ky_KG',
  },
} as const

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = params.locale
  const meta = MARKETPLACE_META[locale as keyof typeof MARKETPLACE_META] ?? MARKETPLACE_META.en
  const alternateLocales = (['ru', 'en', 'ky'] as const)
    .filter((l) => l !== locale)
    .map((l) => MARKETPLACE_META[l].ogLocale)

  return {
    title: meta.title,
    description: meta.description,
    keywords: [...meta.keywords],
    alternates: {
      canonical: getAbsoluteUrl(`/${locale}/marketplace`),
      languages: {
        ru: getAbsoluteUrl('/ru/marketplace'),
        en: getAbsoluteUrl('/en/marketplace'),
        ky: getAbsoluteUrl('/ky/marketplace'),
        'x-default': getAbsoluteUrl('/ru/marketplace'),
      },
    },
    openGraph: {
      title: meta.title,
      description: meta.description,
      url: getAbsoluteUrl(`/${locale}/marketplace`),
      locale: meta.ogLocale,
      alternateLocale: alternateLocales,
      type: 'website',
      siteName: 'Nuroo',
    },
    twitter: {
      card: 'summary_large_image',
      title: meta.title,
      description: meta.description,
    },
  }
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'CollectionPage',
      '@id': `${BASE}/marketplace#collection`,
      name: 'Nuroo Marketplace',
      url: `${BASE}/ru/marketplace`,
      inLanguage: ['ru', 'en', 'ky'],
      about: [
        'детские центры',
        'логопеды',
        'детские психологи',
        'дефектологи',
        'ABA терапия',
        'подготовка к школе',
      ],
    },
    {
      '@type': 'ItemList',
      '@id': `${BASE}/marketplace#services`,
      name: 'Child development services on Nuroo',
      itemListElement: [
        'Speech Therapy',
        'Early Intervention',
        'ABA',
        'Physical Therapy',
        'School Preparation',
        'Psychology',
      ].map((name, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name,
      })),
    },
    {
      '@type': 'WebSite',
      '@id': `${BASE}/#website`,
      url: BASE,
      name: 'Nuroo',
      potentialAction: {
        '@type': 'SearchAction',
        target: `${BASE}/ru/marketplace?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
  ],
}

export default async function MarketplacePage({ params, searchParams }: Props) {
  setRequestLocale(params.locale)
  const initialQuery = typeof searchParams?.q === 'string' ? searchParams.q : ''

  // Fetch data on the server — no client-side waterfall on first load
  const { orgs, cohorts, events } = await fetchMarketplaceData()

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <MarketplaceClient
        locale={params.locale}
        initialQuery={initialQuery}
        initialOrgs={orgs}
        initialCohorts={cohorts}
        initialEvents={events}
      />
    </>
  )
}

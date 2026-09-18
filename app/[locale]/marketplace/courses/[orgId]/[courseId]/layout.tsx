import type { Metadata } from 'next'
import { getAbsoluteUrl } from '@/lib/seo/site'

type Props = {
  params: { locale: string; orgId: string; courseId: string }
  children: React.ReactNode
}

const API_URL = `${(process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3101').replace(/\/+$/, '')}/v1`

const LOCALE_OG: Record<string, string> = { ru: 'ru_RU', en: 'en_US', ky: 'ky_KG' }

const FALLBACK: Record<string, { title: string; description: string }> = {
  ru: {
    title: 'Программа для детей | Nuroo',
    description: 'Запишитесь онлайн на программу для ребёнка через Nuroo.',
  },
  en: {
    title: 'Program for children | Nuroo',
    description: 'Enroll your child in a program through Nuroo.',
  },
  ky: {
    title: 'Балдар үчүн программа | Nuroo',
    description: 'Nuroo аркылуу балаңызды программага жазыңыз.',
  },
}

async function fetchCohortMeta(
  orgId: string,
  courseId: string
): Promise<{ title: string; description: string | null; coverUrl: string | null } | null> {
  try {
    const res = await fetch(`${API_URL}/marketplace/cohorts/${orgId}/${courseId}`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return null
    const data = await res.json()
    const cohort = data?.cohort
    if (!cohort) return null
    return {
      title: cohort.title ?? null,
      description: cohort.description ?? null,
      coverUrl: cohort.coverUrl ?? null,
    }
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, orgId, courseId } = params
  const fallback = FALLBACK[locale] ?? FALLBACK.en
  const ogLocale = LOCALE_OG[locale] ?? 'en_US'

  const cohort = await fetchCohortMeta(orgId, courseId)

  const title = cohort?.title ? `${cohort.title} | Nuroo` : fallback.title
  const description = cohort?.description || fallback.description
  const pageUrl = getAbsoluteUrl(`/${locale}/marketplace/courses/${orgId}/${courseId}`)

  return {
    title,
    description,
    alternates: {
      canonical: pageUrl,
      languages: {
        ru: getAbsoluteUrl(`/ru/marketplace/courses/${orgId}/${courseId}`),
        en: getAbsoluteUrl(`/en/marketplace/courses/${orgId}/${courseId}`),
        ky: getAbsoluteUrl(`/ky/marketplace/courses/${orgId}/${courseId}`),
        'x-default': getAbsoluteUrl(`/ru/marketplace/courses/${orgId}/${courseId}`),
      },
    },
    openGraph: {
      title,
      description,
      type: 'website',
      siteName: 'Nuroo',
      url: pageUrl,
      locale: ogLocale,
      ...(cohort?.coverUrl ? { images: [{ url: cohort.coverUrl }] } : {}),
    },
    twitter: {
      card: cohort?.coverUrl ? 'summary_large_image' : 'summary',
      title,
      description,
    },
  }
}

export default function CourseLayout({ children }: { children: React.ReactNode }) {
  return children
}

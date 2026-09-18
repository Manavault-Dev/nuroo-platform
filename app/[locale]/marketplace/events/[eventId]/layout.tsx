import type { Metadata } from 'next'
import { getAbsoluteUrl } from '@/lib/seo/site'

type Props = {
  params: { locale: string; eventId: string }
  children: React.ReactNode
}

const API_URL = `${(process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3101').replace(/\/+$/, '')}/v1`

const LOCALE_OG: Record<string, string> = { ru: 'ru_RU', en: 'en_US', ky: 'ky_KG' }

const FALLBACK: Record<string, { title: string; description: string }> = {
  ru: {
    title: 'Мероприятие для детей | Nuroo',
    description: 'Зарегистрируйтесь на детское мероприятие через Nuroo.',
  },
  en: {
    title: 'Event for children | Nuroo',
    description: 'Register for a children’s event through Nuroo.',
  },
  ky: {
    title: 'Балдар үчүн иш-чара | Nuroo',
    description: 'Nuroo аркылуу иш-чарага катталыңыз.',
  },
}

async function fetchEventMeta(
  eventId: string
): Promise<{ title: string; description: string | null; coverUrl: string | null } | null> {
  try {
    const res = await fetch(`${API_URL}/marketplace/events/${eventId}`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return null
    const data = await res.json()
    const event = data?.event
    if (!event) return null
    return {
      title: event.title ?? null,
      description: event.description ?? null,
      coverUrl: event.coverUrl ?? null,
    }
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, eventId } = params
  const fallback = FALLBACK[locale] ?? FALLBACK.en
  const ogLocale = LOCALE_OG[locale] ?? 'en_US'

  const event = await fetchEventMeta(eventId)

  const title = event?.title ? `${event.title} | Nuroo` : fallback.title
  const description = event?.description || fallback.description
  const pageUrl = getAbsoluteUrl(`/${locale}/marketplace/events/${eventId}`)

  return {
    title,
    description,
    alternates: {
      canonical: pageUrl,
      languages: {
        ru: getAbsoluteUrl(`/ru/marketplace/events/${eventId}`),
        en: getAbsoluteUrl(`/en/marketplace/events/${eventId}`),
        ky: getAbsoluteUrl(`/ky/marketplace/events/${eventId}`),
        'x-default': getAbsoluteUrl(`/ru/marketplace/events/${eventId}`),
      },
    },
    openGraph: {
      title,
      description,
      type: 'website',
      siteName: 'Nuroo',
      url: pageUrl,
      locale: ogLocale,
      ...(event?.coverUrl ? { images: [{ url: event.coverUrl }] } : {}),
    },
    twitter: {
      card: event?.coverUrl ? 'summary_large_image' : 'summary',
      title,
      description,
    },
  }
}

export default function EventLayout({ children }: { children: React.ReactNode }) {
  return children
}

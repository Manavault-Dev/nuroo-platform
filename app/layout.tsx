import type { Metadata } from 'next'
import { getSiteUrl } from '@/lib/seo/site'
import './globals.css'

const SITE_URL = getSiteUrl()

export const metadata: Metadata = {
  title: {
    default: 'Nuroo | Маркетплейс детского развития',
    template: '%s | Nuroo',
  },
  description:
    'Nuroo: маркетплейс для поиска логопедов, психологов, дефектологов, детских центров и программ развития. Онлайн-запись, управление занятиями и прогресс ребёнка в одном приложении.',
  keywords: [
    'Nuroo',
    'маркетплейс детского развития',
    'логопед онлайн запись',
    'детский центр Бишкек',
    'психолог для ребёнка',
    'дефектолог онлайн',
    'детские программы развития',
    'child development marketplace',
    'speech therapist online booking',
    'child development center',
    'балдарды өнүктүрүү',
  ],
  authors: [{ name: 'Nuroo by Manavault Studio' }],
  creator: 'Nuroo',
  publisher: 'Nuroo',
  category: 'Education',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL(SITE_URL),
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    alternateLocale: ['en_US', 'ky_KG'],
    url: SITE_URL,
    siteName: 'Nuroo',
    title: 'Nuroo | Маркетплейс детского развития',
    description:
      'Найдите логопеда, психолога, дефектолога, детский центр или программу развития. Онлайн-запись и управление занятиями в Nuroo.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Nuroo | Маркетплейс детского развития',
    description:
      'Найдите логопеда, психолога, детский центр или программу развития. Онлайн-запись в Nuroo.',
    creator: '@nuroo',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/logo.png', sizes: '828x828', type: 'image/png' },
    ],
    apple: [{ url: '/logo.png', sizes: '180x180', type: 'image/png' }],
    shortcut: '/favicon.svg',
  },
  verification: {
    google: 'yxwxk4p78_GGey4ZCj-VaVm5BxvhEfRqk3IvBgbNq5A',
  },
}

// Organization structured data — tells Google which image to use as the site logo in search results
const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Nuroo',
  url: 'https://usenuroo.com',
  logo: 'https://usenuroo.com/logo.png',
  sameAs: ['https://www.instagram.com/nuroo.kg'],
  contactPoint: {
    '@type': 'ContactPoint',
    email: 'support@usenuroo.com',
    contactType: 'customer support',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var p=window.location.pathname||'/';if(/^\\/(en|ru|ky)\\/b2b(\\/|$)/.test(p))return;var r=document.documentElement;r.classList.remove('dark');r.classList.add('light');r.style.colorScheme='light'})();`,
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#14b8a6" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="preconnect"
          href="https://firebasestorage.googleapis.com"
          crossOrigin="anonymous"
        />
        <link rel="preconnect" href="https://storage.googleapis.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://encrypted-tbn0.gstatic.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://firebasestorage.googleapis.com" />
        <link rel="dns-prefetch" href="https://storage.googleapis.com" />
      </head>
      <body className="font-sans overflow-x-hidden">{children}</body>
    </html>
  )
}

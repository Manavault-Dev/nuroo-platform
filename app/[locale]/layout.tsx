import { NextIntlClientProvider } from 'next-intl'
import { getMessages, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'
import { ConditionalHeader } from '@/components/layout/ConditionalHeader'
import { LandingOnlyEffects } from '@/components/effects/LandingOnlyEffects'
import { AmplitudeProvider } from '@/components/providers/AmplitudeProvider'
import { SentryClientProvider } from '@/components/providers/SentryClientProvider'

type Props = { children: React.ReactNode; params: Promise<{ locale: string }> }

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout(props: Props) {
  const params = await props.params

  const { children } = props

  const { locale } = params
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound()
  }
  setRequestLocale(locale)
  const messages = await getMessages()

  return (
    <>
      <AmplitudeProvider />
      <SentryClientProvider />
      <NextIntlClientProvider messages={messages} locale={locale}>
        <LandingOnlyEffects />
        <ConditionalHeader />
        {children}
      </NextIntlClientProvider>
    </>
  )
}

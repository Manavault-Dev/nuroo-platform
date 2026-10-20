import { CheckCircle2, XCircle } from 'lucide-react'
import { setRequestLocale } from 'next-intl/server'
import { getTranslations } from 'next-intl/server'

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ success?: string; error?: string }>
}

export default async function CalendarConnectedPage(props: Props) {
  const [{ locale }, { success, error }] = await Promise.all([props.params, props.searchParams])
  setRequestLocale(locale)
  const t = await getTranslations('calendarConnected')

  const isError = Boolean(error) && !success

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gentle-50 via-white to-primary-50 px-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        {isError ? (
          <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
        ) : (
          <CheckCircle2 className="h-12 w-12 text-primary-600 mx-auto mb-4" />
        )}
        <h1 className="text-xl font-bold text-gray-900 mb-2">
          {isError ? t('errorTitle') : t('successTitle')}
        </h1>
        <p className="text-gray-600">{isError ? t('errorMessage') : t('successMessage')}</p>
      </div>
    </div>
  )
}

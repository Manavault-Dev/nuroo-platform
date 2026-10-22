'use client'

import { useTranslations } from 'next-intl'

interface AppStoreButtonProps {
  href?: string
  className?: string
}

export function AppStoreButton({
  href = 'https://apps.apple.com/us/app/nuroo-ai/id6753772410',
  className = '',
}: AppStoreButtonProps) {
  const t = useTranslations('landing.storeButtons')

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-2.5 px-4 py-2.5 bg-black hover:bg-gray-900 text-white rounded-xl border border-gray-700 transition-all duration-200 hover:scale-105 active:scale-95 ${className}`}
      aria-label={t('appStoreAria')}
    >
      <svg
        className="w-6 h-6 flex-shrink-0"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zm-5.02-13.03c.15-2.23 1.66-4.07 3.74-4.25-.29 2.58-2.34 4.5-3.74 4.25z" />
      </svg>
      <div className="flex flex-col items-start leading-tight">
        <span className="text-[10px] leading-[1.1] tracking-tight text-gray-300">
          {t('appStorePrefix')}
        </span>
        <span className="text-base leading-[1.15] font-semibold tracking-tight">App Store</span>
      </div>
    </a>
  )
}

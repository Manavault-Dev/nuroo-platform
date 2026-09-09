'use client'

import { useState, useEffect, useRef } from 'react'
import { Link } from '@/i18n/navigation'
import { usePathname as useNextPathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import { Menu, X } from 'lucide-react'
import { clsx } from 'clsx'
import { LocaleSwitcher } from './LocaleSwitcher'

const LANDING_LINKS = {
  features: '/#features',
  howItWorks: '/#solution-section',
  forProfessionals: '/#platform-section',
  pricing: '/#pricing',
} as const

export function Header() {
  const t = useTranslations('landing.nav')
  const fullPathname = useNextPathname() ?? ''
  const pathname = fullPathname.replace(/^\/(en|ru|ky)/, '') || '/'
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const [isDownloadOpen, setIsDownloadOpen] = useState(false)
  const downloadRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (downloadRef.current && !downloadRef.current.contains(e.target as Node)) {
        setIsDownloadOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])
  // Only the marketplace listing page gets the transparent hero header, not org detail pages
  const isMarketplaceHero =
    (pathname === '/marketplace' || pathname.startsWith('/marketplace?')) && !isScrolled

  const navLinkClass = clsx(
    'transition-colors text-sm whitespace-nowrap',
    isMarketplaceHero ? 'text-white/75 hover:text-white' : 'text-gray-600 hover:text-primary-500'
  )
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10)
    }

    handleScroll()
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <header
      className={clsx(
        'fixed top-0 left-0 right-0 z-50 min-w-0 border-b transition-all duration-200',
        isScrolled
          ? 'border-gray-100 bg-white/90 shadow-sm backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/90'
          : isMarketplaceHero
            ? 'border-white/10 bg-primary-950/10 backdrop-blur-md'
            : 'border-transparent bg-transparent'
      )}
    >
      <nav className="container-custom min-w-0">
        <div className="flex items-center justify-between h-14 md:h-16 gap-2 min-w-0">
          <Link
            href="/"
            className={clsx(
              'flex items-center space-x-2 text-xl md:text-2xl font-bold flex-shrink-0 min-w-0 transition-colors',
              isMarketplaceHero ? 'text-white' : 'gradient-text'
            )}
          >
            <Image
              src="/Logo.svg"
              alt="Nuroo Logo"
              width={32}
              height={32}
              priority
              className={clsx(
                'w-6 h-6 md:w-8 md:h-8 rounded-lg transition-all',
                isMarketplaceHero && 'ring-1 ring-white/35 shadow-sm shadow-primary-950/20'
              )}
            />
            <span>Nuroo</span>
          </Link>

          <div className="hidden lg:flex items-center gap-3 xl:gap-5 flex-shrink-0">
            <Link href={LANDING_LINKS.features} className={navLinkClass}>
              {t('features')}
            </Link>
            <Link href={LANDING_LINKS.howItWorks} className={navLinkClass}>
              {t('howItWorks')}
            </Link>
            <Link href={LANDING_LINKS.forProfessionals} className={navLinkClass}>
              {t('forProfessionals')}
            </Link>
            <Link href={LANDING_LINKS.pricing} className={navLinkClass}>
              {t('pricing')}
            </Link>
            <Link
              href="/marketplace"
              prefetch={false}
              className={clsx(navLinkClass, 'font-semibold')}
            >
              {t('marketplace')}
            </Link>
            <LocaleSwitcher inverse={isMarketplaceHero} />
            <div
              className={clsx(
                'h-4 w-px',
                isMarketplaceHero ? 'bg-white/30' : 'bg-gray-200 dark:bg-gray-600'
              )}
              aria-hidden
            />
            <Link
              href="/b2b/login"
              prefetch={false}
              className={clsx(
                'text-sm font-medium transition-colors',
                isMarketplaceHero
                  ? 'text-white/80 hover:text-white'
                  : 'text-gray-700 hover:text-primary-600 dark:text-gray-300 dark:hover:text-primary-400'
              )}
            >
              {t('logIn')}
            </Link>
            <Link
              href="/b2b/register"
              prefetch={false}
              className={clsx(
                isMarketplaceHero
                  ? 'rounded-lg bg-white px-4 py-2 text-sm font-semibold text-primary-700 shadow-sm shadow-primary-950/10 transition-all duration-200 hover:bg-primary-50 hover:shadow-md'
                  : 'btn-secondary text-sm'
              )}
            >
              {t('getStarted')}
            </Link>
            <div ref={downloadRef} className="relative">
              <button
                onClick={() => setIsDownloadOpen((v) => !v)}
                className={clsx(
                  isMarketplaceHero
                    ? 'rounded-lg bg-white/20 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/25 transition-all duration-200 hover:bg-white/30'
                    : 'btn-primary text-sm'
                )}
              >
                {t('downloadApp')}
              </button>
              {isDownloadOpen && (
                <div className="absolute right-0 top-full mt-2 w-52 rounded-xl bg-white shadow-lg ring-1 ring-gray-200 z-50 overflow-hidden">
                  <a
                    href="https://apps.apple.com/us/app/nuroo-ai/id6753772410"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setIsDownloadOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zm-5.02-13.03c.15-2.23 1.66-4.07 3.74-4.25-.29 2.58-2.34 4.5-3.74 4.25z" />
                    </svg>
                    <div>
                      <p className="font-semibold leading-tight">App Store</p>
                      <p className="text-xs text-gray-400">iPhone / iPad</p>
                    </div>
                  </a>
                  <div className="h-px bg-gray-100" />
                  <a
                    href="https://play.google.com/store/apps/details?id=nuroo.app&pcampaignid=web_share"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setIsDownloadOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M3 20.5v-17c0-.59.34-1.11.84-1.35L13.69 12 3.84 21.85c-.5-.25-.84-.76-.84-1.35z"
                        fill="#4285F4"
                      />
                      <path d="M16.81 15.12L6.05 21.34l8.49-8.49 2.27 2.27z" fill="#34A853" />
                      <path
                        d="M20.16 10.81c.34.27.59.69.59 1.19 0 .5-.22.9-.57 1.18L17.89 14.5l-2.5-2.5 2.5-2.5 2.27 1.31z"
                        fill="#FBBC04"
                      />
                      <path d="M16.81 8.88L6.05 2.66l8.49 8.49 2.27-2.27z" fill="#EA4335" />
                    </svg>
                    <div>
                      <p className="font-semibold leading-tight">Google Play</p>
                      <p className="text-xs text-gray-400">Android</p>
                    </div>
                  </a>
                </div>
              )}
            </div>
          </div>

          <div className="lg:hidden flex items-center gap-2 flex-shrink-0">
            <LocaleSwitcher inverse={isMarketplaceHero} />
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className={clsx(
                'p-2 rounded-lg transition-colors',
                isMarketplaceHero
                  ? 'bg-white/20 text-white ring-1 ring-white/25 hover:bg-white/30'
                  : 'bg-gray-100 hover:bg-gray-200'
              )}
              aria-label="Toggle menu"
            >
              {isMenuOpen ? (
                <X className="h-4 w-4 md:h-5 md:w-5" />
              ) : (
                <Menu className="h-4 w-4 md:h-5 md:w-5" />
              )}
            </button>
          </div>
        </div>

        {isMenuOpen && (
          <div className="lg:hidden min-w-0">
            <div className="px-2 pt-2 pb-3 space-y-1 bg-white dark:bg-gray-800 rounded-lg mt-2 shadow-lg border border-gray-200 dark:border-gray-700 w-full max-w-full">
              <Link
                href={LANDING_LINKS.features}
                className="block px-3 py-2 text-gray-600 dark:text-gray-300 hover:text-primary-500 transition-colors text-sm font-medium"
                onClick={() => setIsMenuOpen(false)}
              >
                {t('features')}
              </Link>
              <Link
                href={LANDING_LINKS.howItWorks}
                className="block px-3 py-2 text-gray-600 dark:text-gray-300 hover:text-primary-500 transition-colors text-sm font-medium"
                onClick={() => setIsMenuOpen(false)}
              >
                {t('howItWorks')}
              </Link>
              <Link
                href={LANDING_LINKS.forProfessionals}
                className="block px-3 py-2 text-gray-600 dark:text-gray-300 hover:text-primary-500 transition-colors text-sm font-medium"
                onClick={() => setIsMenuOpen(false)}
              >
                {t('forProfessionals')}
              </Link>
              <Link
                href={LANDING_LINKS.pricing}
                className="block px-3 py-2 text-gray-600 dark:text-gray-300 hover:text-primary-500 transition-colors text-sm font-medium"
                onClick={() => setIsMenuOpen(false)}
              >
                {t('pricing')}
              </Link>
              <Link
                href="/marketplace"
                prefetch={false}
                className="block px-3 py-2 text-primary-600 dark:text-primary-400 hover:text-primary-700 transition-colors text-sm font-medium"
                onClick={() => setIsMenuOpen(false)}
              >
                {t('marketplace')}
              </Link>
              <div className="border-t border-gray-200 dark:border-gray-600 my-2 pt-2">
                <p className="px-3 py-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {t('forProfessionalsLabel')}
                </p>
                <Link
                  href="/b2b/login"
                  prefetch={false}
                  className="block px-3 py-2 text-gray-700 dark:text-gray-200 hover:text-primary-500 font-medium"
                  onClick={() => setIsMenuOpen(false)}
                >
                  {t('logIn')}
                </Link>
                <Link
                  href="/b2b/register"
                  prefetch={false}
                  className="block px-3 py-2 text-primary-600 dark:text-primary-400 hover:text-primary-700 font-medium"
                  onClick={() => setIsMenuOpen(false)}
                >
                  {t('createAccount')}
                </Link>
              </div>
              <div className="mx-3 my-2 flex flex-col gap-2">
                <a
                  href="https://apps.apple.com/us/app/nuroo-ai/id6753772410"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setIsMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-black text-white text-sm font-semibold"
                >
                  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zm-5.02-13.03c.15-2.23 1.66-4.07 3.74-4.25-.29 2.58-2.34 4.5-3.74 4.25z" />
                  </svg>
                  App Store
                </a>
                <a
                  href="https://play.google.com/store/apps/details?id=nuroo.app&pcampaignid=web_share"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setIsMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 text-sm font-semibold"
                >
                  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M3 20.5v-17c0-.59.34-1.11.84-1.35L13.69 12 3.84 21.85c-.5-.25-.84-.76-.84-1.35z"
                      fill="#4285F4"
                    />
                    <path d="M16.81 15.12L6.05 21.34l8.49-8.49 2.27 2.27z" fill="#34A853" />
                    <path
                      d="M20.16 10.81c.34.27.59.69.59 1.19 0 .5-.22.9-.57 1.18L17.89 14.5l-2.5-2.5 2.5-2.5 2.27 1.31z"
                      fill="#FBBC04"
                    />
                    <path d="M16.81 8.88L6.05 2.66l8.49 8.49 2.27-2.27z" fill="#EA4335" />
                  </svg>
                  Google Play
                </a>
              </div>
            </div>
          </div>
        )}
      </nav>
    </header>
  )
}

'use client'

import { usePathname } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import { Building2, Palette } from 'lucide-react'

interface Props {
  orgId?: string | null
}

export function OrgPageTabs({ orgId }: Props) {
  const pathname = usePathname()

  const base = orgId ? `?orgId=${orgId}` : ''
  const isOrg = pathname.includes('/b2b/organization') || !pathname.includes('/b2b/brand')
  const isBrand = pathname.includes('/b2b/brand')

  const tabs = [
    { href: `/b2b/organization${base}`, label: 'Профиль', icon: Building2, active: !isBrand },
    { href: `/b2b/brand${base}`, label: 'Брендинг', icon: Palette, active: isBrand },
  ]

  return (
    <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit mb-6">
      {tabs.map((tab) => {
        const Icon = tab.icon
        return (
          <Link
            key={tab.href}
            href={tab.href as any}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab.active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" />
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}

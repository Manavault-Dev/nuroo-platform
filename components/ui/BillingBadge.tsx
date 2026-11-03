'use client'

import { Clock, CheckCircle, AlertTriangle, XCircle, CreditCard, ShieldOff } from 'lucide-react'
import { useTranslations } from 'next-intl'

export type BillingBadgeKey =
  | 'freeTrial'
  | 'active'
  | 'pastDue'
  | 'expired'
  | 'cancelled'
  | 'suspended'

interface Props {
  badge: BillingBadgeKey
  trialEndsAt?: string | null
  size?: 'sm' | 'md'
  className?: string
}

function daysUntil(dateStr: string): number | null {
  const time = new Date(dateStr).getTime()
  if (Number.isNaN(time)) return null

  const diff = time - Date.now()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

const CONFIG: Record<BillingBadgeKey, { icon: typeof Clock; colors: string }> = {
  freeTrial: {
    icon: Clock,
    colors: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  active: {
    icon: CheckCircle,
    colors: 'bg-green-50 text-green-700 border-green-200',
  },
  pastDue: {
    icon: CreditCard,
    colors: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  expired: {
    icon: XCircle,
    colors: 'bg-red-50 text-red-700 border-red-200',
  },
  cancelled: {
    icon: AlertTriangle,
    colors: 'bg-gray-50 text-gray-600 border-gray-200',
  },
  suspended: {
    icon: ShieldOff,
    colors: 'bg-red-50 text-red-700 border-red-200',
  },
}

export function BillingBadge({ badge, trialEndsAt, size = 'md', className = '' }: Props) {
  const t = useTranslations('b2b.pages.billing.billingBadge')
  const badgeKey: BillingBadgeKey = CONFIG[badge] ? badge : 'expired'
  const { icon: Icon, colors } = CONFIG[badgeKey]
  const days = badge === 'freeTrial' && trialEndsAt ? daysUntil(trialEndsAt) : null
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'
  const textSize = size === 'sm' ? 'text-xs' : 'text-xs font-medium'

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${colors} ${textSize} ${className}`}
    >
      <Icon className={iconSize} />
      {t(badgeKey)}
      {days !== null && <span className="font-semibold">· {t('daysLeft', { days })}</span>}
    </span>
  )
}

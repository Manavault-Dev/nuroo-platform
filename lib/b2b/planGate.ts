/**
 * Feature gating for Nuroo vs Nuroo Business.
 *
 * Usage:
 *   const { can, isBusiness, plan } = usePlanGate()
 *   if (!can('team_management')) return <UpgradeScreen feature="team_management" />
 *
 * Architecture:
 *   - Thin adapter over the real plan model in planContext.tsx (usePlan()),
 *     which is fed by the org's actual billing/subscription status
 *     (starter/growth/enterprise — see backend/src/domains/payments/planLimits.ts).
 *   - 'nuroo' / 'nuroo_business' below are just this module's own display
 *     labels for "starter" vs "growth or above" — they are NOT read from
 *     Firestore org.nurooPlan anymore. That field is the old, unenforced
 *     binary model and is no longer the source of truth for any org.
 *   - can(feature) maps each product-facing BusinessFeature to the real
 *     GatedFeature key and asks usePlan().hasFeature() — so a 'growth' org
 *     correctly unlocks reports/attendance/team management etc. while still
 *     being locked out of 'enterprise'-only features like branches/finance.
 */

import { usePlan } from './planContext'
import type { GatedFeature } from '@/lib/pricing/planFeatureConfig'

export type NurooPlan = 'nuroo' | 'nuroo_business'
export type MemberRole = 'independent_specialist' | 'org_admin' | 'org_specialist'

/** Features locked to Nuroo Business */
export const BUSINESS_ONLY_FEATURES = [
  'team_management',
  'org_children',
  'team_schedule',
  'attendance',
  'assignments_progress',
  'org_finance',
  'reports',
  'analytics',
  'branches',
  'advanced_crm',
] as const

export type BusinessFeature = (typeof BUSINESS_ONLY_FEATURES)[number]

/** Human-readable labels for upgrade screens */
export const FEATURE_LABELS: Record<BusinessFeature, { title: string; description: string }> = {
  team_management: {
    title: 'Управление командой',
    description: 'Добавляйте специалистов, управляйте ролями и расписанием всей команды.',
  },
  org_children: {
    title: 'Клиенты организации',
    description: 'Единая база детей и клиентов на уровне всей организации с историей.',
  },
  team_schedule: {
    title: 'Расписание команды',
    description: 'Видьте расписание всех специалистов в одном месте и управляйте нагрузкой.',
  },
  attendance: {
    title: 'Посещаемость',
    description: 'Отмечайте посещаемость занятий и отслеживайте пропуски.',
  },
  assignments_progress: {
    title: 'Задания и прогресс',
    description: 'Давайте домашние задания и отслеживайте прогресс каждого ребёнка.',
  },
  org_finance: {
    title: 'Финансы организации',
    description: 'Учёт доходов, расходов и задолженностей клиентов на уровне организации.',
  },
  reports: {
    title: 'Отчёты',
    description: 'Готовые отчёты по занятиям, оплатам и клиентской базе.',
  },
  analytics: {
    title: 'Аналитика',
    description: 'Дашборд с ключевыми метриками вашей организации.',
  },
  branches: {
    title: 'Несколько филиалов',
    description: 'Управляйте несколькими локациями в одном аккаунте.',
  },
  advanced_crm: {
    title: 'Расширенный CRM',
    description: 'Теги, заметки, история коммуникаций и воронки для работы с клиентами.',
  },
}

/** Maps each product-facing feature key to the real backend GatedFeature key. */
const FEATURE_MAP: Record<BusinessFeature, GatedFeature> = {
  team_management: 'teamManagement',
  org_children: 'orgChildren',
  team_schedule: 'teamSchedule',
  attendance: 'attendance',
  assignments_progress: 'assignmentsProgress',
  org_finance: 'finance',
  reports: 'reports',
  analytics: 'advancedAnalytics',
  branches: 'branches',
  advanced_crm: 'crm',
}

export function usePlanGate(): {
  plan: NurooPlan
  isBusiness: boolean
  isNuroo: boolean
  can: (feature: BusinessFeature) => boolean
} {
  const { planId, planIsLoading, hasFeature } = usePlan()
  // Optimistic while loading, matching usePlan()'s own default — avoids a
  // flash where business nav items disappear then reappear once billing
  // status has loaded.
  const isBusiness = planIsLoading ? true : planId !== 'starter'

  return {
    plan: isBusiness ? 'nuroo_business' : 'nuroo',
    isBusiness,
    isNuroo: !isBusiness,
    can: (feature: BusinessFeature) => hasFeature(FEATURE_MAP[feature]),
  }
}

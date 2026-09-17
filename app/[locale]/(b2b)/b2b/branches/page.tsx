'use client'

import { useEffect, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { usePageAuth } from '@/lib/b2b/usePageAuth'
import { apiClient, type Branch } from '@/lib/b2b/api'
import { PageSpinner } from '@/components/ui/Spinner'
import { useAlert } from '@/components/ui/AlertDialog'
import {
  GitBranch,
  Plus,
  Edit2,
  Trash2,
  X,
  Save,
  Loader2,
  MapPin,
  Phone,
  User,
  UserPlus,
  BookOpen,
  Wallet,
  AlertCircle,
  Users,
} from 'lucide-react'
import { PlanGate } from '@/components/b2b/PlanGate'

interface BranchStats {
  leads: number
  conversionRate: number
  activePrograms: number
  revenueThisMonth: number
  unpaidCount: number
  unpaidAmount: number
  teamCount: number
}

interface BranchForm {
  name: string
  address: string
  phone: string
  contactPerson: string
  description: string
  photoUrl: string
}

const EMPTY_FORM: BranchForm = {
  name: '',
  address: '',
  phone: '',
  contactPerson: '',
  description: '',
  photoUrl: '',
}

export default function BranchesPage() {
  const t = useTranslations('b2b.pages.branches')
  const { orgId, isAdmin, isLoading } = usePageAuth()

  const [branches, setBranches] = useState<Branch[]>([])
  const [stats, setStats] = useState<Record<string, BranchStats>>({})
  const [totals, setTotals] = useState<{
    revenueThisMonth: number
    unpaidCount: number
    unpaidAmount: number
    teamCount: number
  } | null>(null)
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [error, setError] = useState('')
  const { confirm } = useAlert()

  const [showModal, setShowModal] = useState(false)
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null)
  const [form, setForm] = useState<BranchForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const loadBranches = useCallback(
    async (oid: string) => {
      setLoadingBranches(true)
      setError('')
      try {
        const res = await apiClient.getBranches(oid)
        setBranches(res.branches ?? [])
      } catch (err) {
        setError(err instanceof Error ? err.message : t('loadError'))
      } finally {
        setLoadingBranches(false)
      }
    },
    [t]
  )

  useEffect(() => {
    if (orgId) loadBranches(orgId)
  }, [orgId, loadBranches])

  // Quick per-branch overview: leads + conversion (CRM), active programs (courses),
  // revenue/unpaid invoices and team size (enterprise dashboard).
  // Best-effort — silently skipped if the org doesn't have those features enabled.
  useEffect(() => {
    if (!orgId || branches.length === 0) return
    Promise.all([
      apiClient.getLeadsAnalytics(orgId).catch(() => null),
      apiClient.getCohorts(orgId).catch(() => null),
      apiClient.getBranchStats(orgId).catch(() => null),
    ]).then(([analytics, cohortsRes, branchStats]) => {
      const next: Record<string, BranchStats> = {}
      for (const b of branches) {
        const branchAnalytics = analytics?.byBranch.find((s) => s.branchId === b.id)
        const activePrograms = (cohortsRes?.cohorts ?? []).filter(
          (c: any) => c.branchId === b.id && ['open', 'full', 'in_progress'].includes(c.status)
        ).length
        const financeStats = branchStats?.stats.find((s) => s.branchId === b.id)
        next[b.id] = {
          leads: branchAnalytics?.total ?? 0,
          conversionRate: branchAnalytics?.conversionRate ?? 0,
          activePrograms,
          revenueThisMonth: financeStats?.revenueThisMonth ?? 0,
          unpaidCount: financeStats?.unpaidCount ?? 0,
          unpaidAmount: financeStats?.unpaidAmount ?? 0,
          teamCount: financeStats?.teamCount ?? 0,
        }
      }
      setStats(next)
      setTotals(branchStats?.totals ?? null)
    })
  }, [orgId, branches])

  const openCreate = () => {
    setEditingBranch(null)
    setForm(EMPTY_FORM)
    setShowModal(true)
  }

  const openEdit = (branch: Branch) => {
    setEditingBranch(branch)
    setForm({
      name: branch.name,
      address: branch.address ?? '',
      phone: branch.phone ?? '',
      contactPerson: branch.contactPerson ?? '',
      description: branch.description ?? '',
      photoUrl: branch.photoUrl ?? '',
    })
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingBranch(null)
    setForm(EMPTY_FORM)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!orgId || !form.name.trim()) return
    setSaving(true)
    try {
      const data = {
        name: form.name.trim(),
        address: form.address.trim() || undefined,
        phone: form.phone.trim() || undefined,
        contactPerson: form.contactPerson.trim() || undefined,
        description: form.description.trim() || undefined,
        photoUrl: form.photoUrl.trim() || undefined,
      }
      if (editingBranch) {
        await apiClient.updateBranch(orgId, editingBranch.id, data)
      } else {
        await apiClient.createBranch(orgId, data)
      }
      await loadBranches(orgId)
      closeModal()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (branchId: string) => {
    if (!orgId) return
    const ok = await confirm(t('deleteConfirm'))
    if (!ok) return
    try {
      await apiClient.deleteBranch(orgId, branchId)
      await loadBranches(orgId)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('deleteError'))
    }
  }

  if (isLoading || loadingBranches) return <PageSpinner />

  return (
    <PlanGate feature="branches">
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <GitBranch className="w-7 h-7 text-primary-600" />
              {t('title')}
            </h1>
            <p className="text-sm text-gray-500 mt-1">{t('subtitle')}</p>
          </div>
          {isAdmin && (
            <button
              onClick={openCreate}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              {t('addBranch')}
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* HQ summary — enterprise dashboard totals across all branches */}
        {totals && branches.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-gray-500 text-xs font-medium mb-1.5">
                <Wallet className="w-4 h-4 text-primary-500" />
                Выручка за месяц
              </div>
              <p className="text-xl font-bold text-gray-900">
                {totals.revenueThisMonth.toLocaleString('ru-RU')} KGS
              </p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-gray-500 text-xs font-medium mb-1.5">
                <AlertCircle className="w-4 h-4 text-amber-500" />
                Неоплаченные счета
              </div>
              <p className="text-xl font-bold text-gray-900">
                {totals.unpaidCount}{' '}
                <span className="text-sm font-medium text-gray-400">
                  ({totals.unpaidAmount.toLocaleString('ru-RU')} KGS)
                </span>
              </p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-gray-500 text-xs font-medium mb-1.5">
                <Users className="w-4 h-4 text-teal-500" />
                Сотрудников в филиалах
              </div>
              <p className="text-xl font-bold text-gray-900">{totals.teamCount}</p>
            </div>
          </div>
        )}

        {/* Empty state */}
        {branches.length === 0 ? (
          <div className="bg-gray-50 rounded-xl p-16 text-center">
            <GitBranch className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 mb-4">{t('noBranches')}</p>
            {isAdmin && (
              <button
                onClick={openCreate}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                {t('addBranch')}
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {branches.map((branch) => (
              <div
                key={branch.id}
                className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
                      <GitBranch className="w-5 h-5 text-primary-600" />
                    </div>
                    <h3 className="font-semibold text-gray-900 truncate">{branch.name}</h3>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1 shrink-0 ml-2">
                      <button
                        onClick={() => openEdit(branch)}
                        className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(branch.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {branch.description && (
                  <p className="text-sm text-gray-500 mb-3 line-clamp-2">{branch.description}</p>
                )}

                <div className="space-y-1.5 text-sm text-gray-600">
                  {branch.address && (
                    <div className="flex items-start gap-2">
                      <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" />
                      <span>{branch.address}</span>
                    </div>
                  )}
                  {branch.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 shrink-0 text-gray-400" />
                      <span>{branch.phone}</span>
                    </div>
                  )}
                  {branch.contactPerson && (
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 shrink-0 text-gray-400" />
                      <span>{branch.contactPerson}</span>
                    </div>
                  )}
                </div>

                {stats[branch.id] && (
                  <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-gray-100">
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <UserPlus className="w-3.5 h-3.5 text-primary-400 shrink-0" />
                      <span>
                        {stats[branch.id].leads} заявок · {stats[branch.id].conversionRate}%
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <BookOpen className="w-3.5 h-3.5 text-primary-400 shrink-0" />
                      <span>{stats[branch.id].activePrograms} активных программ</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <Wallet className="w-3.5 h-3.5 text-primary-400 shrink-0" />
                      <span>{stats[branch.id].revenueThisMonth.toLocaleString('ru-RU')} KGS</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>{stats[branch.id].unpaidCount} неоплачено</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 col-span-2">
                      <Users className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                      <span>{stats[branch.id].teamCount} сотрудников</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add / Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
              <div className="flex items-center justify-between p-6 border-b border-gray-100">
                <h2 className="text-lg font-semibold text-gray-900">
                  {editingBranch ? t('editBranch') : t('addBranch')}
                </h2>
                <button
                  onClick={closeModal}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                {(
                  [
                    { id: 'name', label: t('name'), required: true },
                    { id: 'address', label: t('address'), required: false },
                    { id: 'phone', label: t('phone'), required: false },
                    { id: 'contactPerson', label: t('contactPerson'), required: false },
                  ] as const
                ).map(({ id, label, required }) => (
                  <div key={id}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {label}
                      {required && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    <input
                      type="text"
                      required={required}
                      value={form[id]}
                      onChange={(e) => setForm((f) => ({ ...f, [id]: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                      placeholder={label}
                    />
                  </div>
                ))}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('description')}
                  </label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    rows={3}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
                    placeholder={t('description')}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('photoUrl')}
                  </label>
                  <input
                    type="text"
                    value={form.photoUrl}
                    onChange={(e) => setForm((f) => ({ ...f, photoUrl: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                    placeholder="https://..."
                  />
                </div>

                {error && <p className="text-sm text-red-600">{error}</p>}

                <div className="flex gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={saving || !form.name.trim()}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                  >
                    {saving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {t('save')}
                  </button>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
                  >
                    {t('cancel')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </PlanGate>
  )
}

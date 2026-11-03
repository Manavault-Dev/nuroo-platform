'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { usePageAuth } from '@/lib/b2b/usePageAuth'
import {
  apiClient,
  type Branch,
  type Lead,
  type LeadBranchStat,
  type LeadStatus,
} from '@/lib/b2b/api'
import { PageSpinner } from '@/components/ui/Spinner'
import { useAlert } from '@/components/ui/AlertDialog'
import { PlanGate } from '@/components/b2b/PlanGate'
import {
  UserPlus,
  Phone,
  Mail,
  GitBranch,
  X,
  Save,
  Loader2,
  Plus,
  TrendingUp,
  Users,
  Trash2,
} from 'lucide-react'

type LeadsT = (key: string, values?: Record<string, string | number>) => string

const STATUS_COLUMN_IDS: { id: LeadStatus; accent: string }[] = [
  { id: 'new', accent: 'bg-blue-500' },
  { id: 'contacted', accent: 'bg-amber-500' },
  { id: 'trial_booked', accent: 'bg-purple-500' },
  { id: 'active_client', accent: 'bg-green-500' },
  { id: 'lost', accent: 'bg-gray-400' },
]

const KNOWN_SOURCES = ['marketplace', 'manual', 'referral']

function formatShortDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

function LeadCard({
  lead,
  branchName,
  isDragging,
  draggable,
  onDragStart,
  onDragEnd,
  onClick,
  t,
}: {
  lead: Lead
  branchName: string | null
  isDragging: boolean
  draggable: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onClick: () => void
  t: LeadsT
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={`bg-white border border-gray-200 rounded-lg p-3 shadow-sm hover:shadow-md hover:border-primary-300 transition-all cursor-pointer ${
        draggable ? 'active:cursor-grabbing' : ''
      } ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="font-medium text-sm text-gray-900 truncate">{lead.parentName}</p>
        <span className="text-[10px] text-gray-400 shrink-0">
          {formatShortDate(lead.createdAt)}
        </span>
      </div>
      {lead.childName && (
        <p className="text-xs text-gray-500 mb-1">
          {t('childPrefix')}: {lead.childName}
        </p>
      )}
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
        <Phone className="w-3 h-3 shrink-0" /> {lead.phone}
      </div>
      {lead.programInterest && (
        <p className="text-xs text-gray-500 truncate mb-1.5">{lead.programInterest}</p>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        {branchName && (
          <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded-full inline-flex items-center gap-1">
            <GitBranch className="w-2.5 h-2.5" /> {branchName}
          </span>
        )}
        <span className="text-[10px] px-1.5 py-0.5 bg-primary-50 text-primary-600 rounded-full">
          {KNOWN_SOURCES.includes(lead.source) ? t(`sources.${lead.source}`) : lead.source}
        </span>
      </div>
    </div>
  )
}

function LeadModal({
  lead,
  branches,
  onSave,
  onDelete,
  onClose,
  t,
}: {
  lead: Lead
  branches: Branch[]
  onSave: (
    leadId: string,
    data: { status: LeadStatus; branchId: string | null; notes: string | null }
  ) => Promise<void>
  onDelete: (leadId: string) => Promise<void>
  onClose: () => void
  t: LeadsT
}) {
  const [status, setStatus] = useState<LeadStatus>(lead.status)
  const [branchId, setBranchId] = useState(lead.branchId ?? '')
  const [notes, setNotes] = useState(lead.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(lead.id, { status, branchId: branchId || null, notes: notes.trim() || null })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await onDelete(lead.id)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{lead.parentName}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-1.5 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <Phone className="w-3.5 h-3.5 text-gray-400" />
              <a href={`tel:${lead.phone}`} className="hover:text-primary-600">
                {lead.phone}
              </a>
            </div>
            {lead.email && (
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-gray-400" />
                <a href={`mailto:${lead.email}`} className="hover:text-primary-600">
                  {lead.email}
                </a>
              </div>
            )}
            {lead.childName && (
              <p>
                {t('childPrefix')}: {lead.childName}
              </p>
            )}
            {lead.programInterest && (
              <p>
                {t('interestedPrefix')}: {lead.programInterest}
              </p>
            )}
            {lead.message && <p className="italic text-gray-500">«{lead.message}»</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('modal.statusLabel')}
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as LeadStatus)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            >
              {STATUS_COLUMN_IDS.map((c) => (
                <option key={c.id} value={c.id}>
                  {t(`statuses.${c.id}`)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('modal.branchLabel')}
            </label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            >
              <option value="">{t('noBranch')}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('modal.notesLabel')}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
            />
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t border-gray-100">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-60 transition-colors"
          >
            {deleting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {t('modal.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t('modal.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

function NewLeadModal({
  branches,
  onSave,
  onClose,
  t,
}: {
  branches: Branch[]
  onSave: (data: {
    branchId?: string
    parentName: string
    phone: string
    email?: string
    childName?: string
    programInterest?: string
    notes?: string
  }) => Promise<void>
  onClose: () => void
  t: LeadsT
}) {
  const [form, setForm] = useState({
    branchId: '',
    parentName: '',
    phone: '',
    email: '',
    childName: '',
    programInterest: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((p) => ({ ...p, [key]: e.target.value }))

  const handleSave = async () => {
    if (!form.parentName.trim() || !form.phone.trim()) {
      setError(t('newLead.errorRequired'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        branchId: form.branchId || undefined,
        parentName: form.parentName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        childName: form.childName.trim() || undefined,
        programInterest: form.programInterest.trim() || undefined,
        notes: form.notes.trim() || undefined,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('newLead.errorCreateFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{t('newLead.title')}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('newLead.parentNameLabel')}
            </label>
            <input
              value={form.parentName}
              onChange={set('parentName')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('newLead.phoneLabel')}
            </label>
            <input
              value={form.phone}
              onChange={set('phone')}
              placeholder={t('newLead.phonePlaceholder')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('newLead.emailLabel')}
            </label>
            <input
              value={form.email}
              onChange={set('email')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('newLead.childLabel')}
            </label>
            <input
              value={form.childName}
              onChange={set('childName')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>
          {branches.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('newLead.branchLabel')}
              </label>
              <select
                value={form.branchId}
                onChange={set('branchId')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              >
                <option value="">{t('noBranch')}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('newLead.programInterestLabel')}
            </label>
            <input
              value={form.programInterest}
              onChange={set('programInterest')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('newLead.notesLabel')}
            </label>
            <textarea
              value={form.notes}
              onChange={set('notes')}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
            />
          </div>
          {error && <p className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="flex gap-3 p-5 border-t border-gray-100">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {t('newLead.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t('newLead.create')}
          </button>
        </div>
      </div>
    </div>
  )
}

function LeadsBoard() {
  const t = useTranslations('b2b.pages.leads') as LeadsT
  const { orgId, isAdmin, isLoading } = usePageAuth()
  const { alert } = useAlert()

  const [leads, setLeads] = useState<Lead[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [analytics, setAnalytics] = useState<{
    total: number
    conversionRate: number
    byBranch: LeadBranchStat[]
  } | null>(null)
  const [branchFilter, setBranchFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [newLeadOpen, setNewLeadOpen] = useState(false)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)

  const dragLeadId = useRef<string | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<LeadStatus | null>(null)

  const load = useCallback(
    async (oid: string) => {
      setLoading(true)
      try {
        const [leadsRes, branchesRes, analyticsRes] = await Promise.all([
          apiClient.getLeads(oid, branchFilter ? { branchId: branchFilter } : undefined),
          apiClient.getBranches(oid).catch(() => ({ branches: [] as Branch[] })),
          apiClient.getLeadsAnalytics(oid).catch(() => null),
        ])
        setLeads(leadsRes.leads ?? [])
        setBranches(branchesRes.branches ?? [])
        if (analyticsRes) {
          setAnalytics({
            total: analyticsRes.total,
            conversionRate: analyticsRes.conversionRate,
            byBranch: analyticsRes.byBranch,
          })
        }
      } catch (err) {
        alert(err instanceof Error ? err.message : t('loadFailed'), { type: 'error' })
      } finally {
        setLoading(false)
      }
    },
    [branchFilter, alert, t]
  )

  useEffect(() => {
    if (orgId) load(orgId)
  }, [orgId, load])

  const branchName = (branchId: string | null) =>
    branches.find((b) => b.id === branchId)?.name ?? null

  const handleStatusChange = async (leadId: string, status: LeadStatus) => {
    if (!orgId) return
    const prev = leads
    setLeads((p) => p.map((l) => (l.id === leadId ? { ...l, status } : l)))
    try {
      await apiClient.updateLead(orgId, leadId, { status })
      apiClient.getLeadsAnalytics(orgId).then((res) =>
        setAnalytics({
          total: res.total,
          conversionRate: res.conversionRate,
          byBranch: res.byBranch,
        })
      )
    } catch (err) {
      setLeads(prev)
      alert(err instanceof Error ? err.message : t('statusChangeFailed'), { type: 'error' })
    }
  }

  const handleDrop = (status: LeadStatus) => {
    const leadId = dragLeadId.current
    dragLeadId.current = null
    setDragOverStatus(null)
    if (!leadId) return
    const lead = leads.find((l) => l.id === leadId)
    if (!lead || lead.status === status) return
    handleStatusChange(leadId, status)
  }

  const handleSaveLead = async (
    leadId: string,
    data: { status: LeadStatus; branchId: string | null; notes: string | null }
  ) => {
    if (!orgId) return
    await apiClient.updateLead(orgId, leadId, data)
    setLeads((p) => p.map((l) => (l.id === leadId ? { ...l, ...data } : l)))
    setSelectedLead(null)
    load(orgId)
  }

  const handleDeleteLead = async (leadId: string) => {
    if (!orgId) return
    await apiClient.deleteLead(orgId, leadId)
    setLeads((p) => p.filter((l) => l.id !== leadId))
    setSelectedLead(null)
    apiClient
      .getLeadsAnalytics(orgId)
      .then((res) =>
        setAnalytics({
          total: res.total,
          conversionRate: res.conversionRate,
          byBranch: res.byBranch,
        })
      )
      .catch(() => undefined)
  }

  const handleCreateLead = async (data: {
    branchId?: string
    parentName: string
    phone: string
    email?: string
    childName?: string
    programInterest?: string
    notes?: string
  }) => {
    if (!orgId) return
    await apiClient.createLead(orgId, data)
    setNewLeadOpen(false)
    load(orgId)
  }

  if (isLoading || loading) return <PageSpinner />

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <UserPlus className="w-7 h-7 text-primary-600" />
            {t('title')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{t('subtitle')}</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setNewLeadOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> {t('addLead')}
          </button>
        )}
      </div>

      {/* Analytics strip */}
      {analytics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
              <Users className="w-3.5 h-3.5" /> {t('totalLeads')}
            </div>
            <p className="text-xl font-bold text-gray-900">{analytics.total}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
              <TrendingUp className="w-3.5 h-3.5" /> {t('conversionRate')}
            </div>
            <p className="text-xl font-bold text-gray-900">{analytics.conversionRate}%</p>
          </div>
          {analytics.byBranch.slice(0, 2).map((b) => (
            <div
              key={b.branchId ?? '__none__'}
              className="bg-white border border-gray-200 rounded-xl p-4"
            >
              <div className="flex items-center gap-2 text-gray-400 text-xs mb-1 truncate">
                <GitBranch className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{b.branchName}</span>
              </div>
              <p className="text-xl font-bold text-gray-900">
                {b.total}{' '}
                <span className="text-xs font-normal text-gray-400">· {b.conversionRate}%</span>
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Branch filter */}
      {branches.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm text-gray-500">{t('branchLabel')}</span>
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          >
            <option value="">{t('allBranches')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Kanban board */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {STATUS_COLUMN_IDS.map((col) => {
          const colLeads = leads.filter((l) => l.status === col.id)
          return (
            <div
              key={col.id}
              onDragOver={(e) => {
                if (!dragLeadId.current) return
                e.preventDefault()
                if (dragOverStatus !== col.id) setDragOverStatus(col.id)
              }}
              onDrop={(e) => {
                e.preventDefault()
                handleDrop(col.id)
              }}
              className={`rounded-xl p-3 bg-gray-50 border-2 border-dashed min-h-[200px] transition-colors ${
                dragOverStatus === col.id
                  ? 'border-primary-400 bg-primary-50/50'
                  : 'border-transparent'
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-2 h-2 rounded-full ${col.accent}`} />
                <h3 className="text-sm font-semibold text-gray-700">{t(`statuses.${col.id}`)}</h3>
                <span className="text-xs text-gray-400 ml-auto">{colLeads.length}</span>
              </div>
              <div className="space-y-2">
                {colLeads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    branchName={branchName(lead.branchId)}
                    isDragging={dragLeadId.current === lead.id}
                    draggable={isAdmin}
                    onDragStart={() => {
                      dragLeadId.current = lead.id
                    }}
                    onDragEnd={() => {
                      dragLeadId.current = null
                      setDragOverStatus(null)
                    }}
                    onClick={() => setSelectedLead(lead)}
                    t={t}
                  />
                ))}
                {colLeads.length === 0 && (
                  <p className="text-xs text-gray-300 text-center py-6">{t('empty')}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {newLeadOpen && (
        <NewLeadModal
          branches={branches}
          onSave={handleCreateLead}
          onClose={() => setNewLeadOpen(false)}
          t={t}
        />
      )}
      {selectedLead && (
        <LeadModal
          lead={selectedLead}
          branches={branches}
          onSave={handleSaveLead}
          onDelete={handleDeleteLead}
          onClose={() => setSelectedLead(null)}
          t={t}
        />
      )}
    </div>
  )
}

export default function LeadsPage() {
  return (
    <PlanGate feature="advanced_crm">
      <LeadsBoard />
    </PlanGate>
  )
}

'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { X, Upload, Loader2, Check, AlertCircle, Download, Copy } from 'lucide-react'
import { apiClient, type ImportChildRow, type ImportChildRowData } from '@/lib/b2b/api'
import { useAlert } from '@/components/ui/AlertDialog'

interface CreatedRow {
  row: number
  childId: string
  childName: string
  token: string
  link: string
}

interface ChildrenImportModalProps {
  isOpen: boolean
  onClose: () => void
  orgId: string
  onImported: (created: CreatedRow[]) => void
}

type Step = 'pick' | 'preview' | 'results'

export function ChildrenImportModal({
  isOpen,
  onClose,
  orgId,
  onImported,
}: ChildrenImportModalProps) {
  const t = useTranslations('b2b.pages.invites.childImport')
  const { alert } = useAlert()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('pick')
  const [loading, setLoading] = useState(false)
  const [previewRows, setPreviewRows] = useState<ImportChildRow[]>([])
  const [planError, setPlanError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedRow[]>([])
  const [skipped, setSkipped] = useState<{ row: number; error: string }[]>([])

  if (!isOpen) return null

  const reset = () => {
    setStep('pick')
    setPreviewRows([])
    setPlanError(null)
    setCreated([])
    setSkipped([])
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    try {
      const res = await apiClient.importChildrenPreview(orgId, file)
      setPreviewRows(res.rows)
      setPlanError(res.planOk ? null : (res.planError ?? t('planLimitGeneric')))
      setStep('preview')
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : t('previewFailed'), { type: 'error' })
    } finally {
      setLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const validRows = previewRows.filter((r) => r.valid)

  const handleConfirm = async () => {
    if (validRows.length === 0) return
    setLoading(true)
    try {
      const rows: ImportChildRowData[] = validRows.map((r) => r.data)
      const res = await apiClient.importChildrenCommit(orgId, rows)
      setCreated(res.created)
      setSkipped(res.skipped)
      setStep('results')
      onImported(res.created)
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : t('commitFailed'), { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadLinks = () => {
    const header = 'Имя ребёнка,Ссылка\n'
    const rows = created.map((c) => `"${c.childName.replace(/"/g, '""')}",${c.link}`).join('\n')
    const blob = new Blob(['﻿' + header + rows], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'invite-links.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCopyAll = async () => {
    const text = created.map((c) => `${c.childName}: ${c.link}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* clipboard not available — download button still works */
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900">{t('title')}</h3>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 'pick' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">{t('instructions')}</p>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-gray-600 space-y-1">
                <p className="font-semibold text-gray-700">{t('columnsTitle')}</p>
                <p>{t('columnRequired')}</p>
                <p>{t('columnsOptional')}</p>
              </div>
              <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-10 cursor-pointer hover:border-primary-400 hover:bg-primary-50/40 transition-colors">
                {loading ? (
                  <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
                ) : (
                  <Upload className="w-6 h-6 text-gray-400" />
                )}
                <span className="text-sm font-medium text-gray-700">{t('chooseFile')}</span>
                <span className="text-xs text-gray-400">.xlsx, .xls, .csv</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  disabled={loading}
                  onChange={handleFileChange}
                />
              </label>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1.5 text-green-700 font-semibold">
                  <Check className="w-4 h-4" />
                  {t('validCount', { count: validRows.length })}
                </span>
                {previewRows.length - validRows.length > 0 && (
                  <span className="flex items-center gap-1.5 text-amber-700 font-semibold">
                    <AlertCircle className="w-4 h-4" />
                    {t('invalidCount', { count: previewRows.length - validRows.length })}
                  </span>
                )}
              </div>

              {planError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                  {planError}
                </div>
              )}

              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">{t('colRow')}</th>
                      <th className="text-left px-3 py-2 font-medium">{t('colName')}</th>
                      <th className="text-left px-3 py-2 font-medium">{t('colStatus')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {previewRows.map((r) => (
                      <tr key={r.row} className={r.valid ? '' : 'bg-red-50/50'}>
                        <td className="px-3 py-2 text-gray-400">{r.row}</td>
                        <td className="px-3 py-2 text-gray-800">
                          {[r.data.firstName, r.data.lastName].filter(Boolean).join(' ') || '—'}
                        </td>
                        <td className="px-3 py-2">
                          {r.valid ? (
                            <span className="text-green-700 inline-flex items-center gap-1">
                              <Check className="w-3.5 h-3.5" /> {t('ok')}
                            </span>
                          ) : (
                            <span className="text-red-600">{r.error}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 'results' && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1.5 text-green-700 font-semibold">
                  <Check className="w-4 h-4" />
                  {t('createdCount', { count: created.length })}
                </span>
                {skipped.length > 0 && (
                  <span className="flex items-center gap-1.5 text-amber-700 font-semibold">
                    <AlertCircle className="w-4 h-4" />
                    {t('skippedCount', { count: skipped.length })}
                  </span>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleDownloadLinks}
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-primary-50 text-primary-700 rounded-lg hover:bg-primary-100"
                >
                  <Download className="w-4 h-4" /> {t('downloadLinks')}
                </button>
                <button
                  onClick={handleCopyAll}
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >
                  <Copy className="w-4 h-4" /> {t('copyAll')}
                </button>
              </div>

              <div className="border border-gray-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {created.map((c) => (
                      <tr key={c.childId}>
                        <td className="px-3 py-2 text-gray-800 whitespace-nowrap">{c.childName}</td>
                        <td className="px-3 py-2 text-primary-600 truncate max-w-[260px]">
                          {c.link}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          {step === 'preview' && (
            <>
              <button
                onClick={reset}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-lg"
              >
                {t('back')}
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading || validRows.length === 0 || !!planError}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('confirmImport', { count: validRows.length })}
              </button>
            </>
          )}
          {step === 'results' && (
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm font-semibold bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              {t('done')}
            </button>
          )}
          {step === 'pick' && (
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-lg"
            >
              {t('cancel')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

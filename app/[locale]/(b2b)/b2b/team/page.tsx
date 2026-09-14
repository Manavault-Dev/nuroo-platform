'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { usePageAuth } from '@/lib/b2b/usePageAuth'
import { apiClient } from '@/lib/b2b/api'
import {
  Users,
  UserCog,
  Mail,
  Crown,
  Shield,
  UserPlus,
  Trash2,
  Loader2,
  Pencil,
  Check,
  X,
} from 'lucide-react'
import { PageSpinner } from '@/components/ui/Spinner'
import { useAlert } from '@/components/ui/AlertDialog'
import { PlanGate } from '@/components/b2b/PlanGate'

interface TeamMember {
  uid: string
  email: string
  name: string
  orgDisplayName: string | null
  role: 'admin' | 'specialist'
  joinedAt: Date | string
}

function EditableName({
  member,
  onSave,
  t,
}: {
  member: TeamMember
  onSave: (uid: string, name: string | null) => Promise<void>
  t: ReturnType<typeof useTranslations<'b2b.pages.team'>>
}) {
  const displayName = member.orgDisplayName || member.name
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(member.orgDisplayName ?? member.name ?? '')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleEdit = () => {
    setValue(member.orgDisplayName ?? member.name ?? '')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const handleCancel = () => {
    setEditing(false)
  }

  const handleSave = async () => {
    const trimmed = value.trim()
    // If same as real name — clear orgDisplayName (reset to default)
    const newVal = trimmed === member.name ? null : trimmed || null
    setSaving(true)
    try {
      await onSave(member.uid, newVal)
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave()
            if (e.key === 'Escape') handleCancel()
          }}
          className="border border-primary-300 rounded-lg px-2 py-1 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-400 w-48"
          placeholder={member.name}
          disabled={saving}
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="p-1 text-green-600 hover:bg-green-50 rounded-md disabled:opacity-50"
          aria-label={t('saveDisplayName')}
          title={t('saveDisplayName')}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={saving}
          className="p-1 text-gray-400 hover:bg-gray-100 rounded-md"
          aria-label={t('cancelEditDisplayName')}
          title={t('cancelEditDisplayName')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap group">
      <p className="font-medium text-gray-900">
        {displayName && displayName.trim() ? (
          displayName
        ) : (
          <span className="text-amber-600 italic">{t('unnamedMember')}</span>
        )}
      </p>
      {member.orgDisplayName && member.orgDisplayName !== member.name && (
        <span className="text-xs text-gray-400">({member.name})</span>
      )}
      <button
        type="button"
        onClick={handleEdit}
        className="p-1 text-gray-300 hover:text-primary-500 opacity-0 group-hover:opacity-100 transition-opacity rounded-md"
        aria-label={t('editDisplayName')}
        title={t('editDisplayName')}
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export default function TeamPage() {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router

  const { profile, orgId, isAdmin, isLoading } = usePageAuth()
  const t = useTranslations('b2b.pages.team')

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loadingTeam, setLoadingTeam] = useState(false)
  const [removingUid, setRemovingUid] = useState<string | null>(null)
  const [updatingUid, setUpdatingUid] = useState<string | null>(null)
  const { alert, confirm } = useAlert()

  const currentUid = profile?.uid

  const loadTeam = useCallback(async (oid: string) => {
    setLoadingTeam(true)
    try {
      const members = await apiClient.getTeam(oid)
      setTeamMembers(
        members.map((m) => ({
          ...m,
          orgDisplayName: (m as TeamMember).orgDisplayName ?? null,
          joinedAt: typeof m.joinedAt === 'string' ? new Date(m.joinedAt) : (m.joinedAt as Date),
        }))
      )
    } catch {
      setTeamMembers([])
    } finally {
      setLoadingTeam(false)
    }
  }, [])

  useEffect(() => {
    if (isLoading) return
    if (!profile) {
      routerRef.current.push('/b2b/login')
      return
    }
    if (!isAdmin) {
      routerRef.current.push('/b2b')
      return
    }
    if (orgId) loadTeam(orgId)
  }, [isLoading, profile, isAdmin, orgId, loadTeam])

  const handleRemove = async (uid: string) => {
    if (!orgId) return
    const confirmed = await confirm(t('removeConfirm'))
    if (!confirmed) return
    setRemovingUid(uid)
    try {
      await apiClient.removeMember(orgId, uid)
      setTeamMembers((prev) => prev.filter((m) => m.uid !== uid))
    } catch (err) {
      alert(err instanceof Error ? err.message : t('failedRemove'), { type: 'error' })
    } finally {
      setRemovingUid(null)
    }
  }

  const handleChangeRole = async (uid: string, newRole: 'org_admin' | 'specialist') => {
    if (!orgId) return
    setUpdatingUid(uid)
    try {
      await apiClient.updateMemberRole(orgId, uid, newRole)
      setTeamMembers((prev) =>
        prev.map((m) =>
          m.uid === uid ? { ...m, role: newRole === 'org_admin' ? 'admin' : 'specialist' } : m
        )
      )
    } catch (err) {
      alert(err instanceof Error ? err.message : t('failedUpdateRole'), { type: 'error' })
    } finally {
      setUpdatingUid(null)
    }
  }

  const handleUpdateDisplayName = async (uid: string, orgDisplayName: string | null) => {
    if (!orgId) return
    try {
      await apiClient.request(`/orgs/${orgId}/members/${uid}/display-name`, {
        method: 'PATCH',
        body: JSON.stringify({ orgDisplayName }),
      })
      setTeamMembers((prev) => prev.map((m) => (m.uid === uid ? { ...m, orgDisplayName } : m)))
    } catch (err) {
      alert(err instanceof Error ? err.message : t('failedUpdateDisplayName'), { type: 'error' })
      throw err
    }
  }

  if (isLoading || loadingTeam) return <PageSpinner />
  if (!isAdmin) return null

  const admins = teamMembers.filter((m) => m.role === 'admin')
  const specialists = teamMembers.filter((m) => m.role === 'specialist')

  return (
    <PlanGate feature="team_management">
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">{t('title')}</h2>
          <p className="text-gray-600 mt-2">{t('subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{t('totalMembers')}</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{teamMembers.length}</p>
              </div>
              <div className="bg-primary-100 p-3 rounded-lg">
                <Users className="w-6 h-6 text-primary-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{t('administrators')}</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{admins.length}</p>
              </div>
              <div className="bg-yellow-100 p-3 rounded-lg">
                <Crown className="w-6 h-6 text-yellow-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{t('specialists')}</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{specialists.length}</p>
              </div>
              <div className="bg-blue-100 p-3 rounded-lg">
                <Shield className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="px-6 py-4 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{t('teamMembers')}</h3>
              <p className="text-xs text-gray-400 mt-0.5">{t('editDisplayNameHint')}</p>
            </div>
            <Link
              href={`/b2b/invites${orgId ? `?orgId=${orgId}` : ''}`}
              className="inline-flex w-full items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium sm:w-auto"
            >
              <UserPlus className="w-4 h-4" />
              {t('inviteSpecialist')}
            </Link>
          </div>

          <div className="p-6">
            {teamMembers.length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">{t('noTeamYet')}</h3>
                <p className="text-gray-600 mb-6">{t('createInvitesToAdd')}</p>
                <Link
                  href={`/b2b/invites${orgId ? `?orgId=${orgId}` : ''}`}
                  className="inline-flex w-full items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium sm:w-auto"
                >
                  <UserPlus className="w-4 h-4" />
                  {t('inviteSpecialist')}
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {teamMembers.map((member) => {
                  const joinedDate =
                    member.joinedAt instanceof Date
                      ? member.joinedAt.toLocaleDateString()
                      : new Date(member.joinedAt as string).toLocaleDateString()
                  const isCurrentUser = member.uid === currentUid
                  return (
                    <div
                      key={member.uid}
                      className="flex flex-col gap-4 rounded-lg border border-gray-200 p-4 transition-colors hover:bg-gray-50 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-4 sm:items-center">
                        <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                          <UserCog className="w-5 h-5 text-primary-600" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {isCurrentUser ? (
                              <p className="font-medium text-gray-900">
                                {member.orgDisplayName || member.name || (
                                  <span className="text-amber-600 italic">
                                    {t('unnamedMember')}
                                  </span>
                                )}
                              </p>
                            ) : (
                              <EditableName
                                member={member}
                                onSave={handleUpdateDisplayName}
                                t={t}
                              />
                            )}
                            {member.role === 'admin' && (
                              <span className="px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 rounded">
                                {t('admin')}
                              </span>
                            )}
                            {member.role === 'specialist' && (
                              <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded">
                                {t('specialist')}
                              </span>
                            )}
                            {isCurrentUser && (
                              <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded">
                                {t('you')}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex items-start gap-2">
                            <Mail className="w-4 h-4 text-gray-400 shrink-0" />
                            <p className="text-sm text-gray-600 break-all">{member.email}</p>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            {t('joined')} {joinedDate}
                          </p>
                        </div>
                      </div>
                      {!isCurrentUser && (
                        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap md:w-auto md:justify-end">
                          {member.role === 'specialist' ? (
                            <button
                              onClick={() => handleChangeRole(member.uid, 'org_admin')}
                              disabled={!!updatingUid}
                              className="inline-flex w-full items-center justify-center gap-1 px-3 py-2 text-xs font-medium text-yellow-700 bg-yellow-100 hover:bg-yellow-200 rounded-lg disabled:opacity-50 sm:w-auto"
                            >
                              {updatingUid === member.uid ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Crown className="w-3 h-3" />
                              )}
                              {t('makeAdmin')}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleChangeRole(member.uid, 'specialist')}
                              disabled={!!updatingUid}
                              className="inline-flex w-full items-center justify-center gap-1 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 rounded-lg disabled:opacity-50 sm:w-auto"
                            >
                              {updatingUid === member.uid ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Shield className="w-3 h-3" />
                              )}
                              {t('makeSpecialist')}
                            </button>
                          )}
                          <button
                            onClick={() => handleRemove(member.uid)}
                            disabled={!!removingUid}
                            className="inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50 transition-colors sm:w-auto sm:p-2"
                            title={t('removeFromOrg')}
                          >
                            {removingUid === member.uid ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                            <span className="sm:hidden">{t('removeFromOrg')}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </PlanGate>
  )
}

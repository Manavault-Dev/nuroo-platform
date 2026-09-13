'use client'

import { useEffect, useState, useRef, FormEvent, ChangeEvent } from 'react'
import { useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/lib/b2b/AuthContext'
import { apiClient } from '@/lib/b2b/api'
import {
  Save,
  User,
  Mail,
  Loader2,
  Shield,
  Briefcase,
  Eye,
  EyeOff,
  CheckCircle2,
  Info,
  Camera,
  X,
  AlertCircle,
} from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db, auth } from '@/lib/firebase/config'

// ─── Constants ────────────────────────────────────────────────────────────────

const SPECIALIZATIONS = [
  'Логопед',
  'ABA-терапист',
  'Психолог',
  'Дефектолог',
  'Эрготерапевт',
  'Нейропсихолог',
  'Специалист по сенсорной интеграции',
  'Поведенческий аналитик (BCBA)',
  'Детский психиатр',
  'Физический терапевт',
  'Специалист по раннему вмешательству',
  'Другое',
]

const MAX_AVATAR_MB = 5
const AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpecialistForm {
  isPublic: boolean
  fullName: string
  specialization: string
  customSpecialization: string
  bio: string
  avatarUrl: string // saved URL from Firestore
  linkedOrgId: string
  linkedOrgName: string
}

// ─── Avatar uploader component ────────────────────────────────────────────────

function AvatarUploader({
  currentUrl,
  displayName,
  onUploaded,
}: {
  currentUrl: string
  displayName: string
  uid: string
  onUploaded: (url: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const initial = (displayName || '?').charAt(0).toUpperCase()
  const shownUrl = preview ?? currentUrl

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setError('')

    // Validate type
    if (!file.type.startsWith('image/')) {
      setError('Только изображения (JPEG, PNG, WebP)')
      return
    }
    // Validate size
    if (file.size > MAX_AVATAR_MB * 1024 * 1024) {
      setError(`Файл слишком большой. Максимум ${MAX_AVATAR_MB} МБ`)
      return
    }

    // Show local preview immediately
    const localUrl = URL.createObjectURL(file)
    setPreview(localUrl)

    // Upload via backend → GCS (admin SDK), Firestore stores the URL
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      // Use fetch directly (not apiClient.request) so browser sets the
      // correct multipart/form-data boundary; get token from Firebase auth.
      const token = auth?.currentUser ? await auth.currentUser.getIdToken() : null
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3101'
      const response = await fetch(`${apiBase}/v1/me/avatar`, {
        method: 'POST',
        body: formData,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!response.ok) throw new Error('upload failed')
      const result: { ok: boolean; avatarUrl: string } = await response.json()
      onUploaded(result.avatarUrl)
      setPreview(null) // use the real URL now
    } catch {
      setError('Не удалось загрузить фото. Попробуйте снова.')
      setPreview(null)
    } finally {
      setUploading(false)
      // Reset input so same file can be re-selected
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleRemove = () => {
    setPreview(null)
    onUploaded('')
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-3">Фото профиля</label>

      <div className="flex items-center gap-5">
        {/* Avatar circle */}
        <div className="relative flex-shrink-0">
          <div className="w-24 h-24 rounded-full overflow-hidden bg-primary-600 flex items-center justify-center ring-4 ring-white shadow-md">
            {shownUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shownUrl} alt="avatar" className="w-full h-full object-cover" />
            ) : (
              <span className="text-white text-3xl font-bold select-none">{initial}</span>
            )}
          </div>

          {/* Upload overlay button */}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="absolute inset-0 rounded-full flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity cursor-pointer disabled:cursor-not-allowed"
            title="Изменить фото"
          >
            {uploading ? (
              <Loader2 className="w-6 h-6 text-white animate-spin" />
            ) : (
              <Camera className="w-6 h-6 text-white" />
            )}
          </button>
        </div>

        {/* Actions + hints */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded-lg hover:bg-primary-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Загрузка...
              </>
            ) : (
              <>
                <Camera className="w-4 h-4" />
                {shownUrl ? 'Изменить фото' : 'Загрузить фото'}
              </>
            )}
          </button>

          {shownUrl && !uploading && (
            <button
              type="button"
              onClick={handleRemove}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
            >
              <X className="w-4 h-4" />
              Удалить фото
            </button>
          )}

          <p className="text-xs text-gray-400">JPEG, PNG или WebP · до {MAX_AVATAR_MB} МБ</p>
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_ACCEPT}
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  )
}

// ─── Specialist marketplace profile section ───────────────────────────────────

function SpecialistProfileSection({
  uid,
  defaultName,
  linkedOrgId,
  linkedOrgName,
}: {
  uid: string
  defaultName: string
  linkedOrgId: string
  linkedOrgName: string
}) {
  const [form, setForm] = useState<SpecialistForm>({
    isPublic: false,
    fullName: defaultName,
    specialization: '',
    customSpecialization: '',
    bio: '',
    avatarUrl: '',
    linkedOrgId,
    linkedOrgName,
  })
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Load current Firestore specialist doc
  useEffect(() => {
    if (!db || !uid) {
      setLoadingProfile(false)
      return
    }
    getDoc(doc(db, 'specialists', uid))
      .then((snap) => {
        if (snap.exists()) {
          const d = snap.data() as Record<string, any>
          const spec = d.specialization ?? ''
          const isCustom = spec && !SPECIALIZATIONS.includes(spec)
          setForm({
            isPublic: d.isPublic === true,
            fullName: d.fullName ?? defaultName,
            specialization: isCustom ? 'Другое' : spec,
            customSpecialization: isCustom ? spec : '',
            bio: d.bio ?? '',
            avatarUrl: d.avatarUrl ?? '',
            linkedOrgId: d.linkedOrgId ?? linkedOrgId,
            linkedOrgName: d.linkedOrgName ?? linkedOrgName,
          })
        }
      })
      .catch(() => {})
      .finally(() => setLoadingProfile(false))
  }, [uid, defaultName, linkedOrgId, linkedOrgName])

  const effectiveSpecialization =
    form.specialization === 'Другое' ? form.customSpecialization : form.specialization

  const handleSave = async () => {
    if (!db) return
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await setDoc(
        doc(db, 'specialists', uid),
        {
          isPublic: form.isPublic,
          fullName: form.fullName || defaultName,
          specialization: effectiveSpecialization,
          bio: form.bio,
          avatarUrl: form.avatarUrl,
          linkedOrgId: form.linkedOrgId || linkedOrgId,
          linkedOrgName: form.linkedOrgName || linkedOrgName,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      )
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Не удалось сохранить профиль. Попробуйте снова.')
    } finally {
      setSaving(false)
    }
  }

  if (loadingProfile) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="animate-pulse space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-24 h-24 rounded-full bg-gray-200" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 rounded w-1/3" />
              <div className="h-8 bg-gray-100 rounded w-1/2" />
            </div>
          </div>
          <div className="h-10 bg-gray-100 rounded" />
          <div className="h-24 bg-gray-100 rounded" />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-primary-600" />
            Профиль специалиста
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Ваш публичный профиль на маркетплейсе Nuroo — родители найдут вас и запишутся.
          </p>
        </div>

        {/* Visibility toggle */}
        <button
          type="button"
          onClick={() => setForm((f) => ({ ...f, isPublic: !f.isPublic }))}
          className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all border flex-shrink-0 ${
            form.isPublic
              ? 'bg-primary-50 text-primary-700 border-primary-200 hover:bg-primary-100'
              : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
          }`}
        >
          {form.isPublic ? (
            <>
              <Eye className="w-4 h-4" />
              Виден
            </>
          ) : (
            <>
              <EyeOff className="w-4 h-4" />
              Скрыт
            </>
          )}
        </button>
      </div>

      {/* Info banner */}
      {form.isPublic && (
        <div className="mb-6 flex items-start gap-3 bg-primary-50 border border-primary-100 rounded-lg px-4 py-3">
          <Info className="w-4 h-4 text-primary-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-primary-700">
            Ваш профиль виден всем родителям в приложении Nuroo. Они смогут записаться к вам на
            консультацию.
          </p>
        </div>
      )}

      <div className="space-y-6">
        {/* ── Avatar ── */}
        <AvatarUploader
          currentUrl={form.avatarUrl}
          displayName={form.fullName || defaultName}
          uid={uid}
          onUploaded={(url) => setForm((f) => ({ ...f, avatarUrl: url }))}
        />

        <div className="border-t border-gray-100" />

        {/* ── Full name ── */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Отображаемое имя</label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <User className="h-4 w-4 text-gray-400" />
            </div>
            <input
              type="text"
              value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              placeholder="Айгуль Бектурова"
              className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
        </div>

        {/* ── Specialization ── */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Специализация</label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Briefcase className="h-4 w-4 text-gray-400" />
            </div>
            <select
              value={form.specialization}
              onChange={(e) => setForm((f) => ({ ...f, specialization: e.target.value }))}
              className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white appearance-none"
            >
              <option value="">— выберите специализацию —</option>
              {SPECIALIZATIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          {form.specialization === 'Другое' && (
            <input
              type="text"
              value={form.customSpecialization}
              placeholder="Введите вашу специализацию"
              onChange={(e) => setForm((f) => ({ ...f, customSpecialization: e.target.value }))}
              className="mt-2 block w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          )}
        </div>

        {/* ── Bio ── */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            О себе{' '}
            <span className="font-normal text-gray-400">({form.bio.length}/300 символов)</span>
          </label>
          <textarea
            value={form.bio}
            onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value.slice(0, 300) }))}
            rows={4}
            placeholder="Расскажите о вашем опыте, методах работы и о том, чем вы можете помочь..."
            className="block w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
          />
        </div>

        {/* ── Linked org (read-only) ── */}
        {linkedOrgName && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Место работы</label>
            <div className="flex items-center gap-3 px-3 py-3 border border-gray-200 rounded-lg bg-gray-50">
              <div className="w-9 h-9 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
                <Briefcase className="w-4 h-4 text-primary-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">{linkedOrgName}</p>
                <p className="text-xs text-gray-400">Подтянуто из вашей организации</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Card preview ── */}
        <div className="rounded-xl border-2 border-dashed border-gray-200 p-4 bg-gray-50">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">
            Превью карточки
          </p>
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="w-14 h-14 rounded-full overflow-hidden bg-primary-600 flex items-center justify-center flex-shrink-0 ring-2 ring-white shadow">
              {form.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.avatarUrl} alt="preview" className="w-full h-full object-cover" />
              ) : (
                <span className="text-white text-xl font-bold select-none">
                  {(form.fullName || defaultName || '?').charAt(0).toUpperCase()}
                </span>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 text-sm leading-tight">
                {form.fullName || defaultName || 'Ваше имя'}
              </p>
              {effectiveSpecialization && (
                <span className="inline-block mt-1 px-2.5 py-0.5 bg-blue-50 text-blue-700 text-xs font-semibold rounded-full border border-blue-100">
                  {effectiveSpecialization}
                </span>
              )}
              {linkedOrgName && (
                <p className="text-xs text-gray-500 mt-1.5 flex items-center gap-1">
                  <span className="text-base">🏢</span>
                  {linkedOrgName}
                </p>
              )}
              {form.bio && (
                <p className="text-xs text-gray-500 mt-1.5 line-clamp-2 leading-relaxed">
                  {form.bio}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Feedback */}
        {saved && (
          <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 px-4 py-3 rounded-lg text-sm">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            Профиль специалиста сохранён и опубликован на маркетплейсе!
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Save */}
        <div className="flex justify-end pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Сохранение...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Сохранить профиль
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Settings Page ───────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter()
  const t = useTranslations('b2b.pages.settings')
  const { profile, isLoading, refreshProfile } = useAuth()
  const [name, setName] = useState(profile?.name ?? '')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (profile?.name) setName(profile.name)
  }, [profile?.name])

  useEffect(() => {
    if (!isLoading && !profile) router.push('/b2b/login')
  }, [isLoading, profile, router])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess(false)
    try {
      await apiClient.createProfile(name)
      await refreshProfile()
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : t('updateError'))
    } finally {
      setSaving(false)
    }
  }

  const specialistOrg = profile?.organizations?.find((o) => o.role === 'specialist')

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900">{t('title')}</h2>
        <p className="text-gray-600 mt-2">{t('subtitle')}</p>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* ── Account ── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {success && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
                <CheckCircle2 className="w-4 h-4" />
                {t('profileUpdated')}
              </div>
            )}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                {t('emailAddress')}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="email"
                  id="email"
                  value={profile?.email || ''}
                  disabled
                  className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">{t('emailCannotChange')}</p>
            </div>

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                {t('fullName')}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder={t('fullNamePlaceholder')}
                />
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-gray-200">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>{t('saving')}</span>
                  </>
                ) : (
                  <>
                    <Save className="w-5 h-5" />
                    <span>{t('saveChanges')}</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* ── Organizations ── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('organizations')}</h3>
          {profile && profile.organizations.length > 0 ? (
            <div className="space-y-3">
              {profile.organizations.map((org) => (
                <div
                  key={org.orgId}
                  className="flex flex-col gap-3 p-4 border border-gray-200 rounded-lg sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium text-gray-900">{org.orgName}</p>
                    <p className="text-sm text-gray-500">
                      {t('role')}: {org.role === 'admin' ? t('administrator') : t('specialist')}
                    </p>
                  </div>
                  <span
                    className={`self-start px-3 py-1 text-xs font-semibold rounded-full ${
                      org.role === 'admin'
                        ? 'bg-primary-100 text-primary-800'
                        : 'bg-blue-50 text-blue-700 border border-blue-100'
                    }`}
                  >
                    {org.role === 'admin' ? t('administrator') : t('specialist')}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500">{t('notInOrg')}</p>
          )}
        </div>

        {/* ── Specialist marketplace profile ── */}
        {specialistOrg && profile?.uid && (
          <SpecialistProfileSection
            uid={profile.uid}
            defaultName={profile.name ?? ''}
            linkedOrgId={specialistOrg.orgId}
            linkedOrgName={specialistOrg.orgName}
          />
        )}

        {/* ── Privacy ── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Конфиденциальность</h3>
          <p className="text-sm text-gray-500 mb-4">
            Управление согласиями и просмотр правовых документов
          </p>
          <Link
            href="/b2b/settings/privacy"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-50 text-primary-700 text-sm font-medium hover:bg-primary-100 transition-colors"
          >
            <Shield className="w-4 h-4" />
            Настройки конфиденциальности
          </Link>
        </div>
      </div>
    </div>
  )
}

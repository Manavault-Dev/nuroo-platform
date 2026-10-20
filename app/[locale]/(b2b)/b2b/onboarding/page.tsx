'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from '@/i18n/navigation'
import {
  AlertCircle,
  Loader2,
  Key,
  Check,
  Building2,
  Palette,
  FlaskConical,
  Music,
  Brain,
  MessageCircle,
  Dumbbell,
  BookOpen,
  HandHeart,
  Music2,
  Languages,
  Castle,
  Code2,
  Cpu,
  Theater,
  Waves,
  Sparkles,
  Baby,
  UserCircle,
  type LucideIcon,
} from 'lucide-react'
import Image from 'next/image'
import { Select } from '@/components/ui/Select'
import { getCurrentUser, getIdToken } from '@/lib/b2b/authClient'
import { apiClient } from '@/lib/b2b/api'
import { useAuth } from '@/lib/b2b/AuthContext'
import { getWorkspacePath, type B2bOrgMembership } from '@/src/config/routes'

// ── Types ────────────────────────────────────────────────────────────────────

type Step = 'setup' | 'invite'

// ── Data ─────────────────────────────────────────────────────────────────────

const COUNTRY_OPTIONS = [
  { value: 'kg', label: '🇰🇬 Кыргызстан' },
  { value: 'kz', label: '🇰🇿 Казахстан' },
  { value: 'ru', label: '🇷🇺 Россия' },
  { value: 'uz', label: '🇺🇿 Узбекистан' },
  { value: 'other', label: '🌍 Другая страна' },
]

type OrgType = 'kindergarten' | 'development_center' | 'school' | 'specialist' | 'other'

const ORG_TYPE_OPTIONS: { value: OrgType; label: string; icon: LucideIcon }[] = [
  { value: 'kindergarten', label: 'Детский сад', icon: Baby },
  { value: 'development_center', label: 'Центр развития', icon: Building2 },
  { value: 'school', label: 'Школа', icon: BookOpen },
  { value: 'specialist', label: 'Я специалист', icon: UserCircle },
  { value: 'other', label: 'Другое', icon: Sparkles },
]

interface Category {
  id: string
  label: string
  icon: LucideIcon
  color: string
}

// A short, representative set — enough to categorize a listing for the
// marketplace without turning this into its own wizard step. Selecting a
// category is entirely optional (see "Why this is optional" below).
const CATEGORIES: Category[] = [
  { id: 'speech', label: 'Логопедия', icon: MessageCircle, color: 'bg-teal-50 text-teal-500' },
  { id: 'aba', label: 'ABA / Дефектология', icon: HandHeart, color: 'bg-green-50 text-green-500' },
  { id: 'psychology', label: 'Психология', icon: Brain, color: 'bg-rose-50 text-rose-500' },
  { id: 'art', label: 'Арт и творчество', icon: Palette, color: 'bg-pink-50 text-pink-500' },
  { id: 'stem', label: 'STEM / Наука', icon: FlaskConical, color: 'bg-blue-50 text-blue-500' },
  { id: 'music', label: 'Музыка', icon: Music, color: 'bg-violet-50 text-violet-500' },
  { id: 'sport', label: 'Спорт', icon: Dumbbell, color: 'bg-orange-50 text-orange-500' },
  {
    id: 'school',
    label: 'Подготовка к школе',
    icon: BookOpen,
    color: 'bg-amber-50 text-amber-500',
  },
  { id: 'dance', label: 'Танцы', icon: Music2, color: 'bg-fuchsia-50 text-fuchsia-500' },
  { id: 'languages', label: 'Языки', icon: Languages, color: 'bg-sky-50 text-sky-500' },
  { id: 'chess', label: 'Шахматы', icon: Castle, color: 'bg-slate-50 text-slate-500' },
  { id: 'coding', label: 'Программирование', icon: Code2, color: 'bg-indigo-50 text-indigo-500' },
  { id: 'robotics', label: 'Робототехника', icon: Cpu, color: 'bg-cyan-50 text-cyan-500' },
  {
    id: 'theater',
    label: 'Театр / Актёрство',
    icon: Theater,
    color: 'bg-purple-50 text-purple-500',
  },
  { id: 'swimming', label: 'Плавание', icon: Waves, color: 'bg-blue-50 text-blue-400' },
  { id: 'other', label: 'Другое', icon: Sparkles, color: 'bg-gray-50 text-gray-400' },
]

// ── Main component ────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter()
  const { refreshProfile } = useAuth()

  const [step, setStep] = useState<Step>('setup')
  const [orgName, setOrgName] = useState('')
  const [orgType, setOrgType] = useState<OrgType | null>(null)
  const [country, setCountry] = useState('')
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [customCategory, setCustomCategory] = useState('')
  const [showCategories, setShowCategories] = useState(false)

  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const ensureToken = async () => {
    const user = getCurrentUser()
    if (!user) {
      router.push('/b2b/login')
      return null
    }
    const token = await getIdToken()
    if (!token) {
      router.push('/b2b/login')
      return null
    }
    apiClient.setToken(token)
    return token
  }

  const handleJoin = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const code = inviteCode.trim()
    if (!code) return setError('Введите код приглашения')
    setLoading(true)
    try {
      const token = await ensureToken()
      if (!token) return
      const result = await apiClient.acceptInvite(code)
      apiClient.clearCache()
      const refreshedToken = await getIdToken(true)
      if (refreshedToken) apiClient.setToken(refreshedToken)
      await refreshProfile({ force: true })
      const membership: B2bOrgMembership = {
        orgId: result.orgId,
        role: result.role === 'specialist' ? 'specialist' : 'admin',
      }
      router.replace(getWorkspacePath(membership))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Не удалось принять приглашение')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateOrg = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const name = orgName.trim()
    if (!name) return setError('Введите название')
    setLoading(true)
    try {
      const token = await ensureToken()
      if (!token) return
      // Plan selection is deliberately deferred — everyone starts on the free
      // Nuroo trial and can upgrade to Business from billing settings later,
      // once they actually know what they need, instead of guessing upfront.
      const specializations = selectedCategories.map((c) =>
        c === 'other' && customCategory.trim() ? customCategory.trim() : c
      )
      const res = await apiClient.createMyOrganization(
        name,
        country || undefined,
        'nuroo',
        specializations,
        orgType ?? undefined
      )
      apiClient.clearCache()
      const refreshedToken = await getIdToken(true)
      if (refreshedToken) apiClient.setToken(refreshedToken)
      await refreshProfile({ force: true })
      router.replace(`/b2b?orgId=${res.orgId}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Не удалось создать аккаунт')
    } finally {
      setLoading(false)
    }
  }

  const toggleCategory = (id: string) =>
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    )

  // ── Setup: the entire flow is this one screen ────────────────────────────

  if (step === 'setup') {
    return (
      <Shell>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Создайте ваш профиль</h2>
            <p className="text-sm text-gray-500">Это займёт меньше минуты</p>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-4 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleCreateOrg} className="space-y-4">
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-2 block">
              Название центра или ваше имя
            </label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Центр «Шаг вперёд» или Айгерим Манасова"
              autoFocus
              className="w-full px-4 py-3.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-base bg-gray-50 focus:bg-white transition-colors"
            />
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-700 mb-2 block">Тип</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ORG_TYPE_OPTIONS.map((opt) => {
                const active = orgType === opt.value
                const Icon = opt.icon
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setOrgType(active ? null : opt.value)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium text-left transition-all ${
                      active
                        ? 'border-primary-400 bg-primary-50 text-primary-700'
                        : 'border-gray-100 bg-gray-50 text-gray-700 hover:border-gray-200 hover:bg-white'
                    }`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span className="leading-tight flex-1">{opt.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="text-sm font-semibold text-gray-700 mb-2 block">Страна</label>
            <Select
              value={country}
              options={COUNTRY_OPTIONS}
              onChange={setCountry}
              placeholder="Выберите страну"
              buttonClassName="py-3.5 text-base bg-gray-50 hover:bg-white rounded-xl"
            />
          </div>

          {/* Specialization — optional, collapsed by default so it never
              blocks the primary path of just creating the account. */}
          {showCategories ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">
                  Специализация <span className="text-gray-400 font-normal">(необязательно)</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowCategories(false)}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Скрыть
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {CATEGORIES.map((cat) => {
                  const active = selectedCategories.includes(cat.id)
                  const Icon = cat.icon
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => toggleCategory(cat.id)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium text-left transition-all ${
                        active
                          ? 'border-primary-400 bg-primary-50 text-primary-700'
                          : 'border-gray-100 bg-white text-gray-700 hover:border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <div
                        className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${active ? 'bg-primary-100 text-primary-600' : cat.color}`}
                      >
                        <Icon className="w-3 h-3" />
                      </div>
                      <span className="leading-tight flex-1 text-xs">{cat.label}</span>
                      {active && <Check className="w-3.5 h-3.5 text-primary-500 flex-shrink-0" />}
                    </button>
                  )
                })}
              </div>
              {selectedCategories.includes('other') && (
                <input
                  type="text"
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  placeholder="Напишите вашу специализацию..."
                  maxLength={80}
                  className="w-full mt-2 px-4 py-3 rounded-xl border border-primary-300 bg-white text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-400 transition"
                  autoFocus
                />
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowCategories(true)}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              + Добавить специализацию (необязательно)
            </button>
          )}

          <button
            type="submit"
            disabled={loading || !orgName.trim() || !country}
            className="w-full inline-flex items-center justify-center py-3.5 bg-primary-600 text-white font-semibold text-base rounded-xl hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm shadow-primary-200"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Создать аккаунт
          </button>
          <p className="text-xs text-gray-400 text-center">
            Бесплатно 30 дней · Карта не нужна · Можно изменить тариф позже
          </p>
        </form>

        <button
          type="button"
          onClick={() => setStep('invite')}
          className="w-full mt-4 text-sm text-gray-400 hover:text-primary-600 transition-colors"
        >
          Есть код приглашения?
        </button>
      </Shell>
    )
  }

  // ── Invite: join existing org ─────────────────────────────────────────────

  if (step === 'invite') {
    return (
      <Shell>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center">
            <Key className="w-5 h-5 text-teal-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Войти по приглашению</h2>
            <p className="text-sm text-gray-500">Введите код, который прислал вам администратор</p>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-4 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleJoin} className="space-y-4">
          <input
            type="text"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            placeholder="ABCD-1234"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-center text-lg font-mono tracking-widest uppercase"
          />
          <button
            type="submit"
            disabled={loading || !inviteCode.trim()}
            className="w-full inline-flex items-center justify-center py-3.5 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Присоединиться
          </button>
        </form>

        <button
          type="button"
          onClick={() => setStep('setup')}
          className="w-full mt-4 text-sm text-gray-400 hover:text-gray-600"
        >
          ← Нет кода? Создать свой аккаунт
        </button>
      </Shell>
    )
  }

  return null
}

// ── Shell layout ─────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { logout } = useAuth()
  const [loggingOut, setLoggingOut] = useState(false)

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-secondary-50 py-12 px-4">
      <div className="w-full max-w-2xl">
        {/* Logo */}
        <div className="text-center mb-4">
          <Image
            src="/Logo.svg"
            alt="Nuroo"
            width={56}
            height={56}
            className="mx-auto rounded-xl"
            priority
          />
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">{children}</div>

        <div className="text-center mt-6">
          <button
            type="button"
            onClick={async () => {
              setLoggingOut(true)
              try {
                await logout()
                router.push('/b2b/login')
              } finally {
                setLoggingOut(false)
              }
            }}
            disabled={loggingOut}
            className="text-sm text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            {loggingOut ? '...' : 'Выйти из аккаунта'}
          </button>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { usePageAuth } from '@/lib/b2b/usePageAuth'
import { apiClient } from '@/lib/b2b/api'
import { ArrowLeft, Loader2, Save } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { PageSpinner } from '@/components/ui/Spinner'

const CATEGORIES = [
  'Логопедия',
  'АВА-терапия',
  'Психология',
  'Моторика',
  'Арт-терапия',
  'Нейрокоррекция',
  'Подготовка к школе',
  'Сенсорная интеграция',
  'Другое',
]

const DIFFICULTY = [
  { value: 'BEGINNER', label: 'Начальный' },
  { value: 'INTERMEDIATE', label: 'Средний' },
  { value: 'ADVANCED', label: 'Продвинутый' },
]

export default function NewVideoCoursePage() {
  const router = useRouter()
  const { orgId, isAdmin, isLoading } = usePageAuth()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    title: '',
    description: '',
    category: '',
    difficulty: 'BEGINNER' as 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED',
    price: 0,
    currency: 'KGS',
    accessPolicy: 'FREE' as 'FREE' | 'PAID',
    visibility: 'PRIVATE' as 'PRIVATE' | 'PUBLIC',
    ageRange: '',
    targetAudience: '',
    tags: '',
  })

  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((prev) => ({ ...prev, [key]: e.target.value }))
    }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!orgId) return
    if (!form.title.trim()) {
      setError('Введите название курса')
      return
    }
    if (!form.description.trim()) {
      setError('Введите описание')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const res = await apiClient.createOrgCourse(orgId, {
        ...form,
        price: Number(form.price),
        tags: form.tags
          ? form.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
        status: 'DRAFT',
      })
      router.push(`/b2b/video-courses/${res.id}?orgId=${orgId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать курс')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) return <PageSpinner />
  if (!isAdmin) return null

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl">
      <div className="mb-6">
        <Link
          href={`/b2b/video-courses${orgId ? `?orgId=${orgId}` : ''}`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Назад к курсам
        </Link>
        <h2 className="text-2xl font-bold text-gray-900">Новый видеокурс</h2>
        <p className="text-gray-500 text-sm mt-1">
          Создайте курс — добавите модули и уроки после создания
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h3 className="font-semibold text-gray-800">Основная информация</h3>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Название курса *</label>
            <input
              value={form.title}
              onChange={set('title')}
              placeholder="Логопедия для детей 3–5 лет"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Описание *</label>
            <textarea
              value={form.description}
              onChange={set('description')}
              rows={4}
              placeholder="Подробное описание курса для родителей..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Категория</label>
              <select
                value={form.category}
                onChange={set('category')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              >
                <option value="">Выберите...</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Уровень</label>
              <select
                value={form.difficulty}
                onChange={set('difficulty')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              >
                {DIFFICULTY.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Возраст</label>
              <input
                value={form.ageRange}
                onChange={set('ageRange')}
                placeholder="3–7 лет"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Для кого</label>
              <input
                value={form.targetAudience}
                onChange={set('targetAudience')}
                placeholder="Родители, дети с ЗРР"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Теги (через запятую)
            </label>
            <input
              value={form.tags}
              onChange={set('tags')}
              placeholder="логопедия, речь, развитие"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h3 className="font-semibold text-gray-800">Доступ и цена</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Тип доступа</label>
              <select
                value={form.accessPolicy}
                onChange={set('accessPolicy')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              >
                <option value="FREE">Бесплатно</option>
                <option value="PAID">Платно</option>
              </select>
            </div>
            {form.accessPolicy === 'PAID' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Цена (сом)</label>
                <input
                  type="number"
                  min={0}
                  value={form.price}
                  onChange={set('price')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Видимость</label>
            <div className="flex gap-3">
              {[
                {
                  value: 'PRIVATE',
                  label: 'Только организация',
                  desc: 'Только клиенты вашей орг.',
                },
                { value: 'PUBLIC', label: 'Маркетплейс', desc: 'Виден всем в Nuroo' },
              ].map((opt) => (
                <label
                  key={opt.value}
                  className={`flex-1 border rounded-lg p-3 cursor-pointer transition-colors ${form.visibility === opt.value ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={opt.value}
                    checked={form.visibility === opt.value}
                    onChange={set('visibility')}
                    className="sr-only"
                  />
                  <div className="font-medium text-sm text-gray-800">{opt.label}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{opt.desc}</div>
                </label>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="text-red-500 text-sm bg-red-50 rounded-lg px-4 py-3">{error}</p>}

        <div className="flex gap-3">
          <Link
            href={`/b2b/video-courses${orgId ? `?orgId=${orgId}` : ''}`}
            className="flex-1 text-center px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Отмена
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Создаём...' : 'Создать курс'}
          </button>
        </div>
      </form>
    </div>
  )
}

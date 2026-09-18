'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { useRouter, Link } from '@/i18n/navigation'
import { usePageAuth } from '@/lib/b2b/usePageAuth'
import { apiClient } from '@/lib/b2b/api'
import type { CourseModule, Lesson } from '@/lib/b2b/types/course'
import { PageSpinner } from '@/components/ui/Spinner'
import { useAlert } from '@/components/ui/AlertDialog'
import {
  ArrowLeft,
  Plus,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronUp,
  Video,
  FileText,
  CheckSquare,
  File,
  GripVertical,
  Save,
  X,
  Loader2,
  Eye,
  EyeOff,
  Settings,
  BookOpen,
  Upload,
} from 'lucide-react'

type LessonType = 'video' | 'text' | 'task' | 'pdf'

interface FullCourse {
  id: string
  title: string
  description: string
  status: string
  visibility: string
  accessPolicy: string
  price: number
  currency: string
  category?: string
  difficulty?: string
  ageRange?: string
  targetAudience?: string
  tags?: string[]
  modules: (CourseModule & { lessons: Lesson[] })[]
}

const LESSON_ICONS: Record<LessonType, React.ElementType> = {
  video: Video,
  text: FileText,
  task: CheckSquare,
  pdf: File,
}
const LESSON_LABELS: Record<LessonType, string> = {
  video: 'Видео',
  text: 'Текст',
  task: 'Задание',
  pdf: 'PDF',
}

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

function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

function buildLessonPayload(data: Partial<Lesson>, fallbackOrder: number): Record<string, unknown> {
  const type = (data.type ?? 'video') as LessonType
  const payload: Record<string, unknown> = {
    title: data.title?.trim() ?? '',
    type,
    order: typeof data.order === 'number' ? data.order : fallbackOrder,
  }

  if (type === 'video') {
    const videoUrl = data.videoUrl?.trim()
    if (videoUrl) payload.videoUrl = videoUrl

    const duration =
      typeof data.videoDurationMin === 'number'
        ? data.videoDurationMin
        : Number(data.videoDurationMin)
    if (Number.isFinite(duration) && duration >= 0) {
      payload.videoDurationMin = duration
    }
  }

  if (type === 'text') {
    payload.body = data.body?.trim() || null
  }

  if (type === 'task') {
    payload.taskDescription = data.taskDescription?.trim() || null
    payload.taskExample = data.taskExample?.trim() || null
  }

  if (type === 'pdf') {
    const pdfUrl = data.pdfUrl?.trim()
    if (pdfUrl) payload.pdfUrl = pdfUrl
    payload.pdfName = data.pdfName?.trim() || null
  }

  return payload
}

function LessonRow({
  lesson,
  moduleId,
  orgId,
  courseId,
  isAdmin,
  isDragging,
  onDelete,
  onEdit,
  onDragHandleStart,
  onDragEnd,
}: {
  lesson: Lesson
  moduleId: string
  orgId: string
  courseId: string
  isAdmin: boolean
  isDragging?: boolean
  onDelete: (modId: string, l: Lesson) => void
  onEdit: (modId: string, l: Lesson) => void
  onDragHandleStart: () => void
  onDragEnd?: () => void
}) {
  const Icon = LESSON_ICONS[lesson.type as LessonType] ?? FileText
  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 bg-gray-50 rounded-lg group ${isDragging ? 'opacity-40' : ''}`}
    >
      <div
        draggable={isAdmin}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', lesson.id)
          onDragHandleStart()
        }}
        onDragEnd={onDragEnd}
        className={`shrink-0 ${isAdmin ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        <GripVertical className="w-4 h-4 text-gray-300" />
      </div>
      <Icon className="w-4 h-4 text-gray-400 shrink-0" />
      <span className="flex-1 text-sm text-gray-800 truncate">{lesson.title}</span>
      <span className="text-xs text-gray-400 bg-white border border-gray-200 px-2 py-0.5 rounded-full">
        {LESSON_LABELS[lesson.type as LessonType] ?? lesson.type}
      </span>
      {lesson.videoDurationMin && (
        <span className="text-xs text-gray-400">{lesson.videoDurationMin} мин</span>
      )}
      {isAdmin && (
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onEdit(moduleId, lesson)}
            className="p-1 hover:bg-gray-200 rounded text-gray-500"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(moduleId, lesson)}
            className="p-1 hover:bg-red-100 rounded text-red-400"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

function ModuleBlock({
  mod,
  orgId,
  courseId,
  isAdmin,
  isDragging,
  onDeleteModule,
  onAddLesson,
  onDeleteLesson,
  onEditLesson,
  onEditModule,
  onReorderLessons,
  onDragHandleStart,
  onDragEnd,
}: {
  mod: CourseModule & { lessons: Lesson[] }
  orgId: string
  courseId: string
  isAdmin: boolean
  isDragging?: boolean
  onDeleteModule: (m: CourseModule) => void
  onAddLesson: (modId: string) => void
  onDeleteLesson: (modId: string, l: Lesson) => void
  onEditLesson: (modId: string, l: Lesson) => void
  onEditModule: (m: CourseModule) => void
  onReorderLessons: (modId: string, lessons: Lesson[]) => void
  onDragHandleStart: () => void
  onDragEnd?: () => void
}) {
  const [expanded, setExpanded] = useState(true)
  const dragLessonFrom = useRef<number | null>(null)
  const [dragLessonOverIndex, setDragLessonOverIndex] = useState<number | null>(null)

  const handleLessonDrop = (toIndex: number) => {
    const fromIndex = dragLessonFrom.current
    dragLessonFrom.current = null
    setDragLessonOverIndex(null)
    if (fromIndex === null || fromIndex === toIndex) return
    onReorderLessons(mod.id, moveItem(mod.lessons, fromIndex, toIndex))
  }

  return (
    <div
      className={`bg-white border border-gray-200 rounded-xl overflow-hidden ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div
          draggable={isAdmin}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', mod.id)
            onDragHandleStart()
          }}
          onDragEnd={onDragEnd}
          className={`shrink-0 ${isAdmin ? 'cursor-grab active:cursor-grabbing' : ''}`}
        >
          <GripVertical className="w-4 h-4 text-gray-300" />
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-1 flex items-center gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronUp className="w-4 h-4 text-gray-400" />
          )}
          <span className="font-medium text-gray-800">{mod.title}</span>
          <span className="text-xs text-gray-400 ml-auto">{mod.lessons.length} уроков</span>
        </button>
        {isAdmin && (
          <div className="flex gap-1">
            <button
              onClick={() => onEditModule(mod)}
              className="p-1.5 hover:bg-gray-200 rounded text-gray-500"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onDeleteModule(mod)}
              className="p-1.5 hover:bg-red-100 rounded text-red-400"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
      {expanded && (
        <div className="p-4 space-y-2">
          {mod.lessons.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">
              Нет уроков. Добавьте первый урок.
            </p>
          )}
          {mod.lessons.map((l, idx) => (
            <div
              key={l.id}
              onDragOver={(e) => {
                if (dragLessonFrom.current === null) return
                e.preventDefault()
                if (dragLessonOverIndex !== idx) setDragLessonOverIndex(idx)
              }}
              onDrop={(e) => {
                e.preventDefault()
                handleLessonDrop(idx)
              }}
              className={dragLessonOverIndex === idx ? 'rounded-lg ring-2 ring-primary-300' : ''}
            >
              <LessonRow
                lesson={l}
                moduleId={mod.id}
                orgId={orgId}
                courseId={courseId}
                isAdmin={isAdmin}
                isDragging={dragLessonFrom.current === idx}
                onDelete={onDeleteLesson}
                onEdit={onEditLesson}
                onDragHandleStart={() => {
                  dragLessonFrom.current = idx
                }}
                onDragEnd={() => {
                  dragLessonFrom.current = null
                  setDragLessonOverIndex(null)
                }}
              />
            </div>
          ))}
          {isAdmin && (
            <button
              onClick={() => onAddLesson(mod.id)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-primary-400 hover:text-primary-600 transition-colors mt-2"
            >
              <Plus className="w-4 h-4" /> Добавить урок
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- modals ----------

function FileUploadField({
  label,
  accept,
  hint,
  fileUrl,
  fileName,
  uploading,
  error,
  icon: Icon,
  onUpload,
  onClear,
}: {
  label: string
  accept: string
  hint: string
  fileUrl?: string | null
  fileName?: string | null
  uploading: boolean
  error?: string | null
  icon: React.ElementType
  onUpload: (file: File) => void
  onClear: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onUpload(file)
          e.target.value = ''
        }}
      />
      {fileUrl ? (
        <div className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50">
          <Icon className="w-4 h-4 text-gray-400 shrink-0" />
          <a
            href={fileUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 text-sm text-gray-700 truncate hover:underline"
          >
            {fileName || fileUrl.split('/').pop()}
          </a>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-xs text-primary-600 hover:underline shrink-0"
          >
            Заменить
          </button>
          <button
            type="button"
            onClick={onClear}
            className="p-1 hover:bg-gray-200 rounded text-gray-400 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full flex flex-col items-center justify-center gap-1.5 px-4 py-5 border-2 border-dashed border-gray-300 rounded-lg text-gray-400 hover:border-primary-400 hover:text-primary-600 transition-colors disabled:opacity-60"
        >
          {uploading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Upload className="w-5 h-5" />
          )}
          <span className="text-sm">{uploading ? 'Загрузка...' : 'Выберите файл'}</span>
          <span className="text-xs">{hint}</span>
        </button>
      )}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

function LessonModal({
  moduleId,
  orgId,
  lesson,
  onSave,
  onClose,
}: {
  moduleId: string
  orgId: string
  lesson: Partial<Lesson> | null
  onSave: (modId: string, data: Partial<Lesson>) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<Partial<Lesson>>(
    lesson ?? { title: '', type: 'video' as LessonType }
  )
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const set =
    (k: keyof Lesson) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }))

  const handleUpload = async (file: File, kind: 'lesson-video' | 'lesson-pdf', maxMb: number) => {
    setUploadError(null)
    if (kind === 'lesson-video' && !file.type.startsWith('video/')) {
      setUploadError('Выберите видеофайл')
      return
    }
    if (kind === 'lesson-pdf' && file.type !== 'application/pdf') {
      setUploadError('Выберите PDF-файл')
      return
    }
    if (file.size > maxMb * 1024 * 1024) {
      setUploadError(`Файл слишком большой. Максимум ${maxMb} МБ`)
      return
    }
    setUploading(true)
    try {
      const res = await apiClient.uploadCourseMedia(orgId, file, kind)
      setForm((p) =>
        kind === 'lesson-video'
          ? { ...p, videoUrl: res.url }
          : { ...p, pdfUrl: res.url, pdfName: res.filename ?? file.name }
      )
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Не удалось загрузить файл')
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    if (!form.title?.trim()) return
    setSaving(true)
    try {
      await onSave(moduleId, form)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">
            {lesson?.id ? 'Редактировать урок' : 'Новый урок'}
          </h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Название *</label>
            <input
              value={form.title ?? ''}
              onChange={set('title')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Тип урока</label>
            <select
              value={form.type ?? 'video'}
              onChange={set('type')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            >
              <option value="video">Видео</option>
              <option value="text">Текст</option>
              <option value="task">Задание</option>
              <option value="pdf">PDF</option>
            </select>
          </div>
          {form.type === 'video' && (
            <>
              <FileUploadField
                label="Видео"
                accept="video/*"
                hint="MP4, WebM — до 100 МБ"
                fileUrl={form.videoUrl}
                fileName={form.videoUrl ? form.videoUrl.split('/').pop() : null}
                uploading={uploading}
                error={uploadError}
                icon={Video}
                onUpload={(file) => handleUpload(file, 'lesson-video', 100)}
                onClear={() => setForm((p) => ({ ...p, videoUrl: '' }))}
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Длительность (мин)
                </label>
                <input
                  type="number"
                  min={0}
                  value={form.videoDurationMin ?? ''}
                  onChange={set('videoDurationMin')}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
            </>
          )}
          {form.type === 'text' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Содержимое</label>
              <textarea
                value={form.body ?? ''}
                onChange={set('body')}
                rows={6}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
              />
            </div>
          )}
          {form.type === 'task' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Описание задания
                </label>
                <textarea
                  value={form.taskDescription ?? ''}
                  onChange={set('taskDescription')}
                  rows={4}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Пример выполнения
                </label>
                <textarea
                  value={form.taskExample ?? ''}
                  onChange={set('taskExample')}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
                />
              </div>
            </>
          )}
          {form.type === 'pdf' && (
            <FileUploadField
              label="PDF-файл"
              accept="application/pdf"
              hint="PDF — до 20 МБ"
              fileUrl={form.pdfUrl}
              fileName={form.pdfName}
              uploading={uploading}
              error={uploadError}
              icon={File}
              onUpload={(file) => handleUpload(file, 'lesson-pdf', 20)}
              onClear={() => setForm((p) => ({ ...p, pdfUrl: '', pdfName: '' }))}
            />
          )}
        </div>
        <div className="flex gap-3 p-5 border-t border-gray-100">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={saving || uploading || !form.title?.trim()}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}

function CourseSettingsModal({
  course,
  onSave,
  onClose,
}: {
  course: FullCourse
  onSave: (data: Record<string, unknown>) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState({
    title: course.title,
    description: course.description,
    category: course.category ?? '',
    difficulty: (course.difficulty ?? 'BEGINNER') as 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED',
    ageRange: course.ageRange ?? '',
    targetAudience: course.targetAudience ?? '',
    tags: (course.tags ?? []).join(', '),
    accessPolicy: (course.accessPolicy === 'PAID' ? 'PAID' : 'FREE') as 'FREE' | 'PAID',
    price: course.price ?? 0,
    currency: course.currency ?? 'KGS',
    visibility: (course.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE') as 'PRIVATE' | 'PUBLIC',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }))

  const handleSave = async () => {
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
      await onSave({
        ...form,
        price: Number(form.price),
        tags: form.tags
          ? form.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить изменения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Параметры курса</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Название курса *</label>
            <input
              value={form.title}
              onChange={set('title')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Описание *</label>
            <textarea
              value={form.description}
              onChange={set('description')}
              rows={4}
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
          {error && <p className="text-red-500 text-sm bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="flex gap-3 p-5 border-t border-gray-100">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}

function ModuleModal({
  mod,
  onSave,
  onClose,
}: {
  mod: Partial<CourseModule> | null
  onSave: (data: Partial<CourseModule>) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState({ title: mod?.title ?? '', description: mod?.description ?? '' })
  const [saving, setSaving] = useState(false)
  const handleSave = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      await onSave({ ...mod, ...form })
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">
            {mod?.id ? 'Редактировать модуль' : 'Новый модуль'}
          </h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Название модуля *
            </label>
            <input
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Описание</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
            />
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t border-gray-100">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.title.trim()}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- main ----------

export default function CourseEditorPage() {
  const params = useParams()
  const courseId = params.courseId as string
  const router = useRouter()
  const { profile, orgId, isAdmin, isLoading } = usePageAuth()
  const { alert, confirm } = useAlert()

  const [course, setCourse] = useState<FullCourse | null>(null)
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)

  const [lessonModal, setLessonModal] = useState<{
    moduleId: string
    lesson: Partial<Lesson> | null
  } | null>(null)
  const [moduleModal, setModuleModal] = useState<{ mod: Partial<CourseModule> | null } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const dragModuleFrom = useRef<number | null>(null)
  const [dragModuleOverIndex, setDragModuleOverIndex] = useState<number | null>(null)

  const load = useCallback(
    async (oid: string) => {
      setLoading(true)
      try {
        const res = await apiClient.getCourseFull(oid, courseId)
        setCourse(res as unknown as FullCourse)
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Не удалось загрузить курс', { type: 'error' })
      } finally {
        setLoading(false)
      }
    },
    [courseId]
  )

  useEffect(() => {
    if (isLoading) return
    if (!profile) {
      router.push('/b2b/login')
      return
    }
    if (orgId) load(orgId)
  }, [isLoading, profile, orgId, load, router])

  const handleTogglePublish = async () => {
    if (!orgId || !course) return
    const isPublished = course.status === 'PUBLISHED'
    setPublishing(true)
    try {
      await apiClient.publishOrgCourse(orgId, courseId, !isPublished)
      setCourse((prev) => (prev ? { ...prev, status: isPublished ? 'DRAFT' : 'PUBLISHED' } : prev))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Ошибка', { type: 'error' })
    } finally {
      setPublishing(false)
    }
  }

  const handleSaveCourseSettings = async (data: Record<string, unknown>) => {
    if (!orgId) return
    await apiClient.updateOrgCourse(orgId, courseId, data)
    setCourse((prev) => (prev ? ({ ...prev, ...data } as FullCourse) : prev))
    setSettingsOpen(false)
  }

  // --- Module CRUD ---
  const handleSaveModule = async (data: Partial<CourseModule>) => {
    if (!orgId) return
    if (data.id) {
      await apiClient.updateCourseModule(orgId, courseId, data.id, {
        title: data.title,
        description: data.description,
      })
      setCourse((prev) =>
        prev
          ? {
              ...prev,
              modules: prev.modules.map((m) => (m.id === data.id ? { ...m, ...data } : m)),
            }
          : prev
      )
    } else {
      const order = course ? course.modules.length + 1 : 1
      const modulePayload = {
        title: data.title!,
        description: data.description ?? undefined,
        order,
      }
      const res = await apiClient.createCourseModule(orgId, courseId, modulePayload)
      setCourse((prev) =>
        prev
          ? {
              ...prev,
              modules: [
                ...prev.modules,
                {
                  id: res.id,
                  title: modulePayload.title,
                  description: modulePayload.description ?? null,
                  order,
                  lessonCount: 0,
                  lessons: [],
                },
              ],
            }
          : prev
      )
    }
    setModuleModal(null)
  }

  const handleDeleteModule = async (mod: CourseModule) => {
    if (!orgId) return
    const ok = await confirm(`Удалить модуль «${mod.title}» и все его уроки?`)
    if (!ok) return
    await apiClient.deleteCourseModule(orgId, courseId, mod.id)
    setCourse((prev) =>
      prev ? { ...prev, modules: prev.modules.filter((m) => m.id !== mod.id) } : prev
    )
  }

  const handleReorderModules = async (modules: (CourseModule & { lessons: Lesson[] })[]) => {
    if (!orgId) return
    setCourse((prev) => (prev ? { ...prev, modules } : prev))
    try {
      await apiClient.reorderCourseModules(
        orgId,
        courseId,
        modules.map((m) => m.id)
      )
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не удалось сохранить порядок модулей', {
        type: 'error',
      })
      load(orgId)
    }
  }

  const handleReorderLessons = async (moduleId: string, lessons: Lesson[]) => {
    if (!orgId) return
    setCourse((prev) =>
      prev
        ? { ...prev, modules: prev.modules.map((m) => (m.id === moduleId ? { ...m, lessons } : m)) }
        : prev
    )
    try {
      await apiClient.reorderCourseLessons(
        orgId,
        courseId,
        moduleId,
        lessons.map((l) => l.id)
      )
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не удалось сохранить порядок уроков', {
        type: 'error',
      })
      load(orgId)
    }
  }

  const handleModuleDrop = (toIndex: number) => {
    const fromIndex = dragModuleFrom.current
    dragModuleFrom.current = null
    setDragModuleOverIndex(null)
    if (fromIndex === null || fromIndex === toIndex || !course) return
    handleReorderModules(moveItem(course.modules, fromIndex, toIndex))
  }

  // --- Lesson CRUD ---
  const handleSaveLesson = async (moduleId: string, data: Partial<Lesson>) => {
    if (!orgId) return
    const targetModule = course?.modules.find((m) => m.id === moduleId)
    const fallbackOrder = targetModule?.lessons.length ?? 0
    const payload = buildLessonPayload(data, fallbackOrder)

    if (data.id) {
      await apiClient.updateCourseLesson(orgId, courseId, moduleId, data.id, payload)
      setCourse((prev) =>
        prev
          ? {
              ...prev,
              modules: prev.modules.map((m) =>
                m.id === moduleId
                  ? {
                      ...m,
                      lessons: m.lessons.map((l) =>
                        l.id === data.id ? ({ ...l, ...payload } as Lesson) : l
                      ),
                    }
                  : m
              ),
            }
          : prev
      )
    } else {
      const res = await apiClient.createCourseLesson(orgId, courseId, moduleId, payload)
      setCourse((prev) =>
        prev
          ? {
              ...prev,
              modules: prev.modules.map((m) =>
                m.id === moduleId
                  ? {
                      ...m,
                      lessons: [...m.lessons, { id: res.id, ...payload } as Lesson],
                    }
                  : m
              ),
            }
          : prev
      )
    }
    setLessonModal(null)
  }

  const handleDeleteLesson = async (moduleId: string, lesson: Lesson) => {
    if (!orgId) return
    const ok = await confirm(`Удалить урок «${lesson.title}»?`)
    if (!ok) return
    await apiClient.deleteCourseLesson(orgId, courseId, moduleId, lesson.id)
    setCourse((prev) =>
      prev
        ? {
            ...prev,
            modules: prev.modules.map((m) =>
              m.id === moduleId
                ? {
                    ...m,
                    lessons: m.lessons.filter((l) => l.id !== lesson.id),
                  }
                : m
            ),
          }
        : prev
    )
  }

  if (isLoading || loading) return <PageSpinner />
  if (!course) return null

  const isPublished = course.status === 'PUBLISHED'
  const totalLessons = course.modules.reduce((s, m) => s + m.lessons.length, 0)

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <Link
            href={`/b2b/video-courses${orgId ? `?orgId=${orgId}` : ''}`}
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3"
          >
            <ArrowLeft className="w-4 h-4" /> Назад к курсам
          </Link>
          <h2 className="text-2xl font-bold text-gray-900">{course.title}</h2>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${isPublished ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-700'}`}
            >
              {isPublished ? 'Опубликован' : 'Черновик'}
            </span>
            <span className="text-sm text-gray-500">
              {course.modules.length} модулей · {totalLessons} уроков
            </span>
          </div>
        </div>
        {isAdmin && (
          <div className="flex gap-2 flex-wrap shrink-0">
            <button
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <Pencil className="w-4 h-4" /> Редактировать
            </button>
            <button
              onClick={handleTogglePublish}
              disabled={publishing}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                isPublished
                  ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                  : 'bg-green-600 text-white hover:bg-green-700'
              } disabled:opacity-60`}
            >
              {publishing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isPublished ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
              {isPublished ? 'Снять с публикации' : 'Опубликовать'}
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Modules + lessons */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary-500" /> Программа курса
            </h3>
            {isAdmin && (
              <button
                onClick={() => setModuleModal({ mod: null })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Модуль
              </button>
            )}
          </div>

          {course.modules.length === 0 ? (
            <div className="text-center py-16 bg-white border border-dashed border-gray-300 rounded-xl">
              <BookOpen className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm mb-4">Нет модулей. Добавьте первый модуль.</p>
              {isAdmin && (
                <button
                  onClick={() => setModuleModal({ mod: null })}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
                >
                  <Plus className="w-4 h-4" /> Добавить модуль
                </button>
              )}
            </div>
          ) : (
            course.modules.map((mod, idx) => (
              <div
                key={mod.id}
                onDragOver={(e) => {
                  if (dragModuleFrom.current === null) return
                  e.preventDefault()
                  if (dragModuleOverIndex !== idx) setDragModuleOverIndex(idx)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  handleModuleDrop(idx)
                }}
                className={dragModuleOverIndex === idx ? 'rounded-xl ring-2 ring-primary-300' : ''}
              >
                <ModuleBlock
                  mod={mod}
                  orgId={orgId ?? ''}
                  courseId={courseId}
                  isAdmin={isAdmin}
                  isDragging={dragModuleFrom.current === idx}
                  onDeleteModule={handleDeleteModule}
                  onAddLesson={(modId) => setLessonModal({ moduleId: modId, lesson: null })}
                  onDeleteLesson={handleDeleteLesson}
                  onEditLesson={(modId, l) => setLessonModal({ moduleId: modId, lesson: l })}
                  onEditModule={(m) => setModuleModal({ mod: m })}
                  onReorderLessons={handleReorderLessons}
                  onDragHandleStart={() => {
                    dragModuleFrom.current = idx
                  }}
                  onDragEnd={() => {
                    dragModuleFrom.current = null
                    setDragModuleOverIndex(null)
                  }}
                />
              </div>
            ))
          )}
        </div>

        {/* Sidebar info */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h4 className="font-semibold text-gray-800 mb-3 text-sm flex items-center gap-2">
              <Settings className="w-4 h-4 text-gray-400" /> Параметры курса
            </h4>
            <dl className="space-y-2 text-sm">
              {[
                { label: 'Категория', value: course.category || '—' },
                { label: 'Уровень', value: course.difficulty || '—' },
                { label: 'Возраст', value: course.ageRange || '—' },
                { label: 'Для кого', value: course.targetAudience || '—' },
                {
                  label: 'Доступ',
                  value:
                    course.accessPolicy === 'PAID'
                      ? `Платно · ${course.price} ${course.currency}`
                      : 'Бесплатно',
                },
                {
                  label: 'Видимость',
                  value: course.visibility === 'PUBLIC' ? 'Маркетплейс' : 'Только организация',
                },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between gap-2">
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="text-gray-900 font-medium text-right">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h4 className="font-semibold text-gray-800 mb-2 text-sm">Описание</h4>
            <p className="text-sm text-gray-600 leading-relaxed">{course.description || '—'}</p>
            {course.tags && course.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {course.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {settingsOpen && (
        <CourseSettingsModal
          course={course}
          onSave={handleSaveCourseSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {moduleModal && (
        <ModuleModal
          mod={moduleModal.mod}
          onSave={handleSaveModule}
          onClose={() => setModuleModal(null)}
        />
      )}
      {lessonModal && orgId && (
        <LessonModal
          moduleId={lessonModal.moduleId}
          orgId={orgId}
          lesson={lessonModal.lesson}
          onSave={handleSaveLesson}
          onClose={() => setLessonModal(null)}
        />
      )}
    </div>
  )
}

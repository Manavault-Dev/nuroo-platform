'use client'

import { useCallback, useEffect, useState } from 'react'
import { Link } from '@/i18n/navigation'
import { usePageAuth } from '@/lib/b2b/usePageAuth'
import { apiClient } from '@/lib/b2b/api'
import type { Course } from '@/lib/b2b/types/course'
import { isPublishedCourse, isPublicCourse, STATUS_COLORS } from '@/lib/b2b/types/course'
import { BookOpen, Plus, Video, Users, Globe, Lock, Eye, EyeOff, Trash2 } from 'lucide-react'
import { PageSpinner } from '@/components/ui/Spinner'
import { useAlert } from '@/components/ui/AlertDialog'
import { useRouter } from '@/i18n/navigation'
import { useRef } from 'react'

function CourseCard({
  course,
  orgId,
  isAdmin,
  onDelete,
  onTogglePublish,
}: {
  course: Course
  orgId: string
  isAdmin: boolean
  onDelete: (c: Course) => void
  onTogglePublish: (c: Course) => void
}) {
  const isPublished = isPublishedCourse(course)
  const isPublic = isPublicCourse(course)
  const statusColor = STATUS_COLORS[course.status] ?? 'bg-gray-100 text-gray-600'

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-primary-300 transition-all group flex flex-col">
      {/* Cover */}
      <Link href={`/b2b/video-courses/${course.id}?orgId=${orgId}`}>
        <div className="relative h-44 rounded-t-xl overflow-hidden bg-gradient-to-br from-primary-50 to-teal-100">
          {course.coverUrl || course.coverImageUrl ? (
            <img
              src={course.coverUrl ?? course.coverImageUrl ?? ''}
              alt={course.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <Video className="w-12 h-12 text-primary-300" />
            </div>
          )}
          <span
            className={`absolute top-2 left-2 px-2 py-0.5 text-xs font-semibold rounded-full ${statusColor}`}
          >
            {isPublished ? 'Опубликован' : 'Черновик'}
          </span>
          <span
            className={`absolute top-2 right-2 px-2 py-0.5 text-xs font-semibold rounded-full flex items-center gap-1 ${isPublic ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}
          >
            {isPublic ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
            {isPublic ? 'Маркетплейс' : 'Только орг.'}
          </span>
        </div>
      </Link>

      {/* Info */}
      <div className="p-4 flex flex-col flex-1">
        <Link href={`/b2b/video-courses/${course.id}?orgId=${orgId}`} className="flex-1">
          <h3 className="font-semibold text-gray-900 line-clamp-2 group-hover:text-primary-600 transition-colors">
            {course.title}
          </h3>
          <p className="text-sm text-gray-500 mt-1 line-clamp-2">{course.description}</p>
        </Link>

        <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <BookOpen className="w-3.5 h-3.5" />
            {course.moduleCount} модулей
          </span>
          <span className="flex items-center gap-1">
            <Video className="w-3.5 h-3.5" />
            {course.lessonCount} уроков
          </span>
          <span className="flex items-center gap-1">
            <Users className="w-3.5 h-3.5" />
            {course.enrollmentCount}
          </span>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-primary-600">
            {course.price === 0
              ? 'Бесплатно'
              : `${course.price.toLocaleString()} ${course.currency}`}
          </span>
          {isAdmin && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => onTogglePublish(course)}
                className={`p-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors ${
                  isPublished
                    ? 'text-amber-700 bg-amber-50 hover:bg-amber-100'
                    : 'text-green-700 bg-green-50 hover:bg-green-100'
                }`}
                title={isPublished ? 'Снять с публикации' : 'Опубликовать'}
              >
                {isPublished ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => onDelete(course)}
                className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                title="Удалить"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function VideoCoursesPage() {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router

  const { profile, orgId, isAdmin, isLoading } = usePageAuth()
  const { alert, confirm } = useAlert()

  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(false)

  const loadCourses = useCallback(async (oid: string) => {
    setLoading(true)
    try {
      const res = await apiClient.getOrgCourses(oid)
      setCourses(res.courses ?? [])
    } catch {
      setCourses([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isLoading) return
    if (!profile) {
      routerRef.current.push('/b2b/login')
      return
    }
    if (orgId) loadCourses(orgId)
  }, [isLoading, profile, orgId, loadCourses])

  const handleDelete = async (course: Course) => {
    if (!orgId) return
    const ok = await confirm(`Удалить курс «${course.title}»? Это действие необратимо.`)
    if (!ok) return
    try {
      await apiClient.deleteOrgCourse(orgId, course.id)
      setCourses((prev) => prev.filter((c) => c.id !== course.id))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не удалось удалить курс', { type: 'error' })
    }
  }

  const handleTogglePublish = async (course: Course) => {
    if (!orgId) return
    const isPublished = isPublishedCourse(course)
    try {
      await apiClient.publishOrgCourse(orgId, course.id, !isPublished)
      setCourses((prev) =>
        prev.map((c) =>
          c.id === course.id ? { ...c, status: isPublished ? 'DRAFT' : 'PUBLISHED' } : c
        )
      )
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не удалось обновить статус', { type: 'error' })
    }
  }

  if (isLoading || loading) return <PageSpinner />

  const published = courses.filter(isPublishedCourse)
  const drafts = courses.filter((c) => !isPublishedCourse(c))

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Видеокурсы</h2>
          <p className="text-gray-500 mt-1 text-sm">
            Создавайте предзаписанные курсы как на Udemy — модули, уроки, видео
          </p>
        </div>
        {isAdmin && (
          <Link
            href={`/b2b/video-courses/new${orgId ? `?orgId=${orgId}` : ''}`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Новый курс
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          {
            label: 'Всего курсов',
            value: courses.length,
            icon: BookOpen,
            color: 'text-primary-600 bg-primary-50',
          },
          {
            label: 'Опубликовано',
            value: published.length,
            icon: Eye,
            color: 'text-green-600 bg-green-50',
          },
          {
            label: 'Черновики',
            value: drafts.length,
            icon: EyeOff,
            color: 'text-amber-600 bg-amber-50',
          },
          {
            label: 'Всего учеников',
            value: courses.reduce((s, c) => s + c.enrollmentCount, 0),
            icon: Users,
            color: 'text-blue-600 bg-blue-50',
          },
        ].map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3"
          >
            <div className={`p-2 rounded-lg ${color}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-xl font-bold text-gray-900">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Courses grid */}
      {courses.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-100">
          <Video className="w-14 h-14 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 mb-2">Нет видеокурсов</h3>
          <p className="text-gray-400 text-sm mb-6">
            Создайте первый предзаписанный курс — модули, уроки и видео
          </p>
          {isAdmin && (
            <Link
              href={`/b2b/video-courses/new${orgId ? `?orgId=${orgId}` : ''}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              Создать первый курс
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {courses.map((course) => (
            <CourseCard
              key={course.id}
              course={course}
              orgId={orgId ?? ''}
              isAdmin={isAdmin}
              onDelete={handleDelete}
              onTogglePublish={handleTogglePublish}
            />
          ))}
        </div>
      )}
    </div>
  )
}

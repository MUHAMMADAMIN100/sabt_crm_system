import { lazy, Suspense } from 'react'
import { useAuthStore } from '@/store/auth.store'
import { isDevDirector } from '@/lib/permissions'
import { PageLoader } from '@/components/ui'

/**
 * Раздел «Задачи» показывает разное в зависимости от того, кто смотрит.
 *
 *  · Исполнитель — кабинет поручений «Задачи от руководителя»: что мне
 *    выдали и что я выдал, статус в один клик.
 *  · Руководитель направления — полноценный список задач своей сферы:
 *    фильтры по статусу/приоритету/исполнителю, создание, массовые
 *    действия, экспорт. Без него руководитель не видел, на каком этапе
 *    идёт работа команды: кабинет поручений показывает только личные.
 */
const ManagementTasksPage = lazy(() => import('./ManagementTasksPage'))
const TasksPage = lazy(() => import('./TasksPage'))

export default function TasksRoute() {
  const user = useAuthStore(s => s.user)
  const Page = isDevDirector(user) ? TasksPage : ManagementTasksPage
  return (
    <Suspense fallback={<PageLoader />}>
      <Page />
    </Suspense>
  )
}

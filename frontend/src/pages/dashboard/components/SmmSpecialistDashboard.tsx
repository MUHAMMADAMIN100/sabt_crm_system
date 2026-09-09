import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { projectsApi, contentPlanApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { Film, Image as ImageIcon, Palette, Camera } from 'lucide-react'
import { format, addDays } from 'date-fns'
import { ru } from 'date-fns/locale'
import clsx from 'clsx'
import StorymakerDashboard from './StorymakerDashboard'

/** Тип задачи контент-плана → иконка + подпись. Публикации, съёмки и
 *  задачи подготовки (съёмка под рилс / дизайн под пост) сводятся к единому виду. */
function taskMeta(e: any): { Icon: any; tag: string; cls: string } {
  if (e.kind === 'shoot') {
    // Задача подготовки: под рилс — «Съёмка», под пост — «Дизайн»; ручная съёмка — «Съёмка».
    if (e.parentKind === 'post') return { Icon: Palette, tag: 'Дизайн', cls: 'text-fuchsia-500 dark:text-fuchsia-400 bg-fuchsia-50 dark:bg-fuchsia-900/20' }
    return { Icon: Camera, tag: 'Съёмка', cls: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20' }
  }
  if (e.contentType === 'reel') return { Icon: Film, tag: 'Рилс', cls: 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20' }
  return { Icon: ImageIcon, tag: 'Публикация', cls: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20' }
}

function taskTitle(e: any): string {
  if (e.kind === 'shoot') return (e.title && e.title.trim()) || (e.parentKind === 'post' ? 'Дизайн макета' : 'Съёмка')
  return (e.topic && e.topic.trim()) || 'Без названия'
}

/**
 * Главная SMM-специалиста:
 *  • «Главные задачи» — контент-план его проектов (Просрочено / Сегодня / На неделе);
 *  • ниже — полный инструмент сторис (бывший сторисмейкер, StorymakerDashboard):
 *    KPI по сторис + «Нужно сегодня» + календарь отметок. Сторисмейкер как роль
 *    упразднён — за сторисы отвечают SMM-специалисты.
 */
export default function SmmSpecialistDashboard() {
  const user = useAuthStore(s => s.user)
  const today = format(new Date(), 'yyyy-MM-dd')
  // Окно задач: захватываем просрочку за месяц и неделю вперёд.
  const winFrom = format(addDays(new Date(), -31), 'yyyy-MM-dd')
  const winTo = format(addDays(new Date(), 8), 'yyyy-MM-dd')

  const { data: projectsList } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list() })
  const { data: cal } = useQuery({
    queryKey: ['smm-cal-home', winFrom, winTo],
    queryFn: () => contentPlanApi.smmCalendar({ from: winFrom, to: winTo }),
  })

  // Мои SMM-проекты: я в составе, менеджер или назначенный специалист.
  const myProjects = useMemo(() => {
    const all = (projectsList || []).filter((p: any) => !p.isArchived && (p.projectType || 'SMM') === 'SMM')
    return all.filter((p: any) =>
      p.members?.some((m: any) => m.id === user?.id) ||
      p.managerId === user?.id ||
      p.manager?.id === user?.id ||
      (Array.isArray(p.smmData?.smmSpecialistIds) && p.smmData.smmSpecialistIds.includes(user?.id)),
    )
  }, [projectsList, user])
  const myProjectIds = useMemo(() => new Set(myProjects.map((p: any) => p.id)), [myProjects])

  // ── Задачи из контент-плана (мои проекты, не сторис, не выполненные) ──
  const tasks = useMemo(() => {
    const events: any[] = (cal?.events || []).filter((e: any) =>
      myProjectIds.has(e.projectId) &&
      e.date &&
      e.contentType !== 'story' &&
      e.status !== 'published' && e.status !== 'cancelled',
    )
    const over: any[] = [], now: any[] = [], week: any[] = []
    const weekEnd = format(addDays(new Date(), 7), 'yyyy-MM-dd')
    for (const e of events) {
      if (e.date < today) over.push(e)
      else if (e.date === today) now.push(e)
      else if (e.date <= weekEnd) week.push(e)
    }
    const byDate = (a: any, b: any) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
    return { over: over.sort(byDate), now: now.sort(byDate), week: week.sort(byDate) }
  }, [cal, myProjectIds, today])

  const totalTasks = tasks.over.length + tasks.now.length + tasks.week.length

  const colorById = useMemo(() => {
    const m: Record<string, string> = {}
    myProjects.forEach((p: any) => { m[p.id] = p.color || '#6d8bf5' })
    return m
  }, [myProjects])

  const TaskRow = ({ e, danger }: { e: any; danger?: boolean }) => {
    const { Icon, tag, cls } = taskMeta(e)
    const d = new Date(e.date + 'T00:00:00')
    return (
      <Link
        to="/smm"
        className="flex items-center gap-3 p-2.5 rounded-xl bg-surface-50 dark:bg-surface-800/50 hover:bg-surface-100 dark:hover:bg-surface-700/60 border border-surface-100 dark:border-surface-700/60 transition-colors group"
      >
        <div className={clsx('w-8 h-8 rounded-lg shrink-0 flex items-center justify-center', cls)}>
          <Icon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-surface-900 dark:text-surface-100 truncate">{taskTitle(e)}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={clsx('text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded', cls)}>{tag}</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-surface-400 dark:text-surface-500 truncate">
              <i className="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={{ backgroundColor: colorById[e.projectId] }} />
              {e.projectName}
            </span>
          </div>
        </div>
        <span className={clsx(
          'text-[11px] font-semibold shrink-0',
          danger ? 'text-red-500 dark:text-red-400'
            : e.date === today ? 'text-primary-600 dark:text-primary-400'
            : 'text-surface-400 dark:text-surface-500',
        )}>
          {e.date === today ? 'Сегодня' : format(d, 'd MMM', { locale: ru })}
        </span>
      </Link>
    )
  }

  const Group = ({ label, items, danger }: { label: string; items: any[]; danger?: boolean }) => {
    if (!items.length) return null
    return (
      <div className="mb-1">
        <div className={clsx(
          'flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide mb-2 mt-3 first:mt-0',
          danger ? 'text-red-500 dark:text-red-400' : 'text-surface-400 dark:text-surface-500',
        )}>
          {label}
          <span className={clsx('rounded-full px-1.5 text-[10px]', danger ? 'bg-red-50 dark:bg-red-900/20' : 'bg-surface-100 dark:bg-surface-700')}>
            {items.length}
          </span>
        </div>
        <div className="space-y-2">
          {items.map((e: any) => <TaskRow key={e.id} e={e} danger={danger} />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Главные задачи ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-surface-900 dark:text-surface-100">Главные задачи</h2>
          <Link to="/smm" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Контент-план →</Link>
        </div>
        {totalTasks === 0 ? (
          <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-10">На ближайшую неделю задач нет 🎉</p>
        ) : (
          <>
            <Group label="Просрочено" items={tasks.over} danger />
            <Group label="Сегодня" items={tasks.now} />
            <Group label="На неделе" items={tasks.week} />
          </>
        )}
      </div>

      {/* ── Сторис — полный инструмент (бывший сторисмейкер): KPI + «Нужно
             сегодня» + календарь отметок по всем SMM-проектам. ── */}
      <StorymakerDashboard />
    </div>
  )
}

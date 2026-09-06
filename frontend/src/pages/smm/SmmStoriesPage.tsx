// «Сторисы» — отдельная подстраница СММ: мини-календари по проектам за месяц.
// Раньше это был таб внутри «Умного календаря»; вынесено в свой роут /smm/stories.
import { useMemo, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { addMonths, startOfMonth, endOfMonth, format } from 'date-fns'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { contentPlanApi } from '@/services/api.service'
import { StoriesTab, buildCells, monthTitle, assignProjectColors, type Ev, type SDay } from './SmmPage'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
// Проект со страницы «Сторисы»: месячная/дневная норма сторис (цель) + окно, когда проект ждёт сторис.
type StoryProj = { id: string; name: string; storiesPerMonth?: number | null; storiesPerDay?: number | null; since?: string | null; endDate?: string | null }
// Фактически опубликовано за день (поле count с бэка; фолбэк — парсинг «Сторис ×N» из topic).
const storyCount = (e: Ev): number => {
  if (typeof e.count === 'number') return e.count
  const m = /×\s*(\d+)/.exec(e.topic || '')
  return m ? Number(m[1]) : 0
}

export default function SmmStoriesPage() {
  const navigate = useNavigate()
  const [cursor, setCursor] = useState(new Date())
  const monthStr = format(cursor, 'yyyy-MM')
  const from = iso(startOfMonth(cursor))
  const to = iso(endOfMonth(cursor))

  const { data, isLoading } = useQuery({
    queryKey: ['smm-calendar', from, to],
    queryFn: () => contentPlanApi.smmCalendar({ from, to }),
    placeholderData: keepPreviousData,
  })
  const allEvents: Ev[] = data?.events ?? []
  const projects = (data?.projects ?? []) as StoryProj[]
  const today = new Date().toLocaleDateString('en-CA')

  // Цвета проектов — тот же модульный map, что и в календаре (единые цвета).
  const projIds = useMemo(() => {
    const s = new Set<string>()
    for (const p of projects) s.add(String(p.id))
    for (const e of allEvents) if (e.projectId) s.add(String(e.projectId))
    return [...s].sort()
  }, [projects, allEvents])
  useMemo(() => assignProjectColors(projIds), [projIds.join(',')])

  const cells = useMemo(() => buildCells(monthStr), [monthStr])

  // Факт: проект → дата → сколько сторис опубликовано (только сторис, остальные типы игнорируем).
  const actualByProject = useMemo(() => {
    const m = new Map<string, Map<string, number>>()
    for (const e of allEvents) {
      if (!(e.kind === 'publication' && e.contentType === 'story')) continue
      if (!m.has(e.projectId)) m.set(e.projectId, new Map())
      const dm = m.get(e.projectId)!
      dm.set(e.date, (dm.get(e.date) ?? 0) + storyCount(e))
    }
    return m
  }, [allEvents])

  // Статус дня: факт vs дневная норма (storiesPerDay, по умолч. 3) в окне [создан проекта .. сегодня].
  // done — норма достигнута; partial — что-то есть, но меньше нормы; none — плановый день без сторис.
  const statusByProject = useMemo(() => {
    const inMonthDates = cells.filter(c => c.inMonth && c.iso).map(c => c.iso as string)
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
    const res = new Map<string, Map<string, SDay>>()
    for (const p of projects) {
      // Цель на день: месячная норма делится равномерно на дни месяца; иначе дневная норма (по умолч. 3).
      const target = p.storiesPerMonth != null
        ? (p.storiesPerMonth > 0 ? Math.max(1, Math.round(p.storiesPerMonth / daysInMonth)) : 0)
        : (p.storiesPerDay ?? 3)
      const dm = new Map<string, SDay>()
      if (target > 0) {
        const actual = actualByProject.get(p.id) ?? new Map<string, number>()
        for (const date of inMonthDates) {
          if (date > today) continue                       // будущее — не оцениваем
          if (p.since && date < p.since) continue          // до появления проекта в системе
          if (p.endDate && date > p.endDate) continue      // после завершения проекта
          const n = actual.get(date) ?? 0
          if (n >= target) dm.set(date, 'done')
          else if (n > 0) dm.set(date, 'partial')
          else if (date < today) dm.set(date, 'none')      // прошедший плановый день без сторис; сегодня не «красним»
        }
      }
      res.set(p.id, dm)
    }
    return res
  }, [projects, actualByProject, cells, today, cursor])

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight">Сторисы · {monthTitle(monthStr)}</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setCursor(new Date())} className="text-[13px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">Сегодня</button>
          <div className="flex items-center gap-0.5">
            <button onClick={() => setCursor(c => addMonths(c, -1))} className="w-8 h-8 grid place-items-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><ChevronLeft size={17} /></button>
            <button onClick={() => setCursor(c => addMonths(c, 1))} className="w-8 h-8 grid place-items-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><ChevronRight size={17} /></button>
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="flex justify-center py-24"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : (
        <StoriesTab
          projects={projects.map(p => ({ id: p.id, name: p.name }))}
          cells={cells}
          statusByProject={statusByProject}
          today={today}
          monthLabel={monthTitle(monthStr)}
          activeIds={new Set<string>()}
          onPick={(id) => navigate(`/smm/projects/${id}`)}
        />
      )}
    </div>
  )
}

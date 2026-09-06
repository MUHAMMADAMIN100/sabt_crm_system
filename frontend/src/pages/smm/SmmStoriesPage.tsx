// «Сторисы» — отдельная подстраница СММ: мини-календари по проектам за месяц.
// Раньше это был таб внутри «Умного календаря»; вынесено в свой роут /smm/stories.
import { useMemo, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { addMonths, startOfMonth, endOfMonth, format } from 'date-fns'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { contentPlanApi } from '@/services/api.service'
import { StoriesTab, buildCells, monthTitle, assignProjectColors, type Ev } from './SmmPage'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

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
  const projects = (data?.projects ?? []) as { id: string; name: string }[]
  const today = new Date().toLocaleDateString('en-CA')

  // Цвета проектов — тот же модульный map, что и в календаре (единые цвета).
  const projIds = useMemo(() => {
    const s = new Set<string>()
    for (const p of projects) s.add(String(p.id))
    for (const e of allEvents) if (e.projectId) s.add(String(e.projectId))
    return [...s].sort()
  }, [projects, allEvents])
  useMemo(() => assignProjectColors(projIds), [projIds.join(',')])

  // Проект → дата → события (для точек в мини-календарях).
  const byProject = useMemo(() => {
    const m = new Map<string, Map<string, Ev[]>>()
    for (const e of allEvents) {
      if (!m.has(e.projectId)) m.set(e.projectId, new Map())
      const dm = m.get(e.projectId)!
      if (!dm.has(e.date)) dm.set(e.date, [])
      dm.get(e.date)!.push(e)
    }
    return m
  }, [allEvents])

  const cells = useMemo(() => buildCells(monthStr), [monthStr])

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
          byProject={byProject}
          today={today}
          monthLabel={monthTitle(monthStr)}
          activeIds={new Set<string>()}
          onPick={(id) => navigate(`/smm/projects/${id}`)}
        />
      )}
    </div>
  )
}

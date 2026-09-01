import { useMemo, type ReactNode } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2, ChevronLeft, Film, Image as ImageIcon } from 'lucide-react'
import { contentPlanApi } from '@/services/api.service'
import { assignProjectColors, projColor, cycleBoundsFor, fmtCycleRange, type SmmProj } from './smmShared'

type Ev = { projectId: string }
type CalData = { projects: SmmProj[]; backlog: Ev[] }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-gray-100 dark:border-gray-800">
      <span className="text-sm text-gray-500">{k}</span>
      <span className="text-sm font-semibold text-right">{v}</span>
    </div>
  )
}

export default function SmmProjectPage() {
  const { id } = useParams<{ id: string }>()
  const now = new Date()
  const from = iso(new Date(now.getFullYear(), now.getMonth(), 1))
  const to = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0))

  const { data, isLoading } = useQuery<CalData>({
    queryKey: ['smm-calendar', from, to],
    queryFn: () => contentPlanApi.smmCalendar({ from, to }),
  })

  const projects = data?.projects ?? []
  const backlog = data?.backlog ?? []

  const info = useMemo(() => {
    assignProjectColors(projects.map(p => p.id))
    const p = projects.find(x => x.id === id)
    if (!p) return null
    const norm = (p.normReels ?? 0) + (p.normPosts ?? 0)
    const left = backlog.filter(b => b.projectId === p.id).length
    const placed = Math.max(0, norm - left)
    const cycle = p.cycleStartDay ? cycleBoundsFor(new Date(), p.cycleStartDay) : null
    return { p, color: projColor(p.id), norm, left, placed, cycle }
  }, [projects, backlog, id])

  if (isLoading) return <div className="flex justify-center py-24"><Loader2 className="animate-spin text-gray-400" /></div>
  if (!info) return (
    <div className="space-y-4">
      <Link to="/smm/projects" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ChevronLeft size={16} /> Проекты</Link>
      <p className="text-gray-400">Проект не найден.</p>
    </div>
  )

  const { p, color, norm, left, placed, cycle } = info
  return (
    <div className="space-y-5 max-w-2xl">
      <Link to="/smm/projects" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ChevronLeft size={16} /> Проекты</Link>
      <div className="flex items-center gap-3">
        <span className="w-4 h-4 rounded-full shrink-0" style={{ background: color }} />
        <h1 className="text-2xl font-bold tracking-tight">{p.name}</h1>
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-5 py-2">
        <Row k="День старта цикла" v={p.cycleStartDay ? `${p.cycleStartDay}-е число` : '—'} />
        <Row k="Текущий цикл" v={cycle ? fmtCycleRange(cycle.start, cycle.end) : '—'} />
        <Row k="Норма за цикл" v={norm > 0
          ? <span className="inline-flex items-center gap-3" style={{ color }}>
              <span className="inline-flex items-center gap-1"><Film size={15} /> {p.normReels ?? 0}</span>
              <span className="inline-flex items-center gap-1"><ImageIcon size={15} /> {p.normPosts ?? 0}</span>
            </span>
          : '—'} />
        <Row k="Запланировано в календаре" v={norm > 0 ? `${placed} из ${norm}` : '—'} />
        <Row k="Осталось в «Не запланировано»" v={left} />
      </div>
    </div>
  )
}

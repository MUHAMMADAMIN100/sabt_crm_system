import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Film, Image as ImageIcon, CalendarRange } from 'lucide-react'
import { contentPlanApi } from '@/services/api.service'
import { assignProjectColors, projColor, type SmmProj } from './smmShared'

type Ev = { projectId: string }
type CalData = { projects: SmmProj[]; backlog: Ev[] }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function SmmProjectsPage() {
  const navigate = useNavigate()
  const now = new Date()
  const from = iso(new Date(now.getFullYear(), now.getMonth(), 1))
  const to = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0))

  const { data, isLoading } = useQuery<CalData>({
    queryKey: ['smm-calendar', from, to],
    queryFn: () => contentPlanApi.smmCalendar({ from, to }),
  })

  const projects = data?.projects ?? []
  const backlog = data?.backlog ?? []

  const cards = useMemo(() => {
    assignProjectColors(projects.map(p => p.id))
    const backlogBy = new Map<string, number>()
    for (const b of backlog) backlogBy.set(b.projectId, (backlogBy.get(b.projectId) ?? 0) + 1)
    return projects.map(p => {
      const norm = (p.normReels ?? 0) + (p.normPosts ?? 0)
      return {
        id: p.id, name: p.name, color: projColor(p.id),
        day: p.cycleStartDay ?? null,
        reels: p.normReels ?? 0, posts: p.normPosts ?? 0,
        norm, left: backlogBy.get(p.id) ?? 0,
      }
    })
  }, [projects, backlog])

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Проекты</h1>
      {isLoading ? (
        <div className="flex justify-center py-24"><Loader2 className="animate-spin text-gray-400" /></div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {cards.map(c => (
            <button key={c.id} type="button" onClick={() => navigate(`/smm/projects/${c.id}`)}
              className="text-left rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 transition hover:border-gray-300 dark:hover:border-gray-600">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color }} />
                <span className="text-[15px] font-bold truncate">{c.name}</span>
                <span className="ml-auto text-[12px] font-bold tabular-nums shrink-0" style={{ color: c.color }}>
                  {c.norm > 0 ? `${c.norm}/${c.left}` : '—'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-1 rounded-lg"
                  style={c.day ? { background: `color-mix(in srgb, ${c.color} 14%, transparent)`, color: c.color } : { background: 'rgba(128,128,128,0.12)', color: 'rgb(156,163,175)' }}>
                  <CalendarRange size={13} /> {c.day ? `цикл с ${c.day}-го` : 'цикл не задан'}
                </span>
                {c.norm > 0 && <>
                  <span className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-1 rounded-lg" style={{ background: `color-mix(in srgb, ${c.color} 14%, transparent)`, color: c.color }}><Film size={13} /> {c.reels}</span>
                  <span className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-1 rounded-lg" style={{ background: `color-mix(in srgb, ${c.color} 14%, transparent)`, color: c.color }}><ImageIcon size={13} /> {c.posts}</span>
                </>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

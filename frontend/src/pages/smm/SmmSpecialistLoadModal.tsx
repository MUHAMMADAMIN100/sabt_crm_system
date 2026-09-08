import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { projectsApi } from '@/services/api.service'
import { Avatar } from '@/components/ui'
import { projColor } from './smmShared'
import { X, Network, Loader2 } from 'lucide-react'

type Proj = { id: string; name: string }
type Spec = { id: string; name: string; avatar: string | null; projects: Proj[] }
type LoadData = { specialists: Spec[]; unassigned: Proj[] }

/**
 * Схема «кто ведёт какие проекты» (Вариант B — доска нагрузки): карточка на
 * каждого SMM-специалиста с полоской-нагрузкой (сколько проектов относительно
 * самого загруженного) и списком его проектов; отдельной жёлтой карточкой —
 * непривязанные проекты (нужен специалист). Цвета проектов совпадают с сеткой
 * «Проекты» (общая палитра projColor).
 */
export default function SmmSpecialistLoadModal({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = useQuery<LoadData>({
    queryKey: ['smm-specialist-load'],
    queryFn: () => projectsApi.smmSpecialistLoad(),
  })
  const specialists = data?.specialists ?? []
  const unassigned = data?.unassigned ?? []
  const maxLoad = useMemo(
    () => Math.max(1, ...specialists.map(s => s.projects.length), unassigned.length),
    [specialists, unassigned],
  )

  const chip = (p: Proj) => (
    <div key={p.id} className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 px-2.5 py-2">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: projColor(p.id) }} />
      <span className="text-[12.5px] font-semibold text-gray-700 dark:text-gray-200 truncate">{p.name}</span>
    </div>
  )

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 sm:p-8 overflow-y-auto">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-5xl rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="w-9 h-9 rounded-xl bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 flex items-center justify-center"><Network size={18} /></div>
          <div className="min-w-0">
            <h2 className="text-[16px] font-bold text-gray-900 dark:text-gray-100">СММ-специалисты и проекты</h2>
            <p className="text-xs text-gray-400">кто какие проекты ведёт</p>
          </div>
          <button onClick={onClose} className="ml-auto w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-center"><X size={16} /></button>
        </div>

        <div className="p-5 max-h-[76vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-20"><Loader2 className="animate-spin text-gray-400" /></div>
          ) : specialists.length === 0 && unassigned.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-16">Нет данных</p>
          ) : (
            <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
              {specialists.map(s => (
                <div key={s.id} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <Avatar name={s.name} src={s.avatar || undefined} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-bold text-gray-900 dark:text-gray-100 truncate">{s.name}</p>
                      <p className="text-[11px] text-gray-400">SMM-специалист</p>
                    </div>
                    <span className="text-[13px] font-extrabold text-gray-500 dark:text-gray-400 tabular-nums">{s.projects.length}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden mb-3">
                    <div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.round(s.projects.length / maxLoad * 100)}%` }} />
                  </div>
                  <div className="space-y-2">
                    {s.projects.length
                      ? s.projects.map(chip)
                      : <p className="text-[11.5px] text-gray-400 text-center py-2">Нет проектов — свободен</p>}
                  </div>
                </div>
              ))}

              {unassigned.length > 0 && (
                <div className="rounded-2xl border border-dashed border-amber-300/60 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-900/10 p-4">
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center text-lg font-bold">?</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-bold text-amber-700 dark:text-amber-300">Не назначены</p>
                      <p className="text-[11px] text-amber-600/70 dark:text-amber-400/70">нужен специалист</p>
                    </div>
                    <span className="text-[13px] font-extrabold text-amber-600 dark:text-amber-400 tabular-nums">{unassigned.length}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-amber-100 dark:bg-amber-900/30 overflow-hidden mb-3">
                    <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.round(unassigned.length / maxLoad * 100)}%` }} />
                  </div>
                  <div className="space-y-2">{unassigned.map(chip)}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

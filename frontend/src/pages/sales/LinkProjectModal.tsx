// «Связать с существующим» (15.11.2026): заявка от продаж → уже заведённый
// проект того же направления (POST /sales/handoffs/:leadId/link). Проекты —
// из общего списка /projects; уже связанные с другим лидом — недоступны.
// Похожие по названию на лид — первыми.
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { Loader2, Search } from 'lucide-react'
import { Modal } from '@/components/ui'
import { projectsApi } from '@/services/api.service'
import { salesApi } from '@/services/sales.api'
import { invalidateSales } from '@/lib/salesQueries'
import { isDevProjectType, projectTypeLabel } from '@/lib/projectType'
import type { Handoff } from '@/types/sales'
import { DIRECTION_LABEL } from './salesFormat'

interface ProjectRow {
  id: string
  name: string
  projectType?: string | null
  leadId?: string | null
  status?: string | null
}

const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase()

export default function LinkProjectModal({ handoff, onClose }: { handoff: Handoff; onClose: () => void }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState('')

  const q = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
    staleTime: 30_000,
  })

  const projects = useMemo(() => {
    const all: ProjectRow[] = Array.isArray(q.data) ? q.data : []
    const lead = norm(handoff.leadName)
    const s = norm(search)
    return all
      .filter(p => (handoff.direction === 'smm' ? p.projectType === 'SMM' : isDevProjectType(p.projectType)))
      .filter(p => !s || norm(p.name).includes(s))
      .map(p => {
        const n = norm(p.name)
        return { ...p, similar: !!lead && !!n && (n.includes(lead) || lead.includes(n)) }
      })
      .sort((a, b) => Number(b.similar) - Number(a.similar) || a.name.localeCompare(b.name, 'ru'))
  }, [q.data, search, handoff.direction, handoff.leadName])

  const link = useMutation({
    mutationFn: () => salesApi.linkHandoff(handoff.leadId, picked),
    onSuccess: () => {
      invalidateSales(qc)
      qc.invalidateQueries({ queryKey: ['projects'] })
      toast.success('Проект связан с заявкой')
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось связать проект'),
  })

  return (
    <Modal open onClose={onClose} title="Связать с проектом" size="md">
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-surface-600 dark:text-surface-300">
          Заявка «{handoff.leadName}» · {DIRECTION_LABEL[handoff.direction]}. Выберите проект, который уже ведётся по этой сделке.
        </p>
        <label className="relative block">
          <span className="sr-only">Поиск проекта</span>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" aria-hidden="true" />
          <input className="input pl-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="Название проекта" autoFocus />
        </label>

        <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1">
          {q.isPending ? (
            <p className="flex items-center gap-2 text-sm text-surface-500 py-4" role="status"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Загружаем проекты…</p>
          ) : q.isError ? (
            <div className="flex items-center justify-between gap-3 py-3 text-sm text-surface-600 dark:text-surface-300" role="alert">
              Не удалось загрузить проекты.
              <button type="button" onClick={() => q.refetch()} className="btn-secondary min-h-[44px] lg:min-h-[36px]">Повторить</button>
            </div>
          ) : !projects.length ? (
            <p className="text-sm text-surface-500 py-4">
              {search ? 'Ничего не нашлось.' : `Проектов направления «${DIRECTION_LABEL[handoff.direction]}» пока нет.`}
            </p>
          ) : (
            <fieldset>
              <legend className="sr-only">Проект</legend>
              <ul className="flex flex-col gap-1.5">
                {projects.map(p => {
                  const taken = !!p.leadId && p.leadId !== handoff.leadId
                  return (
                    <li key={p.id}>
                      <label className={clsx('flex items-center gap-3 min-h-[44px] rounded-lg border px-3 py-2 text-sm',
                        taken ? 'opacity-50 cursor-not-allowed border-surface-200 dark:border-surface-700'
                          : picked === p.id ? 'border-primary-600 dark:border-surface-300 bg-surface-100 dark:bg-surface-700/60 cursor-pointer'
                          : 'border-surface-200 dark:border-surface-700 hover:bg-surface-100 dark:hover:bg-surface-700/40 cursor-pointer')}>
                        <input type="radio" name="link-project" value={p.id} checked={picked === p.id} disabled={taken}
                          onChange={() => setPicked(p.id)} className="shrink-0" />
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium text-surface-900 dark:text-surface-100 truncate">{p.name}</span>
                          <span className="block text-xs text-surface-500 dark:text-surface-400">
                            {projectTypeLabel(p.projectType)}{taken ? ' · уже связан с другой заявкой' : p.similar ? ' · похоже по названию' : ''}
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </fieldset>
          )}
        </div>

        <div className="flex flex-col-reverse xs:flex-row xs:justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost min-h-[44px] lg:min-h-[36px]">Отмена</button>
          <button type="button" onClick={() => link.mutate()} disabled={!picked || link.isPending}
            className="btn-primary min-h-[44px] lg:min-h-[36px] disabled:opacity-60">
            {link.isPending && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} Связать
          </button>
        </div>
      </div>
    </Modal>
  )
}

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { workflowApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import {
  STAGES, CardFormModal, GroupCardModal, WorkflowCardBadges, predictTransition,
} from '@/components/projects/workflowShared'
import { ClipboardList } from 'lucide-react'
import toast from 'react-hot-toast'

/**
 * «Мои карточки» — блок в кабинете исполнителя. Показывает производственные
 * карточки доски, где текущий пользователь назначен исполнителем (одиночные +
 * групповые). Данные карточки только для чтения — исполнитель может лишь
 * выполнить действие этапа (сменить статус).
 */
export default function MyWorkflowCards() {
  const qc = useQueryClient()
  const queryKey = ['workflow', 'my']
  const user = useAuthStore(s => s.user)
  const actor = { role: user?.role, secondaryRole: user?.secondaryRole, extraPermissions: user?.extraPermissions }

  const { data: cards = [] } = useQuery({ queryKey, queryFn: () => workflowApi.myCards() })
  const [editCard, setEditCard] = useState<any>(null)
  const [groupCard, setGroupCard] = useState<any>(null)

  const transitionMut = useMutation({
    mutationFn: ({ id, action, payload }: any) => workflowApi.transition(id, action, payload),
    onMutate: async ({ id, action, payload }: any) => {
      const current = (cards as any[]).find(c => c.id === id)
      const { patch, keepOpen } = predictTransition(current, action, payload)
      await qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData(queryKey)
      if (patch) {
        qc.setQueryData(queryKey, (old: any[] = []) => old.map(c => c.id === id ? { ...c, ...patch } : c))
        if (keepOpen) setEditCard((prev: any) => prev && prev.id === id ? { ...prev, ...patch } : prev)
      }
      if (!keepOpen) setEditCard(null)
      toast.success('Готово')
      return { previous }
    },
    onError: (e: any, _v: any, ctx: any) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous)
      toast.error(e?.response?.data?.message || 'Не удалось выполнить действие')
    },
    onSettled: (_d: any, _e: any, vars: any) => {
      qc.invalidateQueries({ queryKey })
      if (vars?.id) qc.invalidateQueries({ queryKey: ['workflow-events', vars.id] })
    },
  })

  const list = (cards as any[]) || []
  if (list.length === 0) return null

  const stageLabel = (k: string) => STAGES.find(s => s.key === k)?.label || k
  const open = (c: any) => {
    if (c.kind === 'reels' || c.kind === 'macros') setGroupCard(c)
    else setEditCard(c)
  }

  return (
    <div className="card animate-fade-up">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList size={16} className="text-primary-600" />
        <h3 className="font-semibold text-surface-900 dark:text-surface-100 text-sm">Мои карточки ({list.length})</h3>
      </div>
      <p className="text-[11px] text-surface-500 dark:text-surface-400 mb-3">
        Производственные карточки, где вы исполнитель. Откройте карточку и выполните действие этапа.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {list.map(c => (
          <button key={c.id} type="button" onClick={() => open(c)}
            className="text-left bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-3 space-y-2 hover:border-surface-400 dark:hover:border-surface-500 transition-colors">
            <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 leading-snug">{c.title}</p>
            <p className="text-[11px] text-primary-600 dark:text-primary-400 font-medium truncate">{c.project?.name || '—'}</p>
            <WorkflowCardBadges card={c} />
            <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface-100 text-surface-600 dark:bg-surface-700 dark:text-surface-300">
              {stageLabel(c.stage)}
            </span>
          </button>
        ))}
      </div>

      {editCard && (
        <CardFormModal
          open={!!editCard}
          card={editCard}
          stage={editCard.stage}
          project={{ id: editCard.projectId, name: editCard.project?.name }}
          actor={actor}
          transitioning={transitionMut.isPending}
          onClose={() => setEditCard(null)}
          onSubmit={() => {}}
          onTransition={(action: string, payload: any) => transitionMut.mutate({ id: editCard.id, action, payload })}
        />
      )}

      {groupCard && (
        <GroupCardModal
          card={groupCard}
          project={{ id: groupCard.projectId, name: groupCard.project?.name }}
          actor={actor}
          onClose={() => setGroupCard(null)}
          onSaved={() => { setGroupCard(null); qc.invalidateQueries({ queryKey }) }}
        />
      )}
    </div>
  )
}

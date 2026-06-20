import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { workflowApi, projectsApi } from '@/services/api.service'
import { ConfirmDialog, Avatar, PageLoader } from '@/components/ui'
import { Plus, LayoutGrid, SlidersHorizontal, Trash2, Eraser } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { useAuthStore } from '@/store/auth.store'
import {
  STAGES, shortRole, CardFormModal, AdCampaignModal, WorkflowCardBadges,
  DeadlineSettingsModal, ContentPlanModal, GroupCardModal,
} from '@/components/projects/workflowShared'

/**
 * Глобальная «Доска проектов» — производственный канбан со всех SMM-
 * проектов сразу. Те же возможности, что во вкладке «Процесс работы»
 * (движок переходов, журнал, реклама), но карточки со всех проектов.
 */
export default function ProjectsBoardPage() {
  const qc = useQueryClient()
  const queryKey = ['workflow', 'all']
  const user = useAuthStore(s => s.user)
  const actor = { role: user?.role, secondaryRole: user?.secondaryRole }

  const { data: cards, isLoading } = useQuery({
    queryKey,
    queryFn: () => workflowApi.listAll(),
  })

  const { data: projects } = useQuery({
    queryKey: ['projects', 'smm-for-board'],
    queryFn: () => projectsApi.list(),
  })
  const smmProjects = useMemo(
    () => (projects || []).filter((p: any) => p.projectType === 'SMM' && !p.isArchived),
    [projects],
  )

  const currentUserId = user?.id
  const [mineOnly, setMineOnly] = useState(false)

  const visibleCards = useMemo(
    () => (cards || []).filter((c: any) => !mineOnly || c.assigneeId === currentUserId),
    [cards, mineOnly, currentUserId],
  )

  const byStage = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const s of STAGES) map[s.key] = []
    for (const c of visibleCards) (map[c.stage] || (map[c.stage] = [])).push(c)
    for (const k of Object.keys(map)) {
      if (k === 'published') {
        map[k].sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime())
      } else {
        map[k].sort((a, b) => a.position - b.position)
      }
    }
    return map
  }, [visibleCards])

  const visibleStages = STAGES

  // ── Модалки ─────────────────────────────────────────────────────────
  const [editCard, setEditCard] = useState<any>(null)
  const [createStage, setCreateStage] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [adCard, setAdCard] = useState<any>(null)
  const [deadlinesOpen, setDeadlinesOpen] = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [kp, setKp] = useState<any>(null)          // 'new' | КП-карточка | null
  const [groupCard, setGroupCard] = useState<any>(null)
  const isBoss = ['admin', 'founder', 'co_founder', 'smm_director'].includes(user?.role || '')
  const showModal = !!editCard || !!createStage
  const closeModal = () => { setEditCard(null); setCreateStage(null) }
  // Открытие карточки по виду: КП → форма контент-плана, групповая → элементы.
  const openCard = (c: any) => {
    if (c.kind === 'kp') setKp(c)
    else if (c.kind === 'reels' || c.kind === 'macros') setGroupCard(c)
    else setEditCard(c)
  }

  const createMut = useMutation({
    mutationFn: ({ projectId, data }: any) => workflowApi.create(projectId, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey }); closeModal(); toast.success('Карточка добавлена') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось добавить'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => workflowApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey }); closeModal(); toast.success('Сохранено') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось сохранить'),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => workflowApi.remove(id),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData(queryKey)
      qc.setQueryData(queryKey, (old: any[] = []) => old.filter(c => c.id !== id))
      setDeleteId(null); closeModal()
      return { previous }
    },
    onError: (_e, _v, ctx) => { if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous); toast.error('Не удалось удалить') },
    onSuccess: () => { qc.invalidateQueries({ queryKey }); toast.success('Карточка удалена') },
  })
  const transitionMut = useMutation({
    mutationFn: ({ id, action, payload }: any) => workflowApi.transition(id, action, payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey }); closeModal(); toast.success('Готово') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось выполнить действие'),
  })
  const clearMut = useMutation({
    mutationFn: () => workflowApi.clearAll(),
    onSuccess: () => { qc.invalidateQueries({ queryKey }); setClearConfirm(false); toast.success('Доска очищена') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось очистить') ,
  })

  // ── Drag-and-drop ───────────────────────────────────────────────────
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)

  const handleDrop = (stage: string) => {
    setDragOverStage(null)
    if (!dragId) return
    const card = (cards || []).find((c: any) => c.id === dragId)
    setDragId(null)
    if (!card || card.stage === stage) return
    if (stage === 'ads') {
      if (card.type === 'cover' || !['published', 'ready_to_publish'].includes(card.stage)) {
        toast.error('Запустить рекламу можно для опубликованной или готовой к публикации карточки')
        return
      }
      setAdCard(card); return
    }
    toast.error('Переходы между этапами — через кнопки в карточке. Перетаскивание разрешено только в «Реклама».')
  }

  const renderCard = (c: any) => (
    <div
      key={c.id}
      draggable={c.kind !== 'kp'}
      onDragStart={() => setDragId(c.id)}
      onDragEnd={() => { setDragId(null); setDragOverStage(null) }}
      onClick={() => openCard(c)}
      className={clsx(
        'relative group bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-3 space-y-2',
        'cursor-grab active:cursor-grabbing hover:border-surface-400 dark:hover:border-surface-500 transition-colors',
        dragId === c.id && 'opacity-50',
      )}
    >
      {(c.createdById === currentUserId || isBoss) && (
        <button type="button" title="Удалить карточку"
          onClick={e => { e.stopPropagation(); setDeleteId(c.id) }}
          className="absolute top-1.5 right-1.5 p-1 rounded-md text-surface-400 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 transition-all">
          <Trash2 size={14} />
        </button>
      )}
      <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 leading-snug pr-6">{c.title}</p>
      <p className="text-[11px] text-primary-600 dark:text-primary-400 font-medium truncate">{c.project?.name || '—'}</p>
      <WorkflowCardBadges card={c} />
      {c.assignee && (
        <div className="flex items-center gap-1.5 pt-0.5">
          <Avatar name={c.assignee.name} src={c.assignee.avatar} size={20} />
          <span className="text-[11px] text-surface-600 dark:text-surface-300 truncate">
            {c.assignee.name} ({shortRole(c.assignee.role)})
          </span>
        </div>
      )}
    </div>
  )

  if (isLoading) return <PageLoader />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <LayoutGrid size={20} className="text-primary-600" />
          <h1 className="page-title">Доска проектов</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => setMineOnly(v => !v)}
            className={clsx('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              mineOnly ? 'bg-primary-600 text-white' : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600')}>
            Мои карточки
          </button>
          {isBoss && (
            <button type="button" onClick={() => setDeadlinesOpen(true)} title="Настроить отступы дедлайнов"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-200 hover:bg-surface-200 dark:hover:bg-surface-600 transition-colors">
              <SlidersHorizontal size={14} /> Дедлайны
            </button>
          )}
          {isBoss && (
            <button type="button" onClick={() => setClearConfirm(true)} title="Удалить все карточки доски (для теста)"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30 transition-colors">
              <Eraser size={14} /> Очистить доску
            </button>
          )}
          <button type="button" onClick={() => setKp('new')} className="btn-primary text-sm whitespace-nowrap">
            <Plus size={14} /> Контент-план
          </button>
        </div>
      </div>
      <p className="text-xs text-surface-500 dark:text-surface-400">
        Производственный канбан SMM-проектов · переходы — через кнопки в карточке · перетаскивание разрешено только в «Реклама» · клик — открыть карточку
      </p>

      <div className="flex gap-3 overflow-x-auto pb-3 hide-scrollbar items-start">
        {visibleStages.map(stage => {
          const items = byStage[stage.key] || []
          return (
            <div
              key={stage.key}
              onDragOver={e => { e.preventDefault(); setDragOverStage(stage.key) }}
              onDragLeave={() => setDragOverStage(prev => (prev === stage.key ? null : prev))}
              onDrop={() => handleDrop(stage.key)}
              className={clsx(
                'w-[230px] shrink-0 rounded-xl p-2 transition-colors',
                dragOverStage === stage.key
                  ? 'bg-surface-100 dark:bg-surface-700/50 ring-2 ring-surface-400 dark:ring-surface-500'
                  : 'bg-surface-50 dark:bg-surface-800/50',
              )}
            >
              <div className="flex items-center justify-between px-1 pb-2">
                <span className="text-xs font-semibold text-surface-700 dark:text-surface-200 truncate">{stage.label}</span>
                <span className="flex items-center gap-1">
                  <span className="text-[10px] font-semibold w-5 h-5 rounded-full bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300 inline-flex items-center justify-center">{items.length}</span>
                  <button type="button" title="Добавить в эту колонку" onClick={() => stage.key === 'content_plan' ? setKp('new') : setCreateStage(stage.key)}
                    className="w-5 h-5 inline-flex items-center justify-center rounded text-surface-400 hover:text-surface-700 hover:bg-surface-200 dark:hover:bg-surface-700 dark:hover:text-surface-200 transition-colors">
                    <Plus size={12} />
                  </button>
                </span>
              </div>
              <div className="space-y-2 min-h-[60px]">
                {items.length === 0
                  ? <p className="text-[11px] text-surface-300 dark:text-surface-600 text-center py-4 select-none">Пусто</p>
                  : items.map(renderCard)}
              </div>
            </div>
          )
        })}
      </div>

      {showModal && (
        <CardFormModal
          open={showModal}
          card={editCard}
          stage={createStage || editCard?.stage || 'content_plan'}
          projects={smmProjects}
          actor={actor}
          loading={createMut.isPending || updateMut.isPending}
          transitioning={transitionMut.isPending}
          onClose={closeModal}
          onDelete={editCard ? () => setDeleteId(editCard.id) : undefined}
          onTransition={(action: string, payload: any) => editCard && transitionMut.mutate({ id: editCard.id, action, payload })}
          onSubmit={(projectId: string, data: any) => {
            if (editCard) updateMut.mutate({ id: editCard.id, data })
            else createMut.mutate({ projectId, data: { ...data, stage: createStage } })
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteId}
        title="Удалить карточку?"
        message="Это действие нельзя отменить."
        danger
        onConfirm={() => deleteId && deleteMut.mutate(deleteId)}
        onClose={() => setDeleteId(null)}
      />

      {adCard && (
        <AdCampaignModal
          card={adCard}
          project={smmProjects.find((p: any) => p.id === adCard.projectId)}
          onClose={() => setAdCard(null)}
          onSaved={() => { setAdCard(null); qc.invalidateQueries({ queryKey }) }}
        />
      )}

      {deadlinesOpen && <DeadlineSettingsModal onClose={() => setDeadlinesOpen(false)} />}

      <ConfirmDialog
        open={clearConfirm}
        title="Очистить всю доску?"
        message="Будут удалены ВСЕ карточки доски (все проекты). Действие необратимо — только для теста."
        danger
        onConfirm={() => clearMut.mutate()}
        onClose={() => setClearConfirm(false)}
      />

      {kp && (
        <ContentPlanModal
          projects={smmProjects}
          card={kp === 'new' ? null : kp}
          onClose={() => setKp(null)}
          onSaved={() => { setKp(null); qc.invalidateQueries({ queryKey }) }}
        />
      )}

      {groupCard && (
        <GroupCardModal
          card={groupCard}
          project={smmProjects.find((p: any) => p.id === groupCard.projectId)}
          onClose={() => setGroupCard(null)}
          onSaved={() => { setGroupCard(null); qc.invalidateQueries({ queryKey }) }}
        />
      )}
    </div>
  )
}

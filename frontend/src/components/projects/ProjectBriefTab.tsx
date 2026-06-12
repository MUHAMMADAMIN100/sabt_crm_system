import { useState, useEffect, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '@/services/api.service'
import { ConfirmDialog } from '@/components/ui'
import { useAuthStore } from '@/store/auth.store'
import { briefFilledPercent, TOTAL_BRIEF_QUESTIONS } from '@/lib/briefSchema'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Save, Trash2, FileText, CheckCircle2, Link as LinkIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import BriefFormBody, { BriefDraft } from './BriefFormBody'

interface Props {
  project: any
}

/**
 * Вкладка «Бриф» — структурированная SMM-анкета клиента (8 секций, 37
 * вопросов из официального WeBrand_SMM_brief.pdf). CRUD через
 * /projects/:id/brief.
 */
export default function ProjectBriefTab({ project }: Props) {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const role = user?.role || ''
  const PM_OR_ADMIN = ['admin', 'founder', 'co_founder', 'smm_director', 'project_manager', 'head_smm', 'smm_specialist']
  const canEdit = PM_OR_ADMIN.includes(role) || project?.managerId === user?.id
  const canDelete = canEdit && role !== 'smm_specialist'

  // Локальный state с черновиком (чтобы поля не лагали на каждом keystroke).
  const initial = useMemo<BriefDraft>(() => ({
    tariff: project?.brief?.tariff || '',
    clientSignature: project?.brief?.clientSignature || '',
    managerSignature: project?.brief?.managerSignature || '',
    answers: (project?.brief?.answers as Record<string, string>) || {},
  }), [project?.brief])

  const [draft, setDraft] = useState<BriefDraft>(initial)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => { setDraft(initial) }, [initial])

  const filledPercent = briefFilledPercent({ answers: draft.answers })

  const saveMut = useMutation({
    mutationFn: async () => {
      await qc.cancelQueries({ queryKey: ['project', project.id] })
      return projectsApi.saveBrief(project.id, {
        tariff: draft.tariff || null,
        clientSignature: draft.clientSignature,
        managerSignature: draft.managerSignature,
        answers: draft.answers,
      })
    },
    onSuccess: (freshProject: any) => {
      // Подменяем кеш ответом сервера — без invalidate, чтобы избежать
      // гонки с WebSocket projects:changed.
      if (freshProject?.id) qc.setQueryData(['project', project.id], freshProject)
      toast.success('Бриф сохранён')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось сохранить бриф'),
  })

  const clearMut = useMutation({
    mutationFn: async () => {
      // Отменяем все in-flight рефетчи проекта — иначе они могут
      // вернуться позже с уже устаревшим brief и затереть наш пустой
      // ответ (тогда поля «возвращаются» через секунду).
      await qc.cancelQueries({ queryKey: ['project', project.id] })
      return projectsApi.clearBrief(project.id)
    },
    onSuccess: (freshProject: any) => {
      // Подменяем кеш свежим project'ом синхронно. НЕ invalidate —
      // иначе WebSocket projects:changed и любой другой триггер могут
      // запустить refetch и принести stale данные.
      if (freshProject?.id) {
        qc.setQueryData(['project', project.id], freshProject)
      }
      // Локальный draft тоже принудительно очищаем (на случай если бэк
      // вернул project без поля brief, а не явный null).
      setDraft({ tariff: '', clientSignature: '', managerSignature: '', answers: {} })
      setConfirmClear(false)
      toast.success('Бриф очищен')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось очистить бриф'),
  })

  // Публичная ссылка для клиента: GET/PATCH-токен сгенерирован на бэке.
  const shareLinkMut = useMutation({
    mutationFn: () => projectsApi.briefShareLink(project.id),
    onSuccess: async (res: any) => {
      const url = res?.url
      if (!url) { toast.error('Не удалось получить ссылку'); return }
      try {
        await navigator.clipboard.writeText(url)
        toast.success('Ссылка скопирована в буфер', { duration: 4000 })
      } catch {
        // Старые браузеры без clipboard API — показываем prompt.
        // eslint-disable-next-line no-alert
        window.prompt('Скопируйте ссылку и отправьте клиенту:', url)
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось создать ссылку'),
  })

  if (project?.projectType !== 'SMM') {
    return (
      <div className="card text-center py-12">
        <FileText size={48} className="mx-auto text-surface-300 dark:text-surface-600 mb-3" />
        <p className="text-sm text-surface-500 dark:text-surface-400">
          Бриф доступен только для SMM-проектов.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Шапка */}
      <div className="card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <FileText size={20} className="text-primary-600" />
            Бриф клиента
          </h2>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
            Структурированная SMM-анкета · 8 разделов · {TOTAL_BRIEF_QUESTIONS} вопросов
          </p>
          {project?.brief?.filledAt && (
            <p className="text-[11px] text-surface-400 mt-1">
              Последнее изменение: {format(new Date(project.brief.filledAt), 'd MMMM yyyy, HH:mm', { locale: ru })}
              {project.brief.filledByName ? ` · ${project.brief.filledByName}` : ''}
              {project.brief.source === 'client' ? ' · клиент через ссылку' : ''}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className={clsx(
            'text-xs font-semibold px-3 py-1 rounded-full',
            filledPercent === 100 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
              : filledPercent >= 50 ? 'bg-surface-100 text-surface-700 dark:bg-surface-900/30 dark:text-surface-300'
              : 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400',
          )}>
            {filledPercent === 100 ? <span className="inline-flex items-center gap-1"><CheckCircle2 size={12} /> Заполнен 100%</span>
              : `${filledPercent}% заполнено`}
          </span>
          {canEdit && (
            <button
              type="button"
              onClick={() => shareLinkMut.mutate()}
              disabled={shareLinkMut.isPending}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 dark:bg-primary-900/30 dark:hover:bg-primary-900/50 dark:text-primary-300 transition-colors"
              title="Скопировать публичную ссылку для клиента"
            >
              <LinkIcon size={12} /> {shareLinkMut.isPending ? 'Создаю…' : 'Ссылка для клиента'}
            </button>
          )}
        </div>
      </div>

      {/* Форма брифа */}
      <BriefFormBody
        value={draft}
        onChange={setDraft}
        disabled={!canEdit}
        headerExtra={
          <>
            <div>
              <label className="label text-xs">Компания</label>
              <input className="input" value={project?.name || ''} disabled />
            </div>
            <div>
              <label className="label text-xs">Дата создания проекта</label>
              <input
                className="input"
                value={project?.createdAt ? format(new Date(project.createdAt), 'd MMMM yyyy', { locale: ru }) : ''}
                disabled
              />
            </div>
          </>
        }
      />

      {/* Actions */}
      {canEdit && (
        <div className="card flex flex-col sm:flex-row items-center justify-between gap-3 sticky bottom-4 z-10 shadow-lg border border-primary-200 dark:border-primary-800">
          <p className="text-xs text-surface-500 dark:text-surface-400">
            Сохранение перезаписывает бриф целиком · CRUD: создание / редактирование / удаление.
          </p>
          <div className="flex items-center gap-2">
            {canDelete && project?.brief && (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                disabled={clearMut.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50"
              >
                <Trash2 size={14} /> Очистить
              </button>
            )}
            <button
              type="button"
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 transition-colors disabled:opacity-50 shadow"
            >
              <Save size={14} /> {saveMut.isPending ? 'Сохранение…' : 'Сохранить бриф'}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmClear}
        title="Очистить бриф?"
        message="Все ответы будут удалены. Это действие нельзя отменить."
        danger
        onConfirm={() => clearMut.mutate()}
        onClose={() => setConfirmClear(false)}
      />
    </div>
  )
}

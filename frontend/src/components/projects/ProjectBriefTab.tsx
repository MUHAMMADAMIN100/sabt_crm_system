import { useState, useEffect, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '@/services/api.service'
import { ConfirmDialog } from '@/components/ui'
import { useAuthStore } from '@/store/auth.store'
import { BRIEF_SECTIONS, BRIEF_TARIFFS, briefFilledPercent, TOTAL_BRIEF_QUESTIONS } from '@/lib/briefSchema'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Save, Trash2, FileText, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

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
  const initial = useMemo(() => ({
    tariff: project?.brief?.tariff || '',
    clientSignature: project?.brief?.clientSignature || '',
    managerSignature: project?.brief?.managerSignature || '',
    answers: (project?.brief?.answers as Record<string, string>) || {},
  }), [project?.brief])

  const [tariff, setTariff] = useState<string>(initial.tariff)
  const [clientSignature, setClientSignature] = useState<string>(initial.clientSignature)
  const [managerSignature, setManagerSignature] = useState<string>(initial.managerSignature)
  const [answers, setAnswers] = useState<Record<string, string>>(initial.answers)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    setTariff(initial.tariff)
    setClientSignature(initial.clientSignature)
    setManagerSignature(initial.managerSignature)
    setAnswers(initial.answers)
  }, [initial])

  const filledPercent = briefFilledPercent({ answers })

  const saveMut = useMutation({
    mutationFn: () => projectsApi.saveBrief(project.id, {
      tariff: tariff || null,
      clientSignature,
      managerSignature,
      answers,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', project.id] })
      toast.success('Бриф сохранён')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось сохранить бриф'),
  })

  const clearMut = useMutation({
    mutationFn: () => projectsApi.clearBrief(project.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', project.id] })
      setTariff('')
      setClientSignature('')
      setManagerSignature('')
      setAnswers({})
      setConfirmClear(false)
      toast.success('Бриф очищен')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось очистить бриф'),
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
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <span className={clsx(
              'text-xs font-semibold px-3 py-1 rounded-full',
              filledPercent === 100 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                : filledPercent >= 50 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                : 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400',
            )}>
              {filledPercent === 100 ? <span className="inline-flex items-center gap-1"><CheckCircle2 size={12} /> Заполнен 100%</span>
                : `${filledPercent}% заполнено`}
            </span>
          </div>
        </div>
      </div>

      {/* Тариф + дата (шапка анкеты) */}
      <div className="card grid grid-cols-1 sm:grid-cols-3 gap-3">
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
        <div>
          <label className="label text-xs">Тариф</label>
          <select
            className="input"
            value={tariff}
            onChange={e => setTariff(e.target.value)}
            disabled={!canEdit}
          >
            <option value="">— Не выбран —</option>
            {BRIEF_TARIFFS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {/* Секции */}
      {BRIEF_SECTIONS.map((sec, idx) => (
        <div key={sec.title} className="card">
          <h3 className="text-base font-bold text-surface-900 dark:text-surface-100 mb-3 pb-2 border-b border-surface-100 dark:border-surface-700">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-xs font-bold mr-2">
              {idx + 1}
            </span>
            {sec.title}
          </h3>
          <div className="space-y-3">
            {sec.fields.map(f => (
              <div key={f.key}>
                <label className="label text-xs flex items-start gap-2">
                  <span className="text-surface-400 font-mono shrink-0 mt-0.5">{f.num}.</span>
                  <span>{f.label}</span>
                </label>
                {f.long ? (
                  <textarea
                    className="input min-h-[72px] resize-y"
                    value={answers[f.key] || ''}
                    onChange={e => setAnswers({ ...answers, [f.key]: e.target.value })}
                    disabled={!canEdit}
                    placeholder="—"
                  />
                ) : (
                  <input
                    className="input"
                    value={answers[f.key] || ''}
                    onChange={e => setAnswers({ ...answers, [f.key]: e.target.value })}
                    disabled={!canEdit}
                    placeholder="—"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Подписи */}
      <div className="card grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label text-xs">Клиент</label>
          <input
            className="input"
            value={clientSignature}
            onChange={e => setClientSignature(e.target.value)}
            disabled={!canEdit}
            placeholder="ФИО клиента"
          />
        </div>
        <div>
          <label className="label text-xs">Менеджер WeBrand</label>
          <input
            className="input"
            value={managerSignature}
            onChange={e => setManagerSignature(e.target.value)}
            disabled={!canEdit}
            placeholder="ФИО менеджера"
          />
        </div>
      </div>

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

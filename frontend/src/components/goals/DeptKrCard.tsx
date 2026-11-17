// Карточка результата отдела («Компас компании», макет Department, 16.11.2026):
// цифра и цель, на какой результат компании работает, полоса с чертой темпа,
// отметка недели с комментарием, статусы последних недель и «Что работает на
// результат» — привязанные проекты и задачи. Права — из ответа сервера
// (kr.canEdit — правит и привязывает, kr.canCheckin — ставит цифру вручную).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui'
import { CheckinHistory, KrValue, ProgressBar, StatusChip } from '@/components/goals/GoalUi'
import InitiativePicker from '@/components/goals/InitiativePicker'
import { errorText } from '@/components/sales/leadUtils'
import { compassApi, compassKeys } from '@/services/goals.api'
import { CHECKIN_OPTIONS, STATUS_META, dayMonthLabel, formatTrend } from '@/lib/goals'
import type { KeyResultView, KrUnit } from '@/types/goals'

const UNIT_WORD: Record<KrUnit, string> = { money: 'с.', percent: '%', count: 'шт.' }

/** «понедельник» — день недели отметки (по Душанбе). */
function weekday(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU', { weekday: 'long', timeZone: 'Asia/Dushanbe' })
}

/** «12 500,5» → 12500.5; пусто → null; не число → NaN. */
function parseNumber(s: string): number | null {
  const t = s.replace(/\s/g, '').replace(',', '.')
  if (!t) return null
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN
}

export default function DeptKrCard({ kr, weekStart, onEdit }: {
  kr: KeyResultView
  /** Понедельник текущей недели (YYYY-MM-DD): отметку этой недели подписываем днём. */
  weekStart: string
  onEdit: (kr: KeyResultView) => void
}) {
  const qc = useQueryClient()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: compassKeys.all })

  const removeKr = useMutation({
    mutationFn: () => compassApi.removeKeyResult(kr.id),
    onSuccess: () => { refresh(); toast.success('Результат удалён') },
    onError: (e) => toast.error(errorText(e, 'Не удалось удалить результат')),
  })
  const removeInit = useMutation({
    mutationFn: (id: string) => compassApi.removeInitiative(id),
    onSuccess: () => { refresh(); toast.success('Отвязано') },
    onError: (e) => toast.error(errorText(e, 'Не удалось отвязать')),
  })

  // Ручная цифра (источник «Вручную»): ставит тот, кто отмечает статус недели.
  const manualAllowed = kr.source === 'manual' && kr.canCheckin
  const [manual, setManual] = useState(kr.manualValue == null ? '' : String(kr.manualValue))
  useEffect(() => { setManual(kr.manualValue == null ? '' : String(kr.manualValue)) }, [kr.manualValue])
  const manualParsed = parseNumber(manual)
  // Сервер может прислать numeric строкой — сравниваем числа.
  const manualDirty = manualParsed !== (kr.manualValue == null ? null : Number(kr.manualValue))
  const saveManual = useMutation({
    mutationFn: (v: number | null) => compassApi.updateKeyResult(kr.id, { manualValue: v }),
    onSuccess: () => { refresh(); toast.success('Цифра сохранена') },
    onError: (e) => toast.error(errorText(e, 'Не удалось сохранить цифру')),
  })
  const submitManual = () => {
    if (manualParsed !== null && !Number.isFinite(manualParsed)) { toast.error('Введите число'); return }
    if (!manualDirty || saveManual.isPending) return
    saveManual.mutate(manualParsed)
  }

  const ck = kr.checkin
  const ckLabel = ck ? CHECKIN_OPTIONS.find(o => o.value === ck.status)?.label ?? '' : ''
  const ckWhen = ck ? (ck.weekStart === weekStart ? weekday(ck.at) : `неделя с ${dayMonthLabel(ck.weekStart)}`) : ''
  const trend = formatTrend(kr.trend, kr.unit)
  const meta = [kr.sourceLabel, kr.detail, trend, kr.owner ? `отвечает ${kr.owner.name}` : null].filter(Boolean).join(' · ')

  return (
    <article className="card !p-4 sm:!p-[18px] flex flex-col gap-3 min-w-0">
      <div className="flex items-start gap-2.5">
        <h2 className="flex-1 min-w-0 text-base sm:text-[17px] font-semibold leading-snug text-surface-900 dark:text-surface-100 break-words">
          {kr.title}
        </h2>
        <StatusChip status={kr.status} />
      </div>

      <div className="flex flex-col gap-1">
        {/* Цифра крупно, как на макете: «141 000 с. из 300 000 с.». */}
        <div className="text-lg sm:text-xl leading-tight">
          <KrValue kr={kr} />
        </div>
        {meta && <p className="text-xs text-surface-500 dark:text-surface-400 break-words">{meta}</p>}
      </div>

      <ProgressBar progress={kr.progress} pace={kr.pace} status={kr.status} />

      <p className="text-[13px] text-surface-500 dark:text-surface-400 break-words">
        {kr.parent ? (
          <>работает на <b className="font-semibold text-surface-700 dark:text-surface-200">
            {kr.parent.n != null ? `КР ${kr.parent.n} компании` : 'результат компании'} · {kr.parent.title}
          </b></>
        ) : 'не привязан к результату компании'}
      </p>

      {manualAllowed && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); submitManual() }}>
          <label className="flex flex-col gap-1 text-xs text-surface-500 dark:text-surface-400">
            Сколько сейчас, {UNIT_WORD[kr.unit]}
            <input value={manual} onChange={e => setManual(e.target.value)} inputMode="decimal" placeholder="—"
              className="input w-40 text-right tabular-nums" />
          </label>
          <button type="submit" disabled={!manualDirty || saveManual.isPending}
            className="btn-secondary min-h-[44px] lg:min-h-[34px]">
            {saveManual.isPending && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Сохранить
          </button>
        </form>
      )}

      {ck && (
        <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-900 px-3 py-2.5 flex flex-col gap-1">
          <p className="text-xs text-surface-500 dark:text-surface-400">
            {ck.comment ? 'Комментарий к статусу' : 'Статус недели'}{ckWhen && ` · ${ckWhen}`}
            {ckLabel && <> · <b className={`font-semibold ${STATUS_META[ck.status].text}`}>{ckLabel}</b></>}
            {ck.user && ` · ${ck.user.name}`}
          </p>
          {ck.comment && (
            <p className="text-sm leading-relaxed text-surface-700 dark:text-surface-200 whitespace-pre-line break-words">{ck.comment}</p>
          )}
        </div>
      )}

      {kr.history.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-surface-500 dark:text-surface-400">
          <span>Статус по неделям</span>
          <CheckinHistory history={kr.history} />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
          Что работает на результат
        </h3>
        {kr.initiatives.length === 0 ? (
          <p className="text-[13px] text-surface-400 dark:text-surface-500 py-1">Пока ничего не привязано</p>
        ) : (
          <ul className="flex flex-col">
            {kr.initiatives.map(i => (
              <li key={i.id} className="flex items-center gap-2 min-h-[44px] lg:min-h-[36px] text-sm">
                <span className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300">
                  {i.kind === 'project' ? 'проект' : 'задача'}
                </span>
                <Link to={i.link} className="flex-1 min-w-0 truncate text-surface-800 dark:text-surface-100 hover:underline">{i.title}</Link>
                {i.state && <span className="shrink-0 max-w-[40%] truncate text-xs text-surface-500 dark:text-surface-400">{i.state}</span>}
                {kr.canEdit && (
                  <button type="button" onClick={() => removeInit.mutate(i.id)} disabled={removeInit.isPending}
                    aria-label={`Отвязать «${i.title}»`} title="Отвязать"
                    className="shrink-0 w-11 h-11 lg:w-8 lg:h-8 -mr-2 lg:mr-0 rounded-lg flex items-center justify-center text-surface-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {kr.canEdit && (
          <button type="button" onClick={() => setPickerOpen(true)}
            className="self-start inline-flex items-center gap-1.5 min-h-[44px] lg:min-h-[32px] text-[13px] font-semibold text-primary-600 dark:text-primary-300 hover:underline">
            <Plus size={14} aria-hidden="true" /> Привязать проект или задачу
          </button>
        )}
      </div>

      {kr.canEdit && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-surface-100 dark:border-surface-700/60">
          <button type="button" onClick={() => onEdit(kr)} className="btn-ghost min-h-[44px] lg:min-h-[34px]">
            <Pencil size={14} aria-hidden="true" /> Изменить
          </button>
          <button type="button" onClick={() => setConfirmOpen(true)} disabled={removeKr.isPending}
            className="btn-ghost min-h-[44px] lg:min-h-[34px] !text-red-600 dark:!text-red-400">
            <Trash2 size={14} aria-hidden="true" /> Удалить
          </button>
        </div>
      )}

      {kr.canEdit && (
        <>
          <InitiativePicker open={pickerOpen} onClose={() => setPickerOpen(false)} kr={kr} />
          <ConfirmDialog open={confirmOpen} onClose={() => setConfirmOpen(false)} onConfirm={() => removeKr.mutate()} danger
            title="Удалить результат?"
            message={`«${kr.title}» пропадёт со страницы отдела вместе с отметками недель и привязанными проектами и задачами. Цели сотрудников останутся, но перестанут на него работать.`} />
        </>
      )}
    </article>
  )
}

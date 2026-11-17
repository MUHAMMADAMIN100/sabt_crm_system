// «Статус недели» (16.11.2026, макет PhoneCheckin, GOALS_SPEC §7–8):
// руководитель по понедельникам отмечает по каждому результату отдела —
// «В графике / Риск / Отстаём» и, если нужно, пару слов. На телефоне —
// шторка снизу, на компьютере — окно по центру (так устроен Modal).
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui'
import { compassApi, compassKeys } from '@/services/goals.api'
import { CHECKIN_OPTIONS, DEPT_NAME, dayMonthLabel, formatTarget, formatValue, pluralRu } from '@/lib/goals'
import { errorText } from '@/components/sales/leadUtils'
import type { CheckinFormView, CheckinStatus, DeptKey } from '@/types/goals'

/** Цвет нажатой кнопки — как статусы на «Компасе». */
const PRESSED: Record<CheckinStatus, string> = {
  on_track: 'border-green-500 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  at_risk: 'border-amber-500 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  off_track: 'border-red-500 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

export function CheckinSheet({ open, onClose, department }: {
  open: boolean
  onClose: () => void
  department?: DeptKey
}) {
  const title = department ? `Статус недели · ${DEPT_NAME[department] ?? ''}` : 'Статус недели'
  return (
    <Modal open={open} onClose={onClose} title={title} size="md" closeOnBackdropClick={false}>
      <CheckinBody department={department} onClose={onClose} />
    </Modal>
  )
}

function CheckinBody({ department, onClose }: { department?: DeptKey; onClose: () => void }) {
  const q = useQuery({ queryKey: compassKeys.checkin, queryFn: () => compassApi.checkinForm() })

  if (q.isPending) {
    return (
      <p role="status" className="flex items-center gap-2 py-6 text-sm text-surface-500">
        <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Загружаем результаты…
      </p>
    )
  }
  if (q.isError || !q.data) {
    return (
      <div role="alert" className="flex flex-col gap-3 py-2 text-sm text-surface-600 dark:text-surface-300">
        {errorText(q.error, 'Не удалось загрузить результаты.')} Проверьте связь и попробуйте ещё раз.
        <div className="flex gap-2">
          <button type="button" onClick={() => q.refetch()} className="btn-secondary min-h-[44px] lg:min-h-[36px]">Повторить</button>
          <button type="button" onClick={onClose} className="btn-ghost min-h-[44px] lg:min-h-[36px]">Закрыть</button>
        </div>
      </div>
    )
  }

  const items = department
    ? q.data.items.filter(i => i.keyResult.department === department)
    : q.data.items

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <p className="font-semibold text-surface-800 dark:text-surface-100">Отмечать пока нечего</p>
        <p className="max-w-xs text-sm text-surface-500 dark:text-surface-400">
          {department
            ? `У отдела «${DEPT_NAME[department] ?? ''}» нет результатов на этот месяц. Сначала добавьте результаты отдела.`
            : 'Статус недели ставят по результатам отделов, которыми вы руководите, и по результатам компании, за которые вы отвечаете. Таких на этот месяц нет.'}
        </p>
        <button type="button" onClick={onClose} className="btn-secondary mt-2 min-h-[44px] lg:min-h-[36px]">Понятно</button>
      </div>
    )
  }

  // Ключ — набор результатов: пришёл новый — форма собирается заново.
  return (
    <CheckinForm
      key={`${q.data.weekStart}:${items.map(i => i.keyResult.id).join(',')}`}
      weekStart={q.data.weekStart}
      items={items}
      showDepartment={!department}
      onClose={onClose}
    />
  )
}

type Draft = { status: CheckinStatus | null; comment: string; commentOpen: boolean }

function CheckinForm({ weekStart, items, showDepartment, onClose }: {
  weekStart: string
  items: CheckinFormView['items']
  showDepartment: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  // Отметка этой недели уже есть — показываем её, чтобы поправить, а не начинать заново.
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    const d: Record<string, Draft> = {}
    for (const { keyResult: kr } of items) {
      const mine = kr.checkin && kr.checkin.weekStart === weekStart ? kr.checkin : null
      d[kr.id] = { status: mine?.status ?? null, comment: mine?.comment ?? '', commentOpen: !!mine?.comment }
    }
    return d
  })
  const [error, setError] = useState<string | null>(null)

  const set = (id: string, patch: Partial<Draft>) => setDrafts(v => ({ ...v, [id]: { ...v[id], ...patch } }))

  const marked = items.filter(i => drafts[i.keyResult.id]?.status)
  const left = items.length - marked.length

  const submit = useMutation({
    mutationFn: () => compassApi.submitCheckin(marked.map(i => {
      const d = drafts[i.keyResult.id]
      return { keyResultId: i.keyResult.id, status: d.status as CheckinStatus, comment: d.comment.trim() || null }
    })),
    onSuccess: res => {
      qc.setQueryData(compassKeys.checkin, res)
      qc.invalidateQueries({ queryKey: compassKeys.all })
      toast.success('Статус недели отправлен')
      onClose()
    },
    onError: (e: unknown) => setError(errorText(e, 'Не удалось отправить статус')),
  })

  return (
    <form
      onSubmit={e => { e.preventDefault(); setError(null); if (marked.length) submit.mutate() }}
      className="flex flex-col gap-3.5"
    >
      <p className="-mt-1 text-[13px] text-surface-500 dark:text-surface-400">
        Неделя с {dayMonthLabel(weekStart)} · займёт минуту
      </p>

      {items.map(({ keyResult: kr, departmentName }) => {
        const d = drafts[kr.id]
        const showComment = d.commentOpen || (d.status != null && d.status !== 'on_track') || !!d.comment
        const groupId = `ci-${kr.id}`
        return (
          <section
            key={kr.id}
            aria-labelledby={`${groupId}-title`}
            className="flex flex-col gap-2.5 rounded-xl border border-surface-200 bg-surface-50 p-3 dark:border-surface-700 dark:bg-surface-900"
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span id={`${groupId}-title`} className="min-w-0 flex-1 text-[15px] font-semibold text-surface-900 dark:text-surface-50 break-words">
                {kr.title}
              </span>
              <span className="text-[13px] tabular-nums text-surface-500 dark:text-surface-400">
                {formatValue(kr.value, kr.unit)} из {formatTarget(kr.target, kr.unit, kr.kind)}
              </span>
            </div>
            {showDepartment && (departmentName || kr.level === 'company') && (
              <p className="-mt-1.5 text-xs text-surface-500 dark:text-surface-400">
                {kr.level === 'company' ? `Результат компании${kr.n != null ? ` · КР ${kr.n}` : ''}` : departmentName}
              </p>
            )}
            <div role="group" aria-labelledby={`${groupId}-title`} className="grid grid-cols-3 gap-1.5">
              {CHECKIN_OPTIONS.map(o => {
                const on = d.status === o.value
                return (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set(kr.id, { status: on ? null : o.value })}
                    className={clsx(
                      'min-h-[44px] rounded-lg border px-1 text-[13px] font-semibold transition-colors',
                      on
                        ? PRESSED[o.value]
                        : 'border-surface-300 bg-white text-surface-700 hover:border-surface-400 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-200',
                    )}
                  >
                    {o.label}
                  </button>
                )
              })}
            </div>
            {showComment ? (
              <div>
                <label htmlFor={`${groupId}-comment`} className="sr-only">Комментарий к «{kr.title}»</label>
                <textarea
                  id={`${groupId}-comment`}
                  rows={2}
                  maxLength={1000}
                  value={d.comment}
                  onChange={e => set(kr.id, { comment: e.target.value })}
                  placeholder="Что происходит и что делаем — пара слов"
                  className="input min-h-[56px] resize-none py-2 text-base sm:text-sm"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => set(kr.id, { commentOpen: true })}
                className="self-start min-h-[44px] lg:min-h-[32px] text-[13px] font-semibold text-surface-500 hover:text-surface-800 dark:text-surface-400 dark:hover:text-surface-100"
              >
                + Комментарий
              </button>
            )}
          </section>
        )
      })}

      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}

      <button
        type="submit"
        disabled={!marked.length || submit.isPending}
        className="btn-primary min-h-[52px] text-base"
      >
        {submit.isPending && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
        Отправить статус
      </button>
      <p className="-mt-1 text-center text-xs text-surface-500 dark:text-surface-400">
        {!marked.length
          ? 'Выберите статус хотя бы у одного результата'
          : left > 0
            ? `Без статуса ${left} ${pluralRu(left, 'результат', 'результата', 'результатов')} — их можно отметить позже`
            : 'Статус увидят основатель и «Компас компании»'}
      </p>
    </form>
  )
}

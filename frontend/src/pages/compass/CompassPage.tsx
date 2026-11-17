// «Компас компании» (16.11.2026, docs/GOALS_SPEC.md §9, макет Compass):
// цели компании на месяц и их измеримые результаты — факт, цель, полоса с
// чертой темпа, тренд за неделю, отметка недели и статус. Справа —
// «Требует внимания» и отделы (основатель/админ и руководители отделов).
// Сотрудник видит цели компании, свою цепочку «моя цель → отдел → компания»
// и результаты своего отдела. ?checkin=1 (ссылка из напоминания в
// понедельник) сразу открывает «Статус недели».
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, ClipboardCheck, Copy, Loader2, Pencil, Plus, Settings2, Trash2 } from 'lucide-react'
import { ConfirmDialog, SkeletonCard } from '@/components/ui'
import { ErrorCard } from '@/pages/sales/salesUi'
import { useUrlFlag, useUrlState } from '@/lib/urlState'
import { compassApi, compassKeys } from '@/services/goals.api'
import {
  DEPT_NAME, STATUS_META, checkinLabel, currentYm, daysLabel, formatTarget, formatTrend, formatValue,
  monthLabel, monthPrep, pluralRu, shiftYm,
} from '@/lib/goals'
import { errorText } from '@/components/sales/leadUtils'
import { KrValue, ProgressBar, StatusChip, useWhileOpen } from '@/components/goals/GoalUi'
import { KeyResultModal } from '@/components/goals/KeyResultModal'
import { ObjectiveModal } from '@/components/goals/ObjectiveModal'
import { LeadersModal } from '@/components/goals/LeadersModal'
import { CheckinSheet } from '@/components/goals/CheckinSheet'
import type {
  AttentionItem, ChainGoal, CompassView, DepartmentSummary, DeptKey, GoalStatus, KeyResultView, KrLevel, KrUnit, ObjectiveView,
} from '@/types/goals'

/** Порядок счётчиков статусов в шапке и у отделов. */
const STATUS_ORDER: GoalStatus[] = ['on_track', 'done', 'at_risk', 'off_track', 'missed', 'none']

type KrDefaults = { level?: KrLevel; department?: DeptKey; objectiveId?: string; parentId?: string }
type Confirm = { kind: 'objective'; item: ObjectiveView } | { kind: 'kr'; item: KeyResultView }

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500'

export default function CompassPage() {
  const qc = useQueryClient()
  const nowYm = currentYm()
  const [ymRaw, setYm] = useUrlState<string>('ym', nowYm)
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(ymRaw) ? ymRaw : nowYm
  const [checkinOpen, setCheckinOpen] = useUrlFlag('checkin')
  const [checkinDept, setCheckinDept] = useState<DeptKey | undefined>(undefined)
  const [objModal, setObjModal] = useState<{ editing: ObjectiveView | null } | null>(null)
  const [krModal, setKrModal] = useState<{ editing: KeyResultView | null; defaults?: KrDefaults } | null>(null)
  const [leadersOpen, setLeadersOpen] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const confirmShown = useWhileOpen(!!confirm, confirm)

  const q = useQuery({
    queryKey: compassKeys.view(ym),
    queryFn: () => compassApi.view(ym),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const data = q.data
  // Пока грузится другой месяц, показываем прежний приглушённым.
  const stale = q.isPlaceholderData

  const invalidate = () => qc.invalidateQueries({ queryKey: compassKeys.all })

  const removeObjective = useMutation({
    mutationFn: (id: string) => compassApi.removeObjective(id),
    onSuccess: () => { invalidate(); toast.success('Цель удалена') },
    onError: (e: unknown) => toast.error(errorText(e, 'Не удалось удалить цель')),
  })
  const removeKr = useMutation({
    mutationFn: (id: string) => compassApi.removeKeyResult(id),
    onSuccess: () => { invalidate(); toast.success('Результат удалён') },
    onError: (e: unknown) => toast.error(errorText(e, 'Не удалось удалить результат')),
  })
  const copy = useMutation({
    mutationFn: () => compassApi.copyMonth(shiftYm(ym, -1), ym),
    onSuccess: r => {
      invalidate()
      const objectives = r?.objectives ?? 0
      const keyResults = r?.keyResults ?? 0
      if (!objectives && !keyResults) toast('Переносить нечего — всё уже есть в этом месяце')
      else toast.success(`Перенесено: ${objectives} ${pluralRu(objectives, 'цель', 'цели', 'целей')}, ${keyResults} ${pluralRu(keyResults, 'результат', 'результата', 'результатов')}`)
    },
    onError: (e: unknown) => toast.error(errorText(e, 'Не удалось перенести цели')),
  })

  const openCheckin = (dept?: DeptKey) => { setCheckinDept(dept); setCheckinOpen(true) }
  const editKr = (kr: KeyResultView) => setKrModal({ editing: kr })
  const askDeleteKr = (kr: KeyResultView) => setConfirm({ kind: 'kr', item: kr })

  // «Отметить статус недели» — только в текущем месяце и тем, кому есть что отмечать.
  const isCurrent = !!data && data.ym === data.today.slice(0, 7)
  const canCheckinNow = !!data && isCurrent && (
    data.me.leads.length > 0
    || data.objectives.some(o => o.keyResults.some(k => k.canCheckin))
    || data.myDepartmentKeyResults.some(k => k.canCheckin)
  )

  return (
    <div className="space-y-4 sm:space-y-5">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-[300px] flex-col gap-1">
          <h1 className="page-title">Компас компании</h1>
          {data && <MonthFacts data={data} />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthSwitcher ym={ym} nowYm={nowYm} onChange={setYm} />
          {canCheckinNow && (
            <button type="button" onClick={() => openCheckin()} className="btn-secondary min-h-[44px] lg:min-h-[36px]">
              <ClipboardCheck size={15} aria-hidden="true" /> Отметить статус недели
            </button>
          )}
          {data?.canManageCompany && (
            <>
              <button type="button" onClick={() => setLeadersOpen(true)} className="btn-secondary min-h-[44px] lg:min-h-[36px]">
                <Settings2 size={15} aria-hidden="true" /> Руководители отделов
              </button>
              <button type="button" onClick={() => setObjModal({ editing: null })} className="btn-primary min-h-[44px] lg:min-h-[36px]">
                <Plus size={15} aria-hidden="true" /> Новая цель
              </button>
            </>
          )}
        </div>
      </header>

      {!data && q.isPending ? (
        <PageSkeleton />
      ) : !data ? (
        <ErrorCard text={errorText(q.error, 'Не удалось загрузить «Компас».')} onRetry={() => q.refetch()} />
      ) : (
        <div aria-busy={stale} className={clsx('transition-opacity', stale && 'pointer-events-none opacity-60')}>
          <div className="grid items-start gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-w-0 flex-col gap-4">
              {data.objectives.length === 0 ? (
                <EmptyMonth
                  data={data}
                  copying={copy.isPending}
                  onCopy={() => copy.mutate()}
                  onNew={() => setObjModal({ editing: null })}
                />
              ) : (
                data.objectives.map(o => (
                  <ObjectiveCard
                    key={o.id}
                    o={o}
                    today={data.today}
                    canAddKr={data.canManageCompany}
                    onEdit={() => setObjModal({ editing: o })}
                    onDelete={() => setConfirm({ kind: 'objective', item: o })}
                    onAddKr={() => setKrModal({ editing: null, defaults: { level: 'company', objectiveId: o.id } })}
                    onEditKr={editKr}
                    onDeleteKr={askDeleteKr}
                  />
                ))
              )}
              {!data.me.details && data.me.department && (
                <MyDepartmentCard
                  dept={data.me.department}
                  krs={data.myDepartmentKeyResults}
                  today={data.today}
                  onEditKr={editKr}
                  onDeleteKr={askDeleteKr}
                />
              )}
            </div>

            <aside className="flex min-w-0 flex-col gap-4" aria-label="Сводка">
              {data.me.details && (
                <AttentionCard
                  items={data.attention}
                  leads={data.me.leads}
                  canCheckin={isCurrent}
                  onCheckin={openCheckin}
                />
              )}
              {data.departments.length > 0 && (
                <DepartmentsCard departments={data.departments} details={data.me.details} current={isCurrent} />
              )}
              {(!data.me.details || data.myChain.length > 0) && <ChainCard chain={data.myChain} ym={data.ym} />}
            </aside>
          </div>
          <p className="mt-4 text-xs text-surface-500 dark:text-surface-400">
            Черта на полосе — где результат должен быть сегодня при равномерном темпе. Цифры CRM считает сама по своим данным.
          </p>
        </div>
      )}

      <ObjectiveModal open={!!objModal} onClose={() => setObjModal(null)} ym={ym} editing={objModal?.editing ?? null} />
      <KeyResultModal
        open={!!krModal}
        onClose={() => setKrModal(null)}
        ym={ym}
        editing={krModal?.editing ?? null}
        defaults={krModal?.defaults}
      />
      {data?.canManageCompany && <LeadersModal open={leadersOpen} onClose={() => setLeadersOpen(false)} />}
      <CheckinSheet open={checkinOpen} onClose={() => setCheckinOpen(false)} department={checkinDept} />
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirmShown) return
          if (confirmShown.kind === 'objective') removeObjective.mutate(confirmShown.item.id)
          else removeKr.mutate(confirmShown.item.id)
        }}
        title={confirmShown?.kind === 'objective' ? 'Удалить цель?' : 'Удалить результат?'}
        message={confirmText(confirmShown)}
        danger
      />
    </div>
  )
}

function confirmText(c: Confirm | null): string {
  if (!c) return ''
  if (c.kind === 'objective') {
    return `Цель «${c.item.title}» и её результаты будут удалены. Результаты отделов останутся, но перестанут быть привязаны к ним.`
  }
  return c.item.level === 'company'
    ? `Результат «${c.item.title}» будет удалён. Результаты отделов, которые на него работают, останутся без привязки.`
    : `Результат «${c.item.title}» будет удалён. Цели сотрудников, привязанные к нему, останутся без привязки.`
}

// ── Шапка ─────────────────────────────────────────────────────────────

/** «прошло 51 % месяца · до конца 14 дней · 2 в графике · 3 риск». */
function MonthFacts({ data }: { data: CompassView }) {
  const cur = data.today.slice(0, 7)
  const time = data.ym < cur ? 'месяц закончился'
    : data.ym > cur ? 'месяц ещё не начался'
    : data.daysLeft > 0
      ? `прошло ${Math.round(data.elapsed)} % месяца · до конца ${daysLabel(data.daysLeft)}`
      : 'последний день месяца'
  const counts = STATUS_ORDER
    .map(s => ({ s, n: data.counts?.[s] ?? 0 }))
    .filter(x => x.n > 0)
  return (
    <p className="text-sm text-surface-500 dark:text-surface-400">
      {time}
      {counts.map(({ s, n }) => (
        <span key={s}> · <span className={clsx('font-semibold', STATUS_META[s].text)}>{n} {STATUS_META[s].label}</span></span>
      ))}
    </p>
  )
}

function MonthSwitcher({ ym, nowYm, onChange }: { ym: string; nowYm: string; onChange: (ym: string) => void }) {
  const arrow = clsx(
    'flex h-11 w-11 items-center justify-center text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-900 lg:h-9 lg:w-9 dark:text-surface-400 dark:hover:bg-surface-700 dark:hover:text-white',
    FOCUS,
  )
  return (
    <div className="flex items-center gap-1">
      <div role="group" aria-label="Месяц"
        className="inline-flex items-center rounded-lg border border-surface-300 bg-surface-50 dark:border-surface-600 dark:bg-surface-800">
        <button type="button" aria-label="Предыдущий месяц" onClick={() => onChange(shiftYm(ym, -1))} className={clsx(arrow, 'rounded-l-lg')}>
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <span aria-live="polite" className="min-w-[118px] px-1 text-center text-sm font-semibold text-surface-900 dark:text-surface-50">
          {monthLabel(ym)}
        </span>
        <button type="button" aria-label="Следующий месяц" onClick={() => onChange(shiftYm(ym, 1))} className={clsx(arrow, 'rounded-r-lg')}>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
      {ym !== nowYm && (
        <button type="button" onClick={() => onChange(nowYm)} className="btn-ghost min-h-[44px] text-[13px] lg:min-h-[36px]">
          Текущий месяц
        </button>
      )}
    </div>
  )
}

function PageSkeleton() {
  return (
    <div aria-busy="true" className="grid items-start gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-4"><SkeletonCard /><SkeletonCard /></div>
      <div className="flex flex-col gap-4"><SkeletonCard /></div>
    </div>
  )
}

function IconButton({ label, onClick, children, danger }: {
  label: string
  onClick: () => void
  children: ReactNode
  danger?: boolean
}) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className={clsx(
        'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-surface-500 transition-colors hover:bg-surface-100 lg:h-8 lg:w-8 dark:text-surface-400 dark:hover:bg-surface-700',
        danger ? 'hover:text-red-500 dark:hover:text-red-400' : 'hover:text-surface-900 dark:hover:text-white',
        FOCUS,
      )}>
      {children}
    </button>
  )
}

// ── Пустой месяц ──────────────────────────────────────────────────────

function EmptyMonth({ data, copying, onCopy, onNew }: {
  data: CompassView
  copying: boolean
  onCopy: () => void
  onNew: () => void
}) {
  const canCopy = data.prevHasGoals && data.canCopy
  const text = data.canManageCompany
    ? canCopy
      ? 'Перенесите цели прошлого месяца и поправьте цифры — или поставьте новые: 1–3 цели и к каждой 2–4 измеримых результата.'
      : 'Поставьте 1–3 цели компании и к каждой 2–4 измеримых результата — цифры CRM посчитает сама.'
    : canCopy
      ? 'Цели компании ставит основатель. Результаты вашего отдела можно перенести из прошлого месяца.'
      : 'Цели компании ставит основатель. Как только они появятся, они будут здесь.'
  return (
    <section className="card flex flex-col items-center gap-2 px-4 py-10 text-center sm:px-6">
      <h2 className="font-semibold text-surface-800 dark:text-surface-100">Целей на {monthLabel(data.ym)} пока нет</h2>
      <p className="max-w-md text-sm text-surface-500 dark:text-surface-400">{text}</p>
      {(canCopy || data.canManageCompany) && (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {canCopy && (
            <button type="button" onClick={onCopy} disabled={copying} className="btn-primary min-h-[44px] lg:min-h-[36px]">
              {copying ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
              Перенести цели прошлого месяца
            </button>
          )}
          {data.canManageCompany && (
            <button type="button" onClick={onNew} className={clsx(canCopy ? 'btn-secondary' : 'btn-primary', 'min-h-[44px] lg:min-h-[36px]')}>
              <Plus size={15} aria-hidden="true" /> Новая цель
            </button>
          )}
        </div>
      )}
    </section>
  )
}

// ── Цель компании и её результаты ─────────────────────────────────────

function ObjectiveCard({ o, today, canAddKr, onEdit, onDelete, onAddKr, onEditKr, onDeleteKr }: {
  o: ObjectiveView
  today: string
  canAddKr: boolean
  onEdit: () => void
  onDelete: () => void
  onAddKr: () => void
  onEditKr: (kr: KeyResultView) => void
  onDeleteKr: (kr: KeyResultView) => void
}) {
  const headingId = `objective-${o.id}`
  return (
    <section aria-labelledby={headingId} className="card p-0 sm:p-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-2.5 pt-3 sm:pt-4">
        <span className="font-mono text-xs text-surface-500 dark:text-surface-400">Цель {o.n}</span>
        <h2 id={headingId} className="min-w-0 flex-1 basis-48 break-words text-[17px] font-semibold text-surface-900 dark:text-surface-50">
          {o.title}
        </h2>
        <StatusChip status={o.status} />
        {o.canEdit && (
          <span className="-mr-2 flex items-center">
            <IconButton label={`Изменить цель «${o.title}»`} onClick={onEdit}><Pencil size={15} aria-hidden="true" /></IconButton>
            <IconButton label={`Удалить цель «${o.title}»`} onClick={onDelete} danger><Trash2 size={15} aria-hidden="true" /></IconButton>
          </span>
        )}
        {o.owner && <p className="w-full text-xs text-surface-500 dark:text-surface-400">отвечает {o.owner.name}</p>}
      </div>

      {o.keyResults.length > 0 ? (
        <ul>
          {o.keyResults.map(kr => (
            <KrRow
              key={kr.id}
              kr={kr}
              today={today}
              onEdit={kr.canEdit ? () => onEditKr(kr) : undefined}
              onDelete={kr.canEdit ? () => onDeleteKr(kr) : undefined}
            />
          ))}
        </ul>
      ) : (
        <p className="border-t border-surface-200 px-4 py-4 text-sm text-surface-500 dark:border-surface-700 dark:text-surface-400">
          Пока нет результатов.{' '}
          {canAddKr ? 'Добавьте 2–4 измеримых результата — по ним видно, выполнена ли цель.' : 'Их добавит основатель.'}
        </p>
      )}

      {canAddKr && (
        <div className="border-t border-surface-200 px-2 py-1 dark:border-surface-700">
          <button type="button" onClick={onAddKr} className="btn-ghost min-h-[44px] text-[13px] lg:min-h-[36px]">
            <Plus size={15} aria-hidden="true" /> Новый результат
          </button>
        </div>
      )}
    </section>
  )
}

/** Строка результата. На телефоне — столбиком; с 768 px — сеткой из
 *  четырёх колонок (номер · название · полоса · статус и действия). */
function KrRow({ kr, today, showParent, onEdit, onDelete }: {
  kr: KeyResultView
  today: string
  /** Результат отдела: вместо отделов — на какой результат компании работает. */
  showParent?: boolean
  onEdit?: () => void
  onDelete?: () => void
}) {
  const [factOpen, setFactOpen] = useState(false)
  const nLabel = kr.n != null ? `КР ${kr.n}` : ''
  const meta: string[] = []
  if (showParent) {
    if (kr.parent) meta.push(`→ ${kr.parent.n != null ? `КР ${kr.parent.n} · ` : ''}${kr.parent.title}`)
  } else if (kr.level === 'company') {
    if (kr.departments?.length) meta.push(kr.departments.map(d => DEPT_NAME[d] ?? d).join(', '))
  } else if (kr.department) {
    meta.push(DEPT_NAME[kr.department] ?? kr.department)
  }
  if (kr.sourceLabel) meta.push(kr.sourceLabel)
  const trend = formatTrend(kr.trend, kr.unit)
  const canFact = kr.source === 'manual' && kr.canCheckin
  const aria = `${kr.title}: ${kr.value == null ? 'нет данных' : formatValue(kr.value, kr.unit)} из ${formatTarget(kr.target, kr.unit, kr.kind)}`

  return (
    <li className="flex flex-col gap-2.5 border-t border-surface-200 px-4 py-3 md:grid md:grid-cols-[44px_minmax(0,1.3fr)_minmax(0,1.2fr)_auto] md:items-center md:gap-x-4 dark:border-surface-700">
      <div className="flex min-w-0 items-start gap-2.5 md:contents">
        <span className={clsx('w-10 shrink-0 pt-0.5 font-mono text-xs text-surface-500 md:w-auto md:pt-0 dark:text-surface-400', !nLabel && 'hidden md:block')}>
          {nLabel}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold text-surface-900 dark:text-surface-50">{kr.title}</p>
          {meta.length > 0 && <p className="mt-0.5 break-words text-xs text-surface-500 dark:text-surface-400">{meta.join(' · ')}</p>}
        </div>
        <span className="shrink-0 md:hidden"><StatusChip status={kr.status} /></span>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <ProgressBar progress={kr.progress} pace={kr.pace} status={kr.status} label={aria} />
        <p className="text-xs text-surface-500 dark:text-surface-400">
          <KrValue kr={kr} />{trend && <> · {trend}</>}
        </p>
        {kr.detail && (
          <p className="break-words text-xs text-surface-400 md:truncate dark:text-surface-500" title={kr.detail}>{kr.detail}</p>
        )}
      </div>

      <div className="flex items-center gap-2 md:justify-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1 md:flex-none md:items-end">
          <span className="hidden md:inline-flex"><StatusChip status={kr.status} /></span>
          <CheckinNote checkin={kr.checkin} today={today} />
        </div>
        {(canFact || onEdit || onDelete) && (
          <div className="-mr-2 flex shrink-0 items-center">
            {canFact && (
              <button type="button" aria-expanded={factOpen} onClick={() => setFactOpen(v => !v)}
                className="btn-ghost min-h-[44px] px-2 text-xs lg:min-h-[32px]">
                Отметить факт
              </button>
            )}
            {onEdit && <IconButton label={`Изменить результат «${kr.title}»`} onClick={onEdit}><Pencil size={15} aria-hidden="true" /></IconButton>}
            {onDelete && <IconButton label={`Удалить результат «${kr.title}»`} onClick={onDelete} danger><Trash2 size={15} aria-hidden="true" /></IconButton>}
          </div>
        )}
      </div>

      {factOpen && (
        <div className="md:col-span-4">
          <ManualValueEditor kr={kr} onDone={() => setFactOpen(false)} />
        </div>
      )}
    </li>
  )
}

/** «статус: пн» с точкой цвета отметки; комментарий — во всплывающей подсказке. */
function CheckinNote({ checkin, today }: { checkin: KeyResultView['checkin']; today: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-surface-500 dark:text-surface-400" title={checkin?.comment || undefined}>
      {checkin && <span aria-hidden="true" className={clsx('h-2 w-2 shrink-0 rounded-full', STATUS_META[checkin.status]?.bar)} />}
      {checkinLabel(checkin, today)}
      {checkin && <span className="sr-only"> — {STATUS_META[checkin.status]?.label}</span>}
    </span>
  )
}

const UNIT_WORD: Record<KrUnit, string> = { money: 'сомони', count: 'шт.', percent: '%' }

/** Ручной результат: факт отмечает ответственный или руководитель. */
function ManualValueEditor({ kr, onDone }: { kr: KeyResultView; onDone: () => void }) {
  const qc = useQueryClient()
  const [value, setValue] = useState(kr.manualValue != null ? String(kr.manualValue) : '')
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (v: number | null) => compassApi.updateKeyResult(kr.id, { manualValue: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: compassKeys.all })
      toast.success('Факт обновлён')
      onDone()
    },
    onError: (e: unknown) => setError(errorText(e, 'Не удалось сохранить')),
  })
  const id = `fact-${kr.id}`
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = value.replace(/[\s%]/g, '').replace(',', '.')
    const n = t ? Number(t) : null
    if (n != null && !Number.isFinite(n)) { setError('Нужно число'); return }
    setError(null)
    save.mutate(n)
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-lg bg-surface-100 p-3 dark:bg-surface-900">
      <div className="min-w-[140px] flex-1">
        <label htmlFor={id} className="label">Факт сейчас, {UNIT_WORD[kr.unit] ?? ''}</label>
        <input id={id} className="input" inputMode="decimal" value={value} autoFocus placeholder="Пока нет"
          aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined}
          onChange={e => setValue(e.target.value)} />
      </div>
      <button type="submit" disabled={save.isPending} className="btn-primary min-h-[44px] lg:min-h-[36px]">
        {save.isPending && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} Сохранить
      </button>
      <button type="button" onClick={onDone} className="btn-ghost min-h-[44px] lg:min-h-[36px]">Отмена</button>
      {error && <p id={`${id}-err`} role="alert" className="w-full text-xs text-red-500">{error}</p>}
    </form>
  )
}

// ── Правая колонка ────────────────────────────────────────────────────

const TONE_CHIP: Record<AttentionItem['tone'], string> = {
  off_track: `${STATUS_META.off_track.bg} ${STATUS_META.off_track.text}`,
  at_risk: `${STATUS_META.at_risk.bg} ${STATUS_META.at_risk.text}`,
  info: 'bg-surface-200 text-surface-700 dark:bg-surface-700 dark:text-surface-200',
}

const LINK_CLS = clsx(
  'inline-flex min-h-[44px] items-center self-start text-[13px] font-semibold text-primary-600 hover:underline lg:min-h-0 dark:text-primary-300',
  FOCUS,
)

function AttentionCard({ items, leads, canCheckin, onCheckin }: {
  items: AttentionItem[]
  leads: DeptKey[]
  canCheckin: boolean
  onCheckin: (dept: DeptKey) => void
}) {
  return (
    <section aria-labelledby="compass-attention" className="card p-0 sm:p-0">
      <h2 id="compass-attention" className="px-4 pb-1.5 pt-4 text-base font-semibold text-surface-900 dark:text-surface-50">
        Требует внимания
      </h2>
      {items.length === 0 ? (
        <p className="px-4 pb-4 pt-1 text-sm text-surface-500 dark:text-surface-400">
          Всё спокойно: отстающих результатов нет, статусы недели отмечены.
        </p>
      ) : (
        <ul>
          {items.map((a, i) => {
            const myCheckin = a.kind === 'checkin' && !!a.department && leads.includes(a.department) && canCheckin
            return (
              <li key={`${a.kind}-${a.keyResultId ?? a.department ?? ''}-${i}`}
                className="flex items-start gap-3 border-t border-surface-200 px-4 py-3.5 dark:border-surface-700">
                <span className={clsx('shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold leading-4', TONE_CHIP[a.tone] ?? TONE_CHIP.info)}>
                  {a.label}
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="break-words text-sm font-semibold text-surface-900 dark:text-surface-50">{a.title}</p>
                  {a.text && <p className="break-words text-[13px] leading-snug text-surface-500 dark:text-surface-400">{a.text}</p>}
                  {myCheckin && a.department ? (
                    <button type="button" onClick={() => onCheckin(a.department as DeptKey)}
                      className="btn-secondary mt-1 min-h-[44px] self-start text-[13px] lg:min-h-[32px]">
                      Отметить статус
                    </button>
                  ) : a.link ? (
                    /^https?:\/\//.test(a.link)
                      ? <a href={a.link} target="_blank" rel="noreferrer" className={LINK_CLS}>{a.linkLabel || 'Открыть'}</a>
                      : <Link to={a.link} className={LINK_CLS}>{a.linkLabel || 'Открыть'}</Link>
                  ) : a.department ? (
                    <Link to={`/compass/${a.department}`} className={LINK_CLS}>Открыть отдел</Link>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** «2 результата: 1 в графике, 1 риск». */
function deptSummary(d: DepartmentSummary): string {
  if (!d.krCount) return 'результатов пока нет'
  const parts = STATUS_ORDER
    .map(s => ({ s, n: d.counts?.[s] ?? 0 }))
    .filter(x => x.n > 0)
    .map(x => `${x.n} ${STATUS_META[x.s].label}`)
  return `${d.krCount} ${pluralRu(d.krCount, 'результат', 'результата', 'результатов')}${parts.length ? `: ${parts.join(', ')}` : ''}`
}

function DepartmentsCard({ departments, details, current }: {
  departments: DepartmentSummary[]
  details: boolean
  current: boolean
}) {
  return (
    <section aria-labelledby="compass-departments" className="card overflow-hidden p-0 sm:p-0">
      <h2 id="compass-departments" className="px-4 pb-1.5 pt-4 text-base font-semibold text-surface-900 dark:text-surface-50">
        {details ? 'Отделы' : 'Мой отдел'}
      </h2>
      <ul>
        {departments.map(d => {
          const without = d.withoutGoals ?? 0
          return (
            <li key={d.key} className="border-t border-surface-200 dark:border-surface-700">
              <Link to={`/compass/${d.key}`}
                className={clsx('flex min-h-[44px] flex-col gap-1 px-4 py-3 transition-colors hover:bg-surface-100 dark:hover:bg-surface-700/40', FOCUS)}>
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 break-words text-sm font-semibold text-surface-900 dark:text-surface-50">{d.name}</span>
                  <StatusChip status={d.status} />
                  <ChevronRight size={15} aria-hidden="true" className="shrink-0 text-surface-400" />
                </span>
                <span className="text-xs text-surface-500 dark:text-surface-400">
                  {deptSummary(d)}
                  {current && d.krCount > 0 && (d.checkedThisWeek ? ' · статус недели отмечен' : ' · статус недели не отмечен')}
                </span>
                {(d.leader || without > 0) && (
                  <span className="text-xs text-surface-500 dark:text-surface-400">
                    {d.leader && <>руководитель — {d.leader.name}</>}
                    {d.leader && without > 0 && ' · '}
                    {without > 0 && (
                      <span className="text-amber-500 dark:text-amber-400">
                        {without} {pluralRu(without, 'человек', 'человека', 'человек')} без цели на месяц
                      </span>
                    )}
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ── Сотрудник: моя цепочка и результаты отдела ───────────────────────

/** Счётчики целей месяца (как в профиле); остальные показатели — проценты. */
const COUNT_METRIC_SUFFIX: Record<string, string> = { stories_days: 'дн.', ontime_shifts: 'смен', won_deals: 'шт.' }

function chainValue(g: ChainGoal): string {
  const suffix = g.metric ? COUNT_METRIC_SUFFIX[g.metric] : undefined
  if (suffix) return `${formatValue(g.value, 'count')} из ${g.target == null ? '—' : formatValue(g.target, 'count')} ${suffix}`
  return `${formatValue(g.value, 'percent')} из ${g.target == null ? '—' : formatValue(g.target, 'percent')}`
}

function ChainCard({ chain, ym }: { chain: ChainGoal[]; ym: string }) {
  return (
    <section aria-labelledby="compass-chain" className="card flex flex-col gap-3">
      <div>
        <h2 id="compass-chain" className="text-base font-semibold text-surface-900 dark:text-surface-50">Моя цепочка</h2>
        <p className="text-xs text-surface-500 dark:text-surface-400">Мои цели {monthPrep(ym)} и на что они работают</p>
      </div>
      {chain.length === 0 ? (
        <p className="text-sm text-surface-500 dark:text-surface-400">
          Целей месяца у вас пока нет — их ставит руководитель отдела.{' '}
          <Link to="/profile" className={clsx('font-semibold text-primary-600 hover:underline dark:text-primary-300', FOCUS)}>Открыть профиль</Link>
        </p>
      ) : (
        chain.map(g => <ChainItem key={g.id} g={g} />)
      )}
    </section>
  )
}

function ChainItem({ g }: { g: ChainGoal }) {
  const finished = g.done || g.reached
  const measurable = g.metric != null && g.target != null && g.target > 0
  const progress = measurable && g.value != null ? (g.value / (g.target as number)) * 100 : null
  const kr = g.keyResult
  const companyTitle = kr ? (kr.level === 'company' ? kr.title : kr.parent?.title ?? null) : null
  const companyProgress = kr ? (kr.level === 'company' ? kr.progress : kr.parent?.progress ?? null) : null
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-surface-200 bg-surface-50 p-3 dark:border-surface-700 dark:bg-surface-900">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 break-words text-sm font-semibold text-surface-900 dark:text-surface-50">{g.title}</span>
        {finished && <StatusChip status="done" />}
      </div>
      {measurable ? (
        <>
          <p className="text-xs text-surface-500 dark:text-surface-400">
            <b className="font-semibold text-surface-900 dark:text-surface-50">{chainValue(g)}</b> · считается само
          </p>
          <ProgressBar progress={progress} status={finished ? 'done' : 'none'} label={`${g.title}: ${chainValue(g)}`} />
        </>
      ) : (
        <p className="text-xs text-surface-500 dark:text-surface-400">{finished ? 'отмечено выполненным' : 'отмечаете вы — в профиле'}</p>
      )}
      {kr ? (
        <div className="flex flex-col gap-0.5 text-xs text-surface-500 dark:text-surface-400">
          {kr.level === 'department' && (
            <span className="break-words">
              → отдел {kr.departmentName ? `${kr.departmentName} · ` : ''}
              <b className="font-semibold text-surface-700 dark:text-surface-200">{kr.title}</b>
              {kr.progress != null && ` ${Math.round(kr.progress)} %`}
            </span>
          )}
          {companyTitle && (
            <span className="break-words">
              → компания <b className="font-semibold text-surface-700 dark:text-surface-200">{companyTitle}</b>
              {companyProgress != null && ` ${Math.round(companyProgress)} %`}
            </span>
          )}
        </div>
      ) : (
        <p className="text-xs text-surface-400 dark:text-surface-500">не привязана к результату отдела</p>
      )}
    </article>
  )
}

function MyDepartmentCard({ dept, krs, today, onEditKr, onDeleteKr }: {
  dept: DeptKey
  krs: KeyResultView[]
  today: string
  onEditKr: (kr: KeyResultView) => void
  onDeleteKr: (kr: KeyResultView) => void
}) {
  return (
    <section aria-labelledby="compass-my-dept" className="card p-0 sm:p-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pb-2.5 pt-3 sm:pt-4">
        <h2 id="compass-my-dept" className="text-base font-semibold text-surface-900 dark:text-surface-50">Результаты моего отдела</h2>
        <span className="text-xs text-surface-500 dark:text-surface-400">{DEPT_NAME[dept] ?? dept}</span>
      </div>
      {krs.length > 0 ? (
        <ul>
          {krs.map(kr => (
            <KrRow
              key={kr.id}
              kr={kr}
              today={today}
              showParent
              onEdit={kr.canEdit ? () => onEditKr(kr) : undefined}
              onDelete={kr.canEdit ? () => onDeleteKr(kr) : undefined}
            />
          ))}
        </ul>
      ) : (
        <p className="border-t border-surface-200 px-4 py-4 text-sm text-surface-500 dark:border-surface-700 dark:text-surface-400">
          У отдела пока нет результатов на этот месяц — их ставит руководитель отдела.
        </p>
      )}
    </section>
  )
}

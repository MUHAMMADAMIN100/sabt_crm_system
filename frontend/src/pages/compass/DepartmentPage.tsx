// Страница отдела «Компаса компании» (/compass/:dept, макет Department,
// 16.11.2026, docs/GOALS_SPEC.md §9): результаты отдела за месяц, отметка
// статуса недели, «Новый результат» и «Цели людей · {месяц}». Период — месяц
// (?ym=YYYY-MM, по умолчанию текущий). Кто что видит и правит — решает сервер:
// canEdit / canCheckin / people === null.
import { Fragment, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Copy, Flag, Loader2, Plus } from 'lucide-react'
import { errorText } from '@/components/sales/leadUtils'
import { Avatar, EmptyState, PageLoader } from '@/components/ui'
import { StatusChip } from '@/components/goals/GoalUi'
import { KeyResultModal } from '@/components/goals/KeyResultModal'
import { CheckinSheet } from '@/components/goals/CheckinSheet'
import DeptKrCard from '@/components/goals/DeptKrCard'
import { compassApi, compassKeys } from '@/services/goals.api'
import { employeesApi } from '@/services/api.service'
import { STATUS_META, barWidth, currentYm, isDeptKey, monthLabel, pluralRu, shiftYm } from '@/lib/goals'
import { getRoleLabel } from '@/lib/permissions'
import { useUrlState } from '@/lib/urlState'
import useNarrow from '@/hooks/useNarrow'
import { COUNT_GOAL_METRICS, goalValue } from '@/pages/profile/ProfileStats'
import type { DepartmentView, DeptKey, GoalStatus, KeyResultView, PersonGoalRow } from '@/types/goals'

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export default function DepartmentPage() {
  const { dept } = useParams<{ dept: string }>()
  if (!isDeptKey(dept)) return <Navigate to="/compass" replace />
  // key — другой отдел начинается с чистого листа, без цифр прошлого отдела.
  return <DepartmentScreen key={dept} dept={dept} />
}

type PersonGoal = PersonGoalRow['goals'][number]
/** 'manual' — цель без показателя, ещё не отмечена: её отмечает сам сотрудник. */
type PersonStatus = GoalStatus | 'manual'

/** Статус цели сотрудника — по тем же правилам, что у результатов (§5):
 *  счётчики сравниваем с темпом месяца, проценты — с целью (допуск 3 п.). */
function personGoalStatus(g: PersonGoal, d: Pick<DepartmentView, 'ym' | 'today' | 'elapsed'>): PersonStatus {
  const curYm = d.today.slice(0, 7)
  const past = d.ym < curYm
  if (g.reached || g.done) return 'done'
  if (!g.metric) return past ? 'missed' : 'manual'
  if (g.value == null || !g.target) return 'none'
  if (past) return 'missed'
  if (COUNT_GOAL_METRICS.includes(g.metric)) {
    if (d.ym > curYm || Number(d.today.slice(8, 10)) <= 5) return 'on_track'
    // elapsed по договору — проценты (0–100). После 5-го числа процентов
    // больше 16, поэтому значение ≤ 1 — это доля: принимаем оба вида.
    const raw = Math.max(0, Number(d.elapsed) || 0)
    const share = Math.min(1, raw > 1 ? raw / 100 : raw)
    if (share <= 0) return 'on_track'
    const ratio = g.value / (g.target * share)
    return ratio >= 0.9 ? 'on_track' : ratio >= 0.7 ? 'at_risk' : 'off_track'
  }
  return g.value >= g.target ? 'on_track' : g.value >= g.target - 3 ? 'at_risk' : 'off_track'
}

function PersonStatusChip({ status }: { status: PersonStatus }) {
  if (status !== 'manual') return <StatusChip status={status} />
  return (
    <span className={clsx('inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', STATUS_META.none.bg, STATUS_META.none.text)}>
      не отмечена
    </span>
  )
}

/** Полоса и цифра цели сотрудника: «3 / 5 шт.», «89 % · цель 95 %», «выполнено ✓». */
function PersonProgress({ g, status }: { g: PersonGoal; status: PersonStatus }) {
  if (!g.metric) {
    return g.done
      ? <span className="text-xs font-semibold text-green-600 dark:text-green-400">выполнено ✓</span>
      : <span className="text-xs text-surface-500 dark:text-surface-400">отмечает сам</span>
  }
  const pct = g.value != null && g.target ? (g.value / g.target) * 100 : null
  const text = g.value == null ? '—'
    : goalValue(g) + (COUNT_GOAL_METRICS.includes(g.metric) ? '' : ` · цель ${g.target ?? '—'} %`)
  const tone = status === 'manual' ? STATUS_META.none.bar : STATUS_META[status].bar
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="h-2 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden" aria-hidden="true">
        <div className={clsx('h-full rounded-full', tone)} style={{ width: `${g.reached ? 100 : barWidth(pct)}%` }} />
      </div>
      <span className="text-xs text-surface-500 dark:text-surface-400 tabular-nums">{text}</span>
    </div>
  )
}

function MonthSwitch({ ym, onChange }: { ym: string; onChange: (ym: string) => void }) {
  const btn = 'w-11 h-11 lg:w-9 lg:h-9 rounded-lg border border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 flex items-center justify-center hover:bg-surface-100 dark:hover:bg-surface-700'
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Месяц">
      <button type="button" onClick={() => onChange(shiftYm(ym, -1))} aria-label="Прошлый месяц" className={btn}>
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <span className="min-w-[130px] text-center text-sm font-medium text-surface-700 dark:text-surface-200 first-letter:uppercase" aria-live="polite">
        {monthLabel(ym)}
      </span>
      <button type="button" onClick={() => onChange(shiftYm(ym, 1))} aria-label="Следующий месяц" className={btn}>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

function DepartmentScreen({ dept }: { dept: DeptKey }) {
  const cur = currentYm()
  const [rawYm, setYm] = useUrlState<string>('ym', cur)
  const ym = YM_RE.test(rawYm) ? rawYm : cur
  const narrow = useNarrow(767)

  const [krModal, setKrModal] = useState<{ open: boolean; editing: KeyResultView | null }>({ open: false, editing: null })
  const [checkinOpen, setCheckinOpen] = useState(false)

  const q = useQuery({
    queryKey: compassKeys.department(dept, ym),
    queryFn: () => compassApi.department(dept, ym),
    placeholderData: keepPreviousData,
    // 403/404 — повтор ничего не даст.
    retry: (n, e: any) => ![403, 404].includes(e?.response?.status) && n < 1,
  })
  const d = q.data

  // Месяц пуст — смотрим, были ли результаты в прошлом: тогда подсказываем
  // «Перенести цели прошлого месяца» на странице компаса.
  const empty = !!d && !q.isPlaceholderData && d.keyResults.length === 0
  const prevYm = shiftYm(ym, -1)
  const prevQ = useQuery({
    queryKey: compassKeys.department(dept, prevYm),
    queryFn: () => compassApi.department(dept, prevYm),
    enabled: empty && !!d?.canEdit,
    retry: false,
  })
  const prevHad = (prevQ.data?.keyResults.length ?? 0) > 0
  // Перенос результатов прошлого месяца. На «Компасе» кнопка есть только у
  // пустого месяца, а руководитель переносит, когда цели компании уже стоят
  // (сервер ищет родителей по названию) — поэтому кнопка здесь.
  const qc = useQueryClient()
  const copy = useMutation({
    mutationFn: () => compassApi.copyMonth(prevYm, ym),
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: compassKeys.all })
      const n = r?.keyResults ?? 0
      if (n) toast.success(`Перенесено: ${n} ${pluralRu(n, 'результат', 'результата', 'результатов')}`)
      else toast('Переносить нечего — всё уже есть в этом месяце')
    },
    onError: (e: unknown) => toast.error(errorText(e, 'Не удалось перенести результаты')),
  })

  // Ссылка «Поставить цель» ведёт в карточку сотрудника, а она открывается по
  // id записи сотрудника, не пользователя — сопоставляем по списку сотрудников.
  const needEmp = !!d?.people?.some(p => p.goals.length === 0)
  const empQ = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeesApi.list(),
    enabled: needEmp,
    staleTime: 5 * 60_000,
  })
  const empIdByUser = useMemo(() => {
    const list: any[] = Array.isArray(empQ.data) ? empQ.data : []
    return new Map<string, string>(list.filter(e => e?.userId && e?.id).map(e => [String(e.userId), String(e.id)]))
  }, [empQ.data])
  const employeeLink = (p: PersonGoalRow) => {
    const id = empIdByUser.get(p.userId)
    return id ? `/employees/${id}` : `/employees?q=${encodeURIComponent(p.name)}`
  }

  const compassHref = ym === cur ? '/compass' : `/compass?ym=${ym}`
  const openNew = () => setKrModal({ open: true, editing: null })
  const openEdit = (kr: KeyResultView) => setKrModal({ open: true, editing: kr })

  const modals = (
    <>
      <KeyResultModal open={krModal.open} onClose={() => setKrModal(s => ({ ...s, open: false }))} ym={ym}
        editing={krModal.editing} defaults={{ level: 'department', department: dept }} />
      <CheckinSheet open={checkinOpen} onClose={() => setCheckinOpen(false)} department={dept} />
    </>
  )

  if (!d) {
    if (q.isPending) return <PageLoader />
    const status = (q.error as any)?.response?.status
    return (
      <div className="space-y-4">
        <Link to={compassHref} className="inline-flex items-center min-h-[44px] text-[13px] text-surface-500 dark:text-surface-400 hover:underline">
          ← Компас компании
        </Link>
        <div className="card">
          {status === 403 ? (
            <EmptyState title="Нет доступа к этому отделу"
              description="Страницу отдела видят руководитель отдела, основатель и администратор, а также сотрудники самого отдела." />
          ) : (
            <EmptyState title="Не удалось загрузить отдел" description="Проверьте связь и попробуйте ещё раз."
              action={<button type="button" onClick={() => q.refetch()} className="btn-secondary min-h-[44px] lg:min-h-[36px]">Повторить</button>} />
          )}
        </div>
      </div>
    )
  }

  const isCurrent = d.ym === d.today.slice(0, 7)
  const members = d.department.members
  const krs = d.keyResults
  const people = d.people
  const withoutGoal = people ? people.filter(p => p.goals.length === 0).length : 0
  const showCheckin = d.canCheckin && isCurrent && krs.length > 0

  return (
    <div className={clsx('space-y-4 sm:space-y-5 transition-opacity', q.isPlaceholderData && 'opacity-60')} aria-busy={q.isFetching}>
      {/* ── Шапка ── */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex-1 min-w-[min(100%,320px)] flex flex-col gap-1">
          <nav aria-label="Путь к странице" className="text-[13px] text-surface-500 dark:text-surface-400">
            <Link to={compassHref} className="hover:underline text-primary-600 dark:text-primary-300">Компас компании</Link>
            <span aria-hidden="true"> / </span>Отдел
          </nav>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="page-title">{d.department.name}</h1>
            {krs.length > 0 && <StatusChip status={d.status} />}
          </div>
          <p className="text-sm text-surface-500 dark:text-surface-400">
            {d.department.leader ? `руководитель ${d.department.leader.name}` : 'руководитель не назначен'}
            {` · ${members} ${pluralRu(members, 'человек', 'человека', 'человек')} · ${monthLabel(d.ym)}`}
            {isCurrent && krs.length > 0 && (
              <> · <span className={d.checkedThisWeek ? '' : 'text-amber-600 dark:text-amber-400 font-medium'}>
                статус недели {d.checkedThisWeek ? 'отмечен' : 'не отмечен'}
              </span></>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <MonthSwitch ym={ym} onChange={setYm} />
          {d.canEdit && (
            <button type="button" onClick={openNew} className="btn-secondary flex-1 sm:flex-none min-h-[44px] lg:min-h-[36px]">
              <Plus size={15} aria-hidden="true" /> Новый результат
            </button>
          )}
          {showCheckin && (
            <button type="button" onClick={() => setCheckinOpen(true)} className="btn-primary flex-1 sm:flex-none min-h-[44px] lg:min-h-[36px]">
              <Flag size={15} aria-hidden="true" /> Отметить статус недели
            </button>
          )}
        </div>
      </div>

      {/* ── Результаты отдела ── */}
      {krs.length === 0 ? (
        <section className="card">
          <EmptyState
            title={`На ${monthLabel(d.ym)} у отдела нет результатов`}
            description={d.canEdit
              ? 'Результат — цифра на месяц, которая двигает цель компании: например, «Публикации в срок — 95 %». Цели сотрудников потом привязываются к нему.'
              : 'Руководитель отдела ещё не поставил результаты на этот месяц.'}
            action={d.canEdit ? (
              <button type="button" onClick={openNew} className="btn-primary min-h-[44px] lg:min-h-[36px]">
                <Plus size={15} aria-hidden="true" /> Новый результат
              </button>
            ) : undefined}
          />
          {d.canEdit && prevHad && (
            <div className="-mt-6 pb-6 px-4 flex flex-col items-center gap-2 text-center">
              <p className="text-[13px] text-surface-500 dark:text-surface-400">
                В прошлом месяце у отдела были результаты — их можно перенести и поправить цифры.
              </p>
              <button type="button" onClick={() => copy.mutate()} disabled={copy.isPending}
                className="btn-secondary min-h-[44px] lg:min-h-[36px]">
                {copy.isPending ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                Перенести результаты прошлого месяца
              </button>
            </div>
          )}
        </section>
      ) : (
        <section aria-label="Результаты отдела" className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-4 items-start">
          {krs.map(kr => <DeptKrCard key={kr.id} kr={kr} weekStart={d.weekStart} onEdit={openEdit} />)}
        </section>
      )}

      {/* ── Цели людей (только руководству и руководителю отдела) ── */}
      {people !== null && (
        <section className="card !p-4 sm:!px-[18px] sm:!py-[18px]" aria-labelledby="dept-people-title">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-3">
            <h2 id="dept-people-title" className="flex-1 text-base sm:text-[17px] font-semibold text-surface-900 dark:text-surface-100">
              Цели людей · {monthLabel(d.ym)}
            </h2>
            {withoutGoal > 0 && (
              <span className="text-[13px] font-semibold text-amber-600 dark:text-amber-400">
                {withoutGoal} {pluralRu(withoutGoal, 'сотрудник', 'сотрудника', 'сотрудников')} без цели
              </span>
            )}
          </div>

          {people.length === 0 ? (
            <p className="text-sm text-surface-500 dark:text-surface-400 pb-2">В отделе пока нет сотрудников.</p>
          ) : narrow ? (
            <ul className="flex flex-col">
              {people.map(p => {
                const none = p.goals.length === 0
                return (
                  <li key={p.userId}
                    className={clsx('flex flex-col gap-2 py-3 border-t border-surface-100 dark:border-surface-700/60',
                      none && '-mx-4 px-4 bg-amber-500/[0.07]')}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar name={p.name} src={p.avatar || undefined} size={36} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">{p.name}</div>
                        <div className="text-xs text-surface-500 dark:text-surface-400 truncate">{getRoleLabel(p.role)}</div>
                      </div>
                    </div>
                    {none ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex-1 text-[13px] font-semibold text-amber-600 dark:text-amber-400">нет цели</span>
                        <Link to={employeeLink(p)} className="btn-secondary min-h-[44px]">Поставить цель</Link>
                      </div>
                    ) : p.goals.slice(0, 3).map(g => {
                      const st = personGoalStatus(g, d)
                      return (
                        <div key={g.id} className="flex flex-col gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-2.5">
                          <div className="flex items-start gap-2">
                            <span className="flex-1 min-w-0 text-sm text-surface-800 dark:text-surface-100 break-words">{g.title}</span>
                            <PersonStatusChip status={st} />
                          </div>
                          <PersonProgress g={g} status={st} />
                          <span className="text-xs text-surface-500 dark:text-surface-400 break-words">
                            работает на {g.keyResultTitle
                              ? <b className="font-semibold text-surface-700 dark:text-surface-200">{g.keyResultTitle}</b>
                              : '—'}
                          </span>
                        </div>
                      )
                    })}
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th scope="col" className="pb-2.5 pr-3">Сотрудник</th>
                    <th scope="col" className="pb-2.5 pr-3">Цель месяца</th>
                    <th scope="col" className="pb-2.5 pr-3">Прогресс</th>
                    <th scope="col" className="pb-2.5 pr-3">Работает на</th>
                    <th scope="col" className="pb-2.5">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map(p => {
                    const person = (rowSpan: number) => (
                      <td rowSpan={rowSpan} className="py-3 pr-3 align-top">
                        <div className="flex items-center gap-2.5 min-w-0 max-w-[240px]">
                          <Avatar name={p.name} src={p.avatar || undefined} size={32} />
                          <div className="min-w-0">
                            <div className="font-semibold text-surface-900 dark:text-surface-100 truncate">{p.name}</div>
                            <div className="text-xs text-surface-500 dark:text-surface-400 truncate">{getRoleLabel(p.role)}</div>
                          </div>
                        </div>
                      </td>
                    )
                    if (p.goals.length === 0) {
                      return (
                        <tr key={p.userId} className="border-t border-surface-100 dark:border-surface-700/60 bg-amber-500/[0.07]">
                          {person(1)}
                          <td colSpan={3} className="py-3 pr-3 align-middle">
                            <span className="font-semibold text-amber-600 dark:text-amber-400">нет цели на {monthLabel(d.ym)}</span>
                          </td>
                          <td className="py-3 align-middle">
                            <Link to={employeeLink(p)} className="btn-secondary whitespace-nowrap min-h-[44px] lg:min-h-[34px]">Поставить цель</Link>
                          </td>
                        </tr>
                      )
                    }
                    const goals = p.goals.slice(0, 3)
                    return <Fragment key={p.userId}>{goals.map((g, i) => {
                      const st = personGoalStatus(g, d)
                      return (
                        <tr key={g.id} className={clsx(i === 0 && 'border-t border-surface-100 dark:border-surface-700/60')}>
                          {i === 0 && person(goals.length)}
                          <td className="py-3 pr-3 align-top text-surface-800 dark:text-surface-100 min-w-[180px]">{g.title}</td>
                          <td className="py-3 pr-3 align-top min-w-[160px]"><PersonProgress g={g} status={st} /></td>
                          <td className="py-3 pr-3 align-top text-[13px] text-surface-600 dark:text-surface-300">{g.keyResultTitle || '—'}</td>
                          <td className="py-3 align-top"><PersonStatusChip status={st} /></td>
                        </tr>
                      )
                    })}</Fragment>
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {modals}
    </div>
  )
}

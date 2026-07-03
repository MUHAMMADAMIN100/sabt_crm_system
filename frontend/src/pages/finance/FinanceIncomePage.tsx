import { useEffect, useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '@/services/api.service'
import { Modal } from '@/components/ui'
import {
  ArrowLeft, Plus, Volume2, Code2, Palette, Pencil, Archive, Trash2,
  Undo2, Receipt, FolderOpen, ChevronRight, ChevronDown,
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { money, monthLabel, shiftYm, currentYm, todayISO, formatDate, ymOf, dirLabel } from './financeUtils'
import {
  MonthNav, MonthRangeNav, Stat, Badge, ProgressBar, SectionTitle, EmptyState, AlertBar, CellInput, TableCard,
} from './financeUi'

/* ================================================================== *
 * Доход — список направлений + drill-down SMM / Development / Design.
 * Drill-down внутри страницы через useState (dir), без роутов.
 * ================================================================== */

type Dir = 'smm' | 'development' | 'design'

interface Project {
  id: string; name: string; tariff: number
  contractDate?: string; archived?: boolean; note?: string; multiMonth?: boolean; direction?: Dir
}
interface Part { plannedId: string; amount: number; status: 'expected' | 'received'; txId?: string }
interface SmmRow {
  project: Project
  part1: Part | null
  part2: Part | null
  paidLife: number
  fullyPaid: boolean
  alert: 'pay' | 'rest' | null
}
interface SmmDetailData {
  kind: 'smm'
  rows: SmmRow[]
  stats: { expected: number; receivedCash: number; spentOffAccount: number; total: number }
  totals: { tariff: number; part1: number; part2: number; full: number }
  needPay: number; needRest: number
  archived: ArchivedItem[]
}
interface MatrixPlan { id: string; amount: number; status: 'expected' | 'received'; txId?: string }
interface MatrixCell { ym: string; plans: MatrixPlan[]; received: number; expected: number }
interface MatrixRow { project: Project; paidLife: number; cells: MatrixCell[] }
interface MatrixData {
  months: string[]
  rows: MatrixRow[]
  totals: { tariff: number; perMonth: { ym: string; total: number }[] }
}
interface DevDetailData extends MatrixData { kind: 'matrix'; stats: { expected: number; received: number; total: number } }
interface SimpleWork { project: Project; paidLife: number; paid: number }
interface DesignDetailData {
  kind: 'design'
  months: string[]
  simple: SimpleWork[]
  matrix: MatrixData
  stats: { expected: number; received: number; total: number }
}
interface DirRow { direction: Dir; received: number; plan: number; projectCount: number; expected: number }
interface Account { id: string; name: string }
interface ArchivedItem { id: string; name: string; tariff: number; contractDate?: string }

const DIR_ICON: Record<Dir, any> = { smm: Volume2, development: Code2, design: Palette }
const DIR_COLOR: Record<Dir, string> = { smm: 'text-green-500', development: 'text-sky-500', design: 'text-purple-500' }
const DIR_HINT: Record<Dir, string> = {
  smm: 'Помесячный учёт оплат по частям 1 / 2',
  development: 'Проекты направления · матрица поступлений по месяцам',
  design: 'Разовые работы и брендбуки по месяцам',
}

const num = (s: string) => { const n = parseFloat((s || '').replace(',', '.')); return isNaN(n) ? 0 : n }

/* --- переиспользуемая мутация: инвалидация + тост --- */
function useFinMutation<V>(fn: (v: V) => Promise<any>, successMsg: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['finance'] }); toast.success(successMsg) },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })
}

/* --- выбор счёта с дефолтом на первый --- */
function useAccountSelect() {
  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ['finance', 'accounts'], queryFn: financeApi.accounts })
  const [accountId, setAccountId] = useState('')
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id) }, [accounts, accountId])
  return { accounts, accountId, setAccountId }
}

const Loading = () => <p className="text-sm text-surface-400 animate-pulse">Загрузка…</p>

function IconBtn({ onClick, title, danger, disabled, children }: {
  onClick: () => void; title: string; danger?: boolean; disabled?: boolean; children: ReactNode
}) {
  return (
    <button
      onClick={onClick} title={title} disabled={disabled}
      className={clsx('p-1.5 rounded hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-40', danger ? 'text-red-500' : 'text-surface-500')}
    >
      {children}
    </button>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><label className="label text-xs">{label}</label>{children}</div>
}

function AccountField({ accounts, value, onChange, label = 'На счёт' }: {
  accounts: Account[]; value: string; onChange: (v: string) => void; label?: string
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={e => onChange(e.target.value)} className="input">
        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </Field>
  )
}

function ModalFoot({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-2 pt-4">{children}</div>
}

const TH = 'font-medium px-3 py-2.5'
const TD = 'px-3 py-2'
const TR = 'border-b border-surface-50 dark:border-surface-800/60'

/* ================================================================== *
 * Страница
 * ================================================================== */
export default function FinanceIncomePage() {
  const [ym, setYm] = useState(currentYm())
  const [dir, setDir] = useState<Dir | null>(null)
  const [newProject, setNewProject] = useState(false)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {dir && (
            <button onClick={() => setDir(null)} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500">
              <ArrowLeft size={18} />
            </button>
          )}
          <div>
            <h1 className="page-title flex items-center gap-2">
              Доход{dir && <span className="text-surface-400 font-normal">/ {dirLabel(dir)}</span>}
            </h1>
            <p className="text-surface-500 dark:text-surface-400 mt-0.5 text-sm">
              {dir ? DIR_HINT[dir] : 'Три направления — нажмите, чтобы открыть проекты'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <MonthNav ym={ym} onChange={setYm} />
          {dir && (
            <button onClick={() => setNewProject(true)} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={16} /> Проект
            </button>
          )}
        </div>
      </div>

      {dir === null && <DirectionsList ym={ym} onOpen={setDir} />}
      {dir === 'smm' && <SmmDetail ym={ym} />}
      {dir === 'development' && <DevelopmentDetail ym={ym} />}
      {dir === 'design' && <DesignDetail ym={ym} />}

      {dir && newProject && <ProjectModal direction={dir} onClose={() => setNewProject(false)} />}
    </div>
  )
}

/* ================================================================== *
 * Список направлений
 * ================================================================== */
function DirectionsList({ ym, onOpen }: { ym: string; onOpen: (d: Dir) => void }) {
  const { data = [], isLoading } = useQuery<DirRow[]>({
    queryKey: ['finance', 'income-dirs', ym],
    queryFn: () => financeApi.incomeDirections(ym),
  })
  if (isLoading) return <Loading />
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {data.map(d => {
          const Icon = DIR_ICON[d.direction] || Volume2
          return (
            <button
              key={d.direction} onClick={() => onOpen(d.direction)}
              className="card text-left hover:border-primary-300 dark:hover:border-primary-800 transition-colors"
            >
              <span className={clsx('flex items-center gap-1.5 font-semibold', DIR_COLOR[d.direction])}>
                <Icon size={16} /> {dirLabel(d.direction)}
              </span>
              <p className="text-2xl font-bold mt-2 tabular-nums text-surface-800 dark:text-surface-100">{money(d.received)}</p>
              <p className="text-xs text-surface-400 mt-1">{d.projectCount} проектов · план {money(d.plan)}</p>
              {d.expected > 0 && <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">ожидается {money(d.expected)}</p>}
              <p className="text-xs text-primary-600 mt-2">Открыть →</p>
            </button>
          )
        })}
      </div>
      <p className="text-xs text-surface-400">Месяц: {monthLabel(ym)} — суммы считаются по доходным операциям выбранного месяца.</p>
    </>
  )
}

/* ================================================================== *
 * SMM
 * ================================================================== */
function SmmDetail({ ym }: { ym: string }) {
  const { data, isLoading } = useQuery<SmmDetailData>({
    queryKey: ['finance', 'income-detail', 'smm', ym],
    queryFn: () => financeApi.incomeDirectionDetail('smm', ym),
  })
  const updateNote = useFinMutation((v: { id: string; note: string }) => financeApi.updateProject(v.id, { note: v.note }), 'Сохранено')
  const archive = useFinMutation((id: string) => financeApi.updateProject(id, { archived: true }), 'Проект в архиве')
  const del = useFinMutation((id: string) => financeApi.removeProject(id), 'Проект удалён')
  const removePlan = useFinMutation((id: string) => financeApi.removePlanned(id), 'Оплата отменена')

  const [payFor, setPayFor] = useState<{ project: Project; partNo: 1 | 2; scheduled: number } | null>(null)
  const [receiveFor, setReceiveFor] = useState<{ plannedId: string; amount: number } | null>(null)
  const [editProject, setEditProject] = useState<Project | null>(null)

  if (isLoading || !data) return <Loading />
  const { rows, stats, totals, needPay, needRest, archived } = data

  const removeProjectConfirm = (p: Project) => {
    if (confirm(`Удалить проект «${p.name}»? Удалятся его плановые оплаты и доходные операции.`)) del.mutate(p.id)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="Ожидается" value={money(stats.expected)} />
        <Stat
          label="Получено на счёт" value={money(stats.receivedCash)} tone="pos"
          sub={stats.spentOffAccount > 0 ? `освоено вне счёта: ${money(stats.spentOffAccount)}` : undefined}
        />
        <Stat label="Всего за месяц" value={money(stats.total)} />
      </div>

      {(needPay > 0 || needRest > 0) && (
        <AlertBar tone="amber">
          <Receipt size={16} className="text-amber-600 dark:text-amber-400 shrink-0" />
          {needPay > 0 && <b className="text-amber-600 dark:text-amber-400">Получить оплату: {needPay}</b>}
          {needRest > 0 && <b className="text-blue-600 dark:text-blue-400">Получить остаток: {needRest}</b>}
          <span className="text-surface-400 text-xs">— по сроку оплаты проектов</span>
        </AlertBar>
      )}

      {rows.length === 0 && archived.length === 0 ? (
        <div className="card"><EmptyState icon={<FolderOpen size={30} />}>Нет проектов — нажмите «＋ Проект»</EmptyState></div>
      ) : (
        <TableCard scroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
                <th className={TH}>Проект</th>
                <th className={TH}>Дата контракта</th>
                <th className={clsx(TH, 'text-right')}>Тариф</th>
                <th className={TH}>Часть 1</th>
                <th className={TH}>Часть 2</th>
                <th className={TH}>Полная оплата</th>
                <th className={clsx(TH, 'min-w-[180px]')}>Комментарий</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const scheduled = (r.part1?.amount ?? 0) + (r.part2?.amount ?? 0)
                return (
                  <tr key={r.project.id} className={TR}>
                    <td className={TD}>
                      <div className="font-medium text-surface-800 dark:text-surface-200">{r.project.name}</div>
                      {r.alert === 'pay' && <div className="mt-1"><Badge tone="wait">получить оплату</Badge></div>}
                      {r.alert === 'rest' && <div className="mt-1"><Badge tone="transfer">получить остаток</Badge></div>}
                    </td>
                    <td className={clsx(TD, 'text-surface-500 whitespace-nowrap')}>{formatDate(r.project.contractDate)}</td>
                    <td className={clsx(TD, 'text-right tabular-nums text-surface-500')}>{money(r.project.tariff)}</td>
                    {([1, 2] as const).map(n => {
                      const part = n === 1 ? r.part1 : r.part2
                      return (
                        <td key={n} className={TD}>
                          {!part ? (
                            <IconBtn onClick={() => setPayFor({ project: r.project, partNo: n, scheduled })} title="Записать оплату">
                              <Plus size={15} />
                            </IconBtn>
                          ) : part.status === 'received' ? (
                            <span className="inline-flex items-center gap-1">
                              <Badge tone="ok" check>{money(part.amount)}</Badge>
                              <IconBtn onClick={() => removePlan.mutate(part.plannedId)} disabled={removePlan.isPending} title="Отменить оплату">
                                <Undo2 size={14} />
                              </IconBtn>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <Badge tone="wait">{money(part.amount)}</Badge>
                              <button className="btn-primary text-xs px-2 py-0.5" onClick={() => setReceiveFor({ plannedId: part.plannedId, amount: part.amount })}>
                                Получено
                              </button>
                            </span>
                          )}
                        </td>
                      )
                    })}
                    <td className={TD}>
                      {r.fullyPaid
                        ? <Badge tone="ok">оплачено</Badge>
                        : <span className="text-xs text-surface-400 tabular-nums">{money(r.paidLife)} / {money(r.project.tariff)}</span>}
                    </td>
                    <td className={TD}>
                      <CellInput value={r.project.note} onCommit={v => updateNote.mutate({ id: r.project.id, note: v })} />
                    </td>
                    <RowActions
                      onEdit={() => setEditProject(r.project)}
                      onArchive={() => archive.mutate(r.project.id)}
                      onDelete={() => removeProjectConfirm(r.project)}
                    />
                  </tr>
                )
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="font-semibold border-t border-surface-100 dark:border-surface-700">
                  <td className={TD} colSpan={2}>Итого</td>
                  <td className={clsx(TD, 'text-right tabular-nums')}>{money(totals.tariff)}</td>
                  <td className={clsx(TD, 'tabular-nums')}>{money(totals.part1)}</td>
                  <td className={clsx(TD, 'tabular-nums')}>{money(totals.part2)}</td>
                  <td className={clsx(TD, 'tabular-nums')}>{money(totals.full)}</td>
                  <td /><td />
                </tr>
              </tfoot>
            )}
          </table>
        </TableCard>
      )}

      <p className="text-xs text-surface-400">
        «Получено» создаёт доход на выбранный счёт и привязывает его к проекту. «↩» отменяет оплату.
      </p>

      <ArchivedProjects items={archived} />

      {payFor && <PayPartModal project={payFor.project} partNo={payFor.partNo} ym={ym} scheduled={payFor.scheduled} onClose={() => setPayFor(null)} />}
      {receiveFor && <ReceiveModal plannedId={receiveFor.plannedId} amount={receiveFor.amount} onClose={() => setReceiveFor(null)} />}
      {editProject && <ProjectModal direction="smm" project={editProject} onClose={() => setEditProject(null)} />}
    </div>
  )
}

function RowActions({ onEdit, onArchive, onDelete }: { onEdit: () => void; onArchive: () => void; onDelete: () => void }) {
  return (
    <td className={clsx(TD, 'text-right whitespace-nowrap')}>
      <IconBtn onClick={onEdit} title="Редактировать"><Pencil size={15} /></IconBtn>
      <IconBtn onClick={onArchive} title="В архив (больше не работаем)"><Archive size={15} /></IconBtn>
      <IconBtn onClick={onDelete} title="Удалить проект" danger><Trash2 size={15} /></IconBtn>
    </td>
  )
}

/* ================================================================== *
 * Development (матрица)
 * ================================================================== */
function DevelopmentDetail({ ym }: { ym: string }) {
  const [start, setStart] = useState<string | undefined>(undefined)
  const { data, isLoading } = useQuery<DevDetailData>({
    queryKey: ['finance', 'income-detail', 'development', ym, start ?? null],
    queryFn: () => financeApi.incomeDirectionDetail('development', ym, start),
  })
  const { data: allProjects = [] } = useQuery<Project[]>({ queryKey: ['finance', 'projects'], queryFn: financeApi.projects })
  const archived: ArchivedItem[] = allProjects.filter(p => p.direction === 'development' && p.archived)

  if (isLoading || !data) return <Loading />
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="Ожидается за месяц" value={money(data.stats.expected)} />
        <Stat label="Получено за месяц" value={money(data.stats.received)} tone="pos" />
        <Stat label="Всего сумма" value={money(data.stats.total)} />
      </div>

      {data.rows.length > 0 ? (
        <MatrixTable direction="development" months={data.months} rows={data.rows} totals={data.totals} onNavigate={setStart} />
      ) : (
        <div className="card"><EmptyState icon={<FolderOpen size={30} />}>Нет проектов — нажмите «＋ Проект»</EmptyState></div>
      )}

      <ArchivedProjects items={archived} />
    </div>
  )
}

function MatrixTable({ direction, months, rows, totals, onNavigate }: {
  direction: Dir; months: string[]; rows: MatrixRow[]
  totals: MatrixData['totals']; onNavigate: (start: string) => void
}) {
  const updateNote = useFinMutation((v: { id: string; note: string }) => financeApi.updateProject(v.id, { note: v.note }), 'Сохранено')
  const archive = useFinMutation((id: string) => financeApi.updateProject(id, { archived: true }), 'Проект в архиве')
  const del = useFinMutation((id: string) => financeApi.removeProject(id), 'Проект удалён')

  const [cellFor, setCellFor] = useState<{ project: Project; ym: string; plan?: MatrixPlan; scheduled: number } | null>(null)
  const [editProject, setEditProject] = useState<Project | null>(null)

  const removeProjectConfirm = (p: Project) => {
    if (confirm(`Удалить проект «${p.name}»? Удалятся его плановые оплаты и доходные операции.`)) del.mutate(p.id)
  }
  const monthTotal = (m: string) => totals.perMonth.find(x => x.ym === m)?.total ?? 0

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <MonthRangeNav start={months[0]} onChange={onNavigate} />
        <span className="text-xs text-surface-400">Ячейка — поступление за месяц. «＋» добавляет план или сразу оплату.</span>
      </div>

      <TableCard scroll>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
              <th className={clsx(TH, 'min-w-[170px]')}>Проект</th>
              <th className={clsx(TH, 'text-right')}>Сумма</th>
              {months.map(m => <th key={m} className={clsx(TH, 'text-right capitalize whitespace-nowrap')}>{monthLabel(m)}</th>)}
              <th className={clsx(TH, 'min-w-[150px]')}>Комментарий</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const scheduled = r.cells.reduce((s, c) => s + c.plans.reduce((x, p) => x + p.amount, 0), 0)
              const pct = r.project.tariff ? Math.round((r.paidLife / r.project.tariff) * 100) : 0
              return (
                <tr key={r.project.id} className={TR}>
                  <td className={TD}>
                    <div className="font-medium text-surface-800 dark:text-surface-200">{r.project.name}</div>
                    <div className="mt-1.5 w-32"><ProgressBar pct={pct} color="#16a34a" /></div>
                    <span className="text-xs text-surface-400 tabular-nums">{money(r.paidLife)} / {money(r.project.tariff)}</span>
                  </td>
                  <td className={clsx(TD, 'text-right tabular-nums text-surface-500')}>{money(r.project.tariff)}</td>
                  {months.map(m => {
                    const cell = r.cells.find(c => c.ym === m)
                    const plans = cell?.plans ?? []
                    return (
                      <td key={m} className={clsx(TD, 'text-right')}>
                        {plans.length === 0 ? (
                          <IconBtn onClick={() => setCellFor({ project: r.project, ym: m, scheduled })} title="Добавить поступление">
                            <Plus size={14} />
                          </IconBtn>
                        ) : (
                          <div className="flex justify-end flex-wrap gap-1">
                            {plans.map(p => (
                              <Badge
                                key={p.id} tone={p.status === 'received' ? 'ok' : 'wait'} check={p.status === 'received'}
                                onClick={() => setCellFor({ project: r.project, ym: m, plan: p, scheduled })}
                                title={p.status === 'received' ? 'Получено — нажмите для управления' : 'Запланировано — нажмите, чтобы отметить оплату'}
                              >
                                {money(p.amount)}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                    )
                  })}
                  <td className={TD}>
                    <CellInput value={r.project.note} onCommit={v => updateNote.mutate({ id: r.project.id, note: v })} />
                  </td>
                  <RowActions
                    onEdit={() => setEditProject(r.project)}
                    onArchive={() => archive.mutate(r.project.id)}
                    onDelete={() => removeProjectConfirm(r.project)}
                  />
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold border-t border-surface-100 dark:border-surface-700">
              <td className={TD}>Итого</td>
              <td className={clsx(TD, 'text-right tabular-nums')}>{money(totals.tariff)}</td>
              {months.map(m => <td key={m} className={clsx(TD, 'text-right tabular-nums')}>{money(monthTotal(m))}</td>)}
              <td /><td />
            </tr>
          </tfoot>
        </table>
      </TableCard>

      {cellFor && <DevCellModal project={cellFor.project} ym={cellFor.ym} plan={cellFor.plan} scheduled={cellFor.scheduled} onClose={() => setCellFor(null)} />}
      {editProject && <ProjectModal direction={direction} project={editProject} onClose={() => setEditProject(null)} />}
    </div>
  )
}

/* ================================================================== *
 * Design
 * ================================================================== */
function DesignDetail({ ym }: { ym: string }) {
  const [start, setStart] = useState<string | undefined>(undefined)
  const { data, isLoading } = useQuery<DesignDetailData>({
    queryKey: ['finance', 'income-detail', 'design', ym, start ?? null],
    queryFn: () => financeApi.incomeDirectionDetail('design', ym, start),
  })
  const { data: allProjects = [] } = useQuery<Project[]>({ queryKey: ['finance', 'projects'], queryFn: financeApi.projects })
  const archived: ArchivedItem[] = allProjects.filter(p => p.direction === 'design' && p.archived)

  const [workFor, setWorkFor] = useState<SimpleWork | 'new' | null>(null)
  const [payFor, setPayFor] = useState<SimpleWork | null>(null)

  if (isLoading || !data) return <Loading />
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="Ожидается за месяц" value={money(data.stats.expected)} />
        <Stat label="Получено за месяц" value={money(data.stats.received)} tone="pos" />
        <Stat label="Всего сумма" value={money(data.stats.total)} />
      </div>

      <div className="flex items-center justify-between">
        <SectionTitle>Разовые работы</SectionTitle>
        <button className="btn-secondary text-sm inline-flex items-center gap-1.5" onClick={() => setWorkFor('new')}>
          <Plus size={15} /> Добавить работу
        </button>
      </div>
      <SimpleWorksTable items={data.simple} onPay={setPayFor} onEdit={w => setWorkFor(w)} />

      {data.matrix.rows.length > 0 && (
        <>
          <SectionTitle className="pt-2">Брендбуки и логобуки · оплата по месяцам</SectionTitle>
          <MatrixTable direction="design" months={data.matrix.months} rows={data.matrix.rows} totals={data.matrix.totals} onNavigate={setStart} />
        </>
      )}

      <ArchivedProjects items={archived} />

      {workFor && <WorkModal work={workFor === 'new' ? undefined : workFor} onClose={() => setWorkFor(null)} />}
      {payFor && <RecordIncomeModal work={payFor} onClose={() => setPayFor(null)} />}
    </div>
  )
}

function SimpleWorksTable({ items, onPay, onEdit }: {
  items: SimpleWork[]; onPay: (w: SimpleWork) => void; onEdit: (w: SimpleWork) => void
}) {
  const updateNote = useFinMutation((v: { id: string; note: string }) => financeApi.updateProject(v.id, { note: v.note }), 'Сохранено')
  const archive = useFinMutation((id: string) => financeApi.updateProject(id, { archived: true }), 'Работа в архиве')

  if (items.length === 0)
    return <div className="card"><EmptyState icon={<FolderOpen size={26} />}>Нет разовых работ — нажмите «＋ Добавить работу»</EmptyState></div>

  return (
    <TableCard scroll>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
            <th className={TH}>Название</th>
            <th className={TH}>Дата</th>
            <th className={clsx(TH, 'text-right')}>Сумма</th>
            <th className={clsx(TH, 'min-w-[170px]')}>Комментарий</th>
            <th className={TH}>Статус</th>
            <th className={TH} />
          </tr>
        </thead>
        <tbody>
          {items.map(w => {
            const p = w.project
            const isPaid = p.tariff > 0 && w.paid >= p.tariff
            return (
              <tr key={p.id} className={TR}>
                <td className={clsx(TD, 'font-medium text-surface-800 dark:text-surface-200')}>{p.name}</td>
                <td className={clsx(TD, 'text-surface-500 whitespace-nowrap')}>{formatDate(p.contractDate)}</td>
                <td className={clsx(TD, 'text-right tabular-nums')}>{money(p.tariff)}</td>
                <td className={TD}><CellInput value={p.note} onCommit={v => updateNote.mutate({ id: p.id, note: v })} /></td>
                <td className={TD}>
                  {isPaid
                    ? <Badge tone="ok" check>оплачено</Badge>
                    : <button className="btn-primary text-xs px-2.5 py-1" onClick={() => onPay(w)}>Записать оплату</button>}
                </td>
                <td className={clsx(TD, 'text-right whitespace-nowrap')}>
                  <IconBtn onClick={() => onEdit(w)} title="Редактировать"><Pencil size={15} /></IconBtn>
                  <IconBtn onClick={() => archive.mutate(p.id)} title="В архив"><Archive size={15} /></IconBtn>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </TableCard>
  )
}

/* ================================================================== *
 * Архив проектов
 * ================================================================== */
function ArchivedProjects({ items }: { items: ArchivedItem[] }) {
  const [open, setOpen] = useState(false)
  const restore = useFinMutation((id: string) => financeApi.updateProject(id, { archived: false }), 'Возвращено из архива')
  const del = useFinMutation((id: string) => financeApi.removeProject(id), 'Проект удалён')
  if (items.length === 0) return null

  const removeConfirm = (it: ArchivedItem) => {
    if (confirm(`Удалить проект «${it.name}» навсегда? Удалятся его плановые оплаты и доходные операции.`)) del.mutate(it.id)
  }

  return (
    <div>
      <button className="btn-ghost text-sm inline-flex items-center gap-1" onClick={() => setOpen(v => !v)}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Архив проектов ({items.length})
      </button>
      {open && (
        <TableCard className="mt-2" scroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
                <th className={TH}>Проект</th>
                <th className={TH}>Дата контракта</th>
                <th className={clsx(TH, 'text-right')}>Тариф</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} className={clsx(TR, 'opacity-75')}>
                  <td className={clsx(TD, 'font-medium')}>{it.name}</td>
                  <td className={clsx(TD, 'text-surface-500 whitespace-nowrap')}>{formatDate(it.contractDate)}</td>
                  <td className={clsx(TD, 'text-right tabular-nums text-surface-500')}>{money(it.tariff)}</td>
                  <td className={clsx(TD, 'text-right whitespace-nowrap')}>
                    <button className="btn-ghost text-xs inline-flex items-center gap-1" onClick={() => restore.mutate(it.id)} disabled={restore.isPending}>
                      <Undo2 size={14} /> Вернуть
                    </button>
                    <IconBtn onClick={() => removeConfirm(it)} title="Удалить проект" danger><Trash2 size={15} /></IconBtn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
    </div>
  )
}

/* ================================================================== *
 * Модалки
 * ================================================================== */
function ProjectModal({ direction, project, onClose }: { direction: Dir; project?: Project; onClose: () => void }) {
  const isEdit = !!project
  const [name, setName] = useState(project?.name ?? '')
  const [tariff, setTariff] = useState(project ? String(project.tariff) : '')
  const [contractDate, setContractDate] = useState(project?.contractDate?.slice(0, 10) ?? todayISO())
  const [multiMonth, setMultiMonth] = useState(project?.multiMonth ?? false)
  const amt = num(tariff)

  const create = useFinMutation((d: any) => financeApi.createProject(d), 'Проект добавлен')
  const update = useFinMutation((d: any) => financeApi.updateProject(project!.id, d), 'Сохранено')
  const busy = create.isPending || update.isPending

  const save = () => {
    if (!name.trim()) return
    const data: any = { name: name.trim(), tariff: amt > 0 ? amt : 0, contractDate: contractDate || undefined }
    if (direction === 'design') data.multiMonth = multiMonth
    if (isEdit) update.mutate(data, { onSuccess: onClose })
    else create.mutate({ ...data, direction }, { onSuccess: onClose })
  }

  return (
    <Modal open onClose={onClose} title={`${isEdit ? 'Проект' : 'Новый проект'} · ${dirLabel(direction)}`}>
      <div className="space-y-3">
        <Field label="Название">
          <input autoFocus value={name} onChange={e => setName(e.target.value)} className="input" placeholder="Название клиента / проекта" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={direction === 'smm' ? 'Тариф / мес, сомони' : 'Сумма, сомони'}>
            <input inputMode="decimal" value={tariff} onChange={e => setTariff(e.target.value)} className="input" placeholder="0" />
          </Field>
          <Field label="Дата контракта">
            <input type="date" value={contractDate} onChange={e => setContractDate(e.target.value)} className="input" />
          </Field>
        </div>
        {direction === 'design' && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={multiMonth} onChange={e => setMultiMonth(e.target.checked)} />
            Брендбук / логобук — оплата по месяцам
          </label>
        )}
        <ModalFoot>
          <button onClick={onClose} className="btn-secondary text-sm">Отмена</button>
          <button onClick={save} disabled={!name.trim() || busy} className="btn-primary text-sm">
            {busy ? 'Сохранение…' : isEdit ? 'Сохранить' : 'Добавить проект'}
          </button>
        </ModalFoot>
      </div>
    </Modal>
  )
}

function PayPartModal({ project, partNo, ym, scheduled, onClose }: {
  project: Project; partNo: 1 | 2; ym: string; scheduled: number; onClose: () => void
}) {
  const { accounts, accountId, setAccountId } = useAccountSelect()
  const [amount, setAmount] = useState(String(partNo === 1 ? project.tariff : 0))
  const [date, setDate] = useState(todayISO())
  const amt = num(amount)
  const remaining = project.tariff - scheduled
  const overLimit = project.tariff > 0 && amt > remaining
  const canSave = amt > 0 && !!accountId && !overLimit

  const pay = useFinMutation((d: any) => financeApi.payNow(d), 'Оплата записана')
  const save = () => {
    if (!canSave) return
    pay.mutate({ projectId: project.id, ym, partNo, amount: amt, accountId, date }, { onSuccess: onClose })
  }

  return (
    <Modal open onClose={onClose} title={`Оплата · ${project.name} · часть ${partNo}`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Сумма, сомони">
            <input autoFocus inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="input" />
          </Field>
          <Field label="Дата оплаты">
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" />
          </Field>
        </div>
        <AccountField accounts={accounts} value={accountId} onChange={setAccountId} />
        {overLimit
          ? <p className="text-xs text-red-500">Больше остатка за месяц. Доступно ещё {money(Math.max(0, remaining))} из тарифа {money(project.tariff)}.</p>
          : <p className="text-xs text-surface-400">Оплата этой части создаёт доход. Остаток за месяц: {money(Math.max(0, remaining))}.</p>}
        <ModalFoot>
          <button onClick={onClose} className="btn-secondary text-sm">Отмена</button>
          <button onClick={save} disabled={!canSave || pay.isPending} className="btn-primary text-sm">
            {pay.isPending ? 'Запись…' : 'Записать оплату'}
          </button>
        </ModalFoot>
      </div>
    </Modal>
  )
}

function ReceiveModal({ plannedId, amount, onClose }: { plannedId: string; amount: number; onClose: () => void }) {
  const { accounts, accountId, setAccountId } = useAccountSelect()
  const [date, setDate] = useState(todayISO())
  const receive = useFinMutation((d: any) => financeApi.receivePlanned(plannedId, d), 'Отмечено полученным')
  const save = () => { if (!accountId) return; receive.mutate({ accountId, date }, { onSuccess: onClose }) }

  return (
    <Modal open onClose={onClose} title={`Получено · ${money(amount)}`}>
      <div className="space-y-3">
        <AccountField accounts={accounts} value={accountId} onChange={setAccountId} />
        <Field label="Дата">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" />
        </Field>
        <ModalFoot>
          <button onClick={onClose} className="btn-secondary text-sm">Отмена</button>
          <button onClick={save} disabled={!accountId || receive.isPending} className="btn-primary text-sm">
            {receive.isPending ? 'Подтверждение…' : 'Подтвердить'}
          </button>
        </ModalFoot>
      </div>
    </Modal>
  )
}

function DevCellModal({ project, ym, plan, scheduled, onClose }: {
  project: Project; ym: string; plan?: MatrixPlan; scheduled: number; onClose: () => void
}) {
  const { accounts, accountId, setAccountId } = useAccountSelect()
  const [amount, setAmount] = useState(String(plan?.amount ?? ''))
  const [paidNow, setPaidNow] = useState(false)
  const [date, setDate] = useState(todayISO())
  const amt = num(amount)
  const remaining = project.tariff - scheduled
  const overLimit = project.tariff > 0 && amt > remaining

  const receive = useFinMutation((d: any) => financeApi.receivePlanned(plan!.id, d), 'Отмечено полученным')
  const removePlan = useFinMutation(() => financeApi.removePlanned(plan!.id), 'План удалён')
  const unreceive = useFinMutation(() => financeApi.unreceivePlanned(plan!.id), 'Оплата отменена')
  const createPlan = useFinMutation((d: any) => financeApi.createPlanned(d), 'План добавлен')
  const payNow = useFinMutation((d: any) => financeApi.payNow(d), 'Оплата записана')
  const busy = receive.isPending || removePlan.isPending || unreceive.isPending || createPlan.isPending || payNow.isPending

  const markReceived = () => { if (!accountId) return; receive.mutate({ accountId, date }, { onSuccess: onClose }) }
  const saveNew = () => {
    if (!(amt > 0) || overLimit) return
    if (paidNow) { if (!accountId) return; payNow.mutate({ projectId: project.id, ym, partNo: 1, amount: amt, accountId, date }, { onSuccess: onClose }) }
    else createPlan.mutate({ projectId: project.id, ym, partNo: 1, amount: amt }, { onSuccess: onClose })
  }

  return (
    <Modal open onClose={onClose} title={`${project.name} · ${monthLabel(ym)}`}>
      {plan ? (
        <div className="space-y-3">
          {plan.status === 'received' ? (
            <p className="text-sm">Поступление <b>{money(plan.amount)}</b> отмечено как полученное.</p>
          ) : (
            <>
              <p className="text-sm">Запланировано <b>{money(plan.amount)}</b>. Отметить как полученное?</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Дата оплаты">
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" />
                </Field>
                <AccountField accounts={accounts} value={accountId} onChange={setAccountId} />
              </div>
            </>
          )}
          <ModalFoot>
            {plan.status === 'received'
              ? <button onClick={() => unreceive.mutate(undefined, { onSuccess: onClose })} disabled={busy} className="btn-secondary text-sm text-red-500 mr-auto">Отменить оплату</button>
              : <button onClick={() => removePlan.mutate(undefined, { onSuccess: onClose })} disabled={busy} className="btn-secondary text-sm text-red-500 mr-auto">Удалить план</button>}
            <button onClick={onClose} className="btn-secondary text-sm">Закрыть</button>
            {plan.status === 'expected' && (
              <button onClick={markReceived} disabled={!accountId || busy} className="btn-primary text-sm">Отметить полученным</button>
            )}
          </ModalFoot>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Сумма, сомони">
            <input autoFocus inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="input" />
          </Field>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={paidNow} onChange={e => setPaidNow(e.target.checked)} />
            Уже получено (создать доход)
          </label>
          {paidNow && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Дата оплаты">
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" />
              </Field>
              <AccountField accounts={accounts} value={accountId} onChange={setAccountId} />
            </div>
          )}
          {overLimit
            ? <p className="text-xs text-red-500">Больше остатка по проекту. Доступно ещё {money(Math.max(0, remaining))} из {money(project.tariff)}.</p>
            : <p className="text-xs text-surface-400">Без галочки — план на {monthLabel(ym)}. С галочкой — деньги уже получены. Остаток: {money(Math.max(0, remaining))}.</p>}
          <ModalFoot>
            <button onClick={onClose} className="btn-secondary text-sm">Отмена</button>
            <button onClick={saveNew} disabled={!(amt > 0) || overLimit || busy} className="btn-primary text-sm">
              {paidNow ? 'Записать оплату' : 'Добавить план'}
            </button>
          </ModalFoot>
        </div>
      )}
    </Modal>
  )
}

function WorkModal({ work, onClose }: { work?: SimpleWork; onClose: () => void }) {
  const p = work?.project
  const isEdit = !!work
  const [name, setName] = useState(p?.name ?? '')
  const [tariff, setTariff] = useState(p ? String(p.tariff) : '')
  const [date, setDate] = useState(p?.contractDate?.slice(0, 10) ?? todayISO())
  const [note, setNote] = useState(p?.note ?? '')
  const amt = num(tariff)

  const create = useFinMutation((d: any) => financeApi.createProject(d), 'Работа добавлена')
  const update = useFinMutation((d: any) => financeApi.updateProject(p!.id, d), 'Сохранено')
  const del = useFinMutation(() => financeApi.removeProject(p!.id), 'Работа удалена')
  const busy = create.isPending || update.isPending || del.isPending

  const save = () => {
    if (!name.trim()) return
    const data: any = { name: name.trim(), tariff: amt > 0 ? amt : 0, contractDate: date || undefined, note: note.trim() || undefined, multiMonth: false }
    if (isEdit) update.mutate(data, { onSuccess: onClose })
    else create.mutate({ ...data, direction: 'design' }, { onSuccess: onClose })
  }
  const remove = () => {
    if (p && confirm(`Удалить работу «${p.name}»? Удалятся её плановые оплаты и доходные операции.`)) del.mutate(undefined, { onSuccess: onClose })
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Работа' : 'Новая работа'}>
      <div className="space-y-3">
        <Field label="Название">
          <input autoFocus value={name} onChange={e => setName(e.target.value)} className="input" placeholder="Логотип, флаер…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Сумма, сомони">
            <input inputMode="decimal" value={tariff} onChange={e => setTariff(e.target.value)} className="input" placeholder="0" />
          </Field>
          <Field label="Дата">
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" />
          </Field>
        </div>
        <Field label="Комментарий">
          <input value={note} onChange={e => setNote(e.target.value)} className="input" />
        </Field>
        {work && work.paid > 0 && (
          <p className="text-xs text-green-600 dark:text-green-400">Оплачено {money(work.paid)} из {money(work.project.tariff)}.</p>
        )}
        <ModalFoot>
          {isEdit && <button onClick={remove} disabled={busy} className="btn-secondary text-sm text-red-500 mr-auto">Удалить работу</button>}
          <button onClick={onClose} className="btn-secondary text-sm">Отмена</button>
          <button onClick={save} disabled={!name.trim() || busy} className="btn-primary text-sm">
            {busy ? 'Сохранение…' : isEdit ? 'Сохранить' : 'Добавить'}
          </button>
        </ModalFoot>
      </div>
    </Modal>
  )
}

function RecordIncomeModal({ work, onClose }: { work: SimpleWork; onClose: () => void }) {
  const project = work.project
  const remaining = Math.max(0, project.tariff - work.paid)
  const { accounts, accountId, setAccountId } = useAccountSelect()
  const [amount, setAmount] = useState(String(remaining || project.tariff))
  const [date, setDate] = useState(todayISO())
  const amt = num(amount)
  const overLimit = project.tariff > 0 && amt > remaining
  const canSave = amt > 0 && !!accountId && !overLimit

  const pay = useFinMutation((d: any) => financeApi.payNow(d), 'Оплата записана')
  const save = () => {
    if (!canSave) return
    pay.mutate({ projectId: project.id, ym: ymOf(date), partNo: 1, amount: amt, accountId, date }, { onSuccess: onClose })
  }

  return (
    <Modal open onClose={onClose} title={`Оплата · ${project.name}`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Сумма, сомони">
            <input autoFocus inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="input" />
          </Field>
          <Field label="Дата оплаты">
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" />
          </Field>
        </div>
        <AccountField accounts={accounts} value={accountId} onChange={setAccountId} />
        {overLimit && <p className="text-xs text-red-500">Больше остатка. Доступно ещё {money(remaining)} из {money(project.tariff)}.</p>}
        <ModalFoot>
          <button onClick={onClose} className="btn-secondary text-sm">Отмена</button>
          <button onClick={save} disabled={!canSave || pay.isPending} className="btn-primary text-sm">
            {pay.isPending ? 'Запись…' : 'Записать оплату'}
          </button>
        </ModalFoot>
      </div>
    </Modal>
  )
}

// Активность команды — единая лента действий всех сотрудников (включая
// финансовые действия сооснователя) для основателя. Только чтение: журнал
// пишется бэкендом на каждое изменение. Данные из /activity-log/team
// (объединение общего журнала и финансового).
import { useMemo, useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Loader2, ChevronDown, Radio, Clock } from 'lucide-react'
import { activityLogApi, usersApi, workShiftsApi, financeApi } from '@/services/api.service'
import { getRoleLabel } from '@/lib/permissions'
import { useAuthStore } from '@/store/auth.store'
import toast from 'react-hot-toast'
import ShiftsTimesheet from './ShiftsTimesheet'
import ShiftSchedules from './ShiftSchedules'

// ─── Ярлыки действий общего журнала (enum → человекочитаемо) ──────────
const ACTION_LABELS: Record<string, string> = {
  LOGIN: 'Вошёл в систему', LOGOUT: 'Вышел из системы', REGISTER: 'Регистрация',
  PASSWORD_CHANGE: 'Сменил пароль', PASSWORD_RESET: 'Сбросил пароль',
  TASK_CREATE: 'Создал задачу', TASK_UPDATE: 'Изменил задачу', TASK_DELETE: 'Удалил задачу',
  TASK_STATUS: 'Сменил статус задачи', TASK_ASSIGN: 'Назначил исполнителя',
  PROJECT_CREATE: 'Создал проект', PROJECT_UPDATE: 'Изменил проект', PROJECT_DELETE: 'Удалил проект',
  PROJECT_ARCHIVE: 'Архивировал проект', PROJECT_RESTORE: 'Восстановил проект',
  MEMBER_ADD: 'Добавил участника', MEMBER_REMOVE: 'Убрал участника',
  COMMENT_CREATE: 'Оставил комментарий', COMMENT_UPDATE: 'Изменил комментарий', COMMENT_DELETE: 'Удалил комментарий',
  EMPLOYEE_CREATE: 'Добавил сотрудника', EMPLOYEE_UPDATE: 'Изменил сотрудника', EMPLOYEE_DELETE: 'Удалил сотрудника',
  EMPLOYEE_SUB_ADMIN: 'Изменил доступ сотрудника',
  FILE_UPLOAD: 'Загрузил файл', FILE_DELETE: 'Удалил файл',
  REPORT_CREATE: 'Создал отчёт', REPORT_UPDATE: 'Изменил отчёт', REPORT_DELETE: 'Удалил отчёт',
  TIMER_START: 'Запустил таймер', TIMER_STOP: 'Остановил таймер', TIME_LOG: 'Записал время', TIME_DELETE: 'Удалил запись времени',
  STORY_UPDATE: 'Обновил сторис',
  TASK_RESULT_SUBMIT: 'Сдал задачу на проверку', TASK_REVIEW_APPROVE: 'Принял задачу',
  TASK_REVIEW_RETURN: 'Вернул задачу на доработку', TASK_PROGRESS_UPDATE: 'Обновил прогресс задачи',
  PROFILE_UPDATE: 'Обновил профиль', AVATAR_UPDATE: 'Сменил аватар',
  USER_ACTIVATE: 'Активировал пользователя', USER_DEACTIVATE: 'Деактивировал пользователя',
  LEAD_PROGRESS: 'Продвинул лида по воронке',
}

type Item = {
  id: string; source: 'general' | 'finance'; userId: string | null;
  userName: string | null; userAvatar: string | null; userRole: string | null;
  action: string; entity: string | null; entityId: string | null; entityName: string | null;
  route: string | null; details: any; createdAt: string;
}

// ─── Разделы ──────────────────────────────────────────────────────────
function sectionOf(item: Item): { key: string; label: string } {
  if (item.source === 'finance') return { key: 'finance', label: 'Финансы' }
  const a = item.action || ''
  if (a.startsWith('TASK')) return { key: 'task', label: 'Задачи' }
  if (a.startsWith('PROJECT') || a.startsWith('MEMBER')) return { key: 'proj', label: 'Проекты' }
  if (a.startsWith('COMMENT')) return { key: 'cmt', label: 'Комментарии' }
  if (a.startsWith('EMPLOYEE') || a.startsWith('USER')) return { key: 'emp', label: 'Сотрудники' }
  if (a.startsWith('FILE')) return { key: 'file', label: 'Файлы' }
  if (a.startsWith('REPORT')) return { key: 'report', label: 'Отчёты' }
  if (a.startsWith('TIME')) return { key: 'time', label: 'Время' }
  if (a.startsWith('STORY')) return { key: 'story', label: 'Сторис' }
  if (a.startsWith('LEAD') || a.startsWith('CLIENT')) return { key: 'client', label: 'Клиенты' }
  if (['LOGIN', 'LOGOUT', 'REGISTER', 'PASSWORD_CHANGE', 'PASSWORD_RESET'].includes(a)) return { key: 'auth', label: 'Вход' }
  return { key: 'other', label: 'Прочее' }
}

const SECTION_BADGE: Record<string, string> = {
  finance: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  task:    'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  proj:    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  client:  'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  cmt:     'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  emp:     'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  file:    'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  report:  'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  time:    'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300',
  story:   'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
  auth:    'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  other:   'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
}

const SECTION_FILTERS = [
  { key: 'all', label: 'Все разделы' }, { key: 'finance', label: 'Финансы' },
  { key: 'task', label: 'Задачи' }, { key: 'proj', label: 'Проекты' },
  { key: 'client', label: 'Клиенты' }, { key: 'cmt', label: 'Комментарии' },
  { key: 'auth', label: 'Вход' },
]

// ─── Утилиты ──────────────────────────────────────────────────────────
const AV_COLORS = ['#0ea5e9', '#8b5cf6', '#0d9f6e', '#d97706', '#2563eb', '#7c3aed', '#059669', '#c026d3', '#0891b2', '#db2777']
function avColor(id: string) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV_COLORS[h % AV_COLORS.length] }
function initials(name?: string | null) { const p = String(name || '?').trim().split(/\s+/); return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?' }
const money = (n: any) => Number(n || 0).toLocaleString('ru-RU')

function actionLabel(item: Item): string {
  if (item.source === 'finance') return String(item.action || '').replace(/\s*\(финансы\)\s*$/i, '').replace(/\s*\(ЗП\)\s*$/i, '')
  return ACTION_LABELS[item.action] || item.action || 'Действие'
}

function asObj(v: any): Record<string, any> { return v && typeof v === 'object' && !Array.isArray(v) ? v : {} }

/** Сумма/тип для финансовой операции — из тела запроса. */
function financeMeta(details: any): { amount: number | null; type: string | null; name: string | null } {
  const input = asObj(details?.input); const after = asObj(details?.after)
  const amount = input.amount ?? after.amount
  return {
    amount: amount != null && !isNaN(Number(amount)) ? Number(amount) : null,
    type: input.type ?? after.type ?? null,
    name: (typeof input.name === 'string' ? input.name : typeof after.name === 'string' ? after.name : null),
  }
}

const DETAIL_LABELS: Record<string, string> = {
  amount: 'Сумма', type: 'Тип', name: 'Название', date: 'Дата', ym: 'Месяц',
  status: 'Статус', tariff: 'Тариф', direction: 'Направление', comment: 'Комментарий',
  salary: 'Оклад', dueDate: 'Срок', note: 'Примечание', kind: 'Вид выплаты', partNo: 'Часть оплаты',
}
function fmtDetail(key: string, val: any): string {
  if (val == null || val === '') return '—'
  if (['amount', 'tariff', 'salary'].includes(key)) return money(val) + ' с.'
  if (typeof val === 'boolean') return val ? 'Да' : 'Нет'
  if (key === 'type') return ({ income: 'Доход', expense: 'Расход', transfer: 'Перевод', saving: 'Накопление' } as any)[val] || String(val)
  if (key === 'status') return ({ active: 'Активный', paused: 'На паузе', lead: 'Лид', done: 'Завершён', archived: 'В архиве', expected: 'Ожидается', received: 'Получено', fired: 'Уволен' } as any)[val] || String(val)
  if (key === 'kind') return ({ advance: 'Аванс', bonus: 'Бонус', salary: 'Зарплата', rent: 'Аренда', subscription: 'Подписка' } as any)[val] || String(val)
  if (typeof val === 'object') return ''
  return String(val).slice(0, 80)
}
function collectPairs(details: any): { label: string; value: string; before?: string }[] {
  if (!details || typeof details !== 'object') return []
  const input = asObj(details.input); const before = asObj(details.before); const after = asObj(details.after)
  const hasSnap = Object.keys(after).length > 0 || Object.keys(before).length > 0
  const base = hasSnap ? { ...input, ...after } : { ...details, ...input }
  return Object.keys(base)
    .filter(k => DETAIL_LABELS[k])
    .map(k => {
      const value = fmtDetail(k, base[k])
      const bv = (k in before) && JSON.stringify(before[k]) !== JSON.stringify(base[k]) ? fmtDetail(k, before[k]) : undefined
      return { label: DETAIL_LABELS[k], value, before: bv }
    })
    .filter(p => p.value && p.value !== '—')
    .slice(0, 6)
}

// ─── Дни / время ──────────────────────────────────────────────────────
function dayKey(iso: string) { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }
function dayLabel(iso: string) {
  const d = new Date(iso); const now = new Date()
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const yest = new Date(now); yest.setDate(now.getDate() - 1)
  if (same(d, now)) return 'Сегодня · ' + d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  if (same(d, yest)) return 'Вчера · ' + d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

function periodFrom(period: string): string | undefined {
  if (period === 'all') return undefined
  const now = new Date()
  if (period === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.toISOString() }
  if (period === '7d') { const d = new Date(now); d.setDate(now.getDate() - 7); return d.toISOString() }
  if (period === '30d') { const d = new Date(now); d.setDate(now.getDate() - 30); return d.toISOString() }
  return undefined
}

// ═══════════════════════════════════════════════════════════════════════
export default function TeamActivityPage() {
  // Финансовую активность видит только основатель. Сервер её остальным не
  // отдаёт вовсе (teamFeed.includeFinance), здесь лишь убираем упоминания,
  // чтобы не предлагать фильтр, по которому всегда пусто.
  const isFounder = useAuthStore(s => s.user?.role) === 'founder'
  // Три раздела вместо простыни: смены за сегодня, табель месяца и лента
  // событий. Раньше шли подряд по вертикали — до ленты нужно было
  // прокручивать весь табель.
  // Первым открываем табель: за день его смотрят чаще, а «кто сейчас на
  // работе» видно и по сегодняшней колонке (решение владельца, 19.09.2026).
  const [tab, setTab] = useState<'today' | 'timesheet' | 'schedule' | 'feed'>('timesheet')
  // Блок штрафов раскрывается плиткой «Разобрать»: раньше он занимал
  // пол-экрана раньше, чем видно главное — кто на работе, а кого нет.
  const [finesOpen, setFinesOpen] = useState(false)
  const [userId, setUserId] = useState<string | undefined>(undefined)
  const [section, setSection] = useState('all')
  const [period, setPeriod] = useState('all')
  const [limit, setLimit] = useState(40)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const from = periodFrom(period)

  const { data: usersRaw } = useQuery({ queryKey: ['users-all'], queryFn: () => usersApi.list() })
  const users: any[] = useMemo(() => {
    const arr = Array.isArray(usersRaw) ? usersRaw : (usersRaw?.data ?? [])
    return [...arr].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'))
  }, [usersRaw])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['team-activity', userId ?? 'all', from ?? 'all', limit],
    queryFn: () => activityLogApi.team({ userId, from, limit }),
    refetchInterval: 30000,
    placeholderData: keepPreviousData,
  })

  const items: Item[] = data?.items ?? []
  const hasMore: boolean = !!data?.hasMore
  const shown = section === 'all' ? items : items.filter(i => sectionOf(i).key === section)

  // Группировка по дням
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: Item[] }>()
    for (const it of shown) {
      const k = dayKey(it.createdAt)
      if (!map.has(k)) map.set(k, { label: dayLabel(it.createdAt), items: [] })
      map.get(k)!.items.push(it)
    }
    return [...map.values()]
  }, [shown])

  const toggle = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    // Ширину не ограничиваем: это больше не самостоятельная страница, а
    // вкладка внутри «Сотрудников» — она должна занимать столько же места,
    // сколько список сотрудников рядом.
    <div className="pb-6">
      {/* Заголовок «Активность команды» убран (19.09.2026): страница уже
          называется «Сотрудники», а разделы подписаны вкладками — две шапки
          подряд только съедали экран. Отметка об автообновлении переехала
          вправо в строку вкладок. */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700 mb-4 overflow-x-auto">
        {([
          ['timesheet', 'Табель месяца'],
          ['today', 'Смены сегодня'],
          ['schedule', 'График работы'],
          ['feed', 'Лента событий'],
        ] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={'px-3.5 py-2 text-[13px] font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors '
              + (tab === k
                ? 'border-emerald-500 text-gray-900 dark:text-gray-100'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300')}>
            {label}
          </button>
        ))}
        <span className="ml-auto hidden sm:inline-flex items-center gap-1.5 text-[11px] text-gray-500 pb-2 pl-3 shrink-0">
          <Radio size={11} className="text-emerald-500" /> обновляется автоматически
        </span>
      </div>

      {tab === 'today' && (
        <>
          <ShiftsToday finesOpen={finesOpen} onToggleFines={() => setFinesOpen(o => !o)} />
          {finesOpen && <div className="mt-3"><LateFines /></div>}
          <div className="mt-3"><LateNotices /><ShiftEdits /></div>
        </>
      )}
      {tab === 'timesheet' && <ShiftsTimesheet />}
      {tab === 'schedule' && <ShiftSchedules />}

      {tab === 'feed' && (<>
      {/* Filters: who */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Chip active={!userId} onClick={() => setUserId(undefined)}>Все сотрудники</Chip>
          {users.map(u => (
            <Chip key={u.id} active={userId === u.id} onClick={() => setUserId(u.id)}>
              <span className="rounded-full grid place-items-center text-[9px] font-bold text-white shrink-0"
                    style={{ width: 18, height: 18, background: avColor(u.id) }}>
                {initials(u.name)}
              </span>
              {u.name}
            </Chip>
          ))}
        </div>
        <div className="flex-1" />
        <select value={period} onChange={e => { setPeriod(e.target.value); setLimit(40) }}
                className="text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5">
          <option value="all">За всё время</option>
          <option value="today">Сегодня</option>
          <option value="7d">7 дней</option>
          <option value="30d">30 дней</option>
        </select>
      </div>

      {/* Filters: section */}
      <div className="flex gap-1.5 flex-wrap mb-6">
        {SECTION_FILTERS.filter(s => isFounder || s.key !== 'finance').map(s => (
          <button key={s.key} onClick={() => setSection(s.key)}
                  className={'text-xs font-semibold px-2.5 py-1 rounded-lg border transition ' +
                    (section === s.key
                      ? 'bg-surface-100 dark:bg-surface-900/40 border-transparent text-surface-700 dark:text-surface-300'
                      : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500 hover:text-gray-700')}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Feed */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-surface-500" /></div>
      ) : shown.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <div className="font-medium">Пока нет действий</div>
          <div className="text-xs mt-1">По выбранным фильтрам активности не найдено.</div>
        </div>
      ) : (
        <>
          {groups.map(g => (
            <div key={g.label} className="mb-6">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2.5 px-0.5">{g.label}</div>
              <div className="flex flex-col gap-2">
                {g.items.map(it => {
                  const sec = sectionOf(it)
                  const fin = it.source === 'finance' ? financeMeta(it.details) : null
                  const pairs = collectPairs(it.details)
                  const isOpen = expanded.has(it.id)
                  return (
                    <div key={it.id}
                         className="bg-white dark:bg-gray-900 border rounded-xl px-4 py-3 flex gap-3 items-start transition border-gray-200 dark:border-gray-700">
                      <div className="w-9 h-9 rounded-full grid place-items-center text-white font-bold text-sm shrink-0"
                           style={{ background: avColor(it.userId || it.id) }}>
                        {initials(it.userName)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{it.userName || 'Система'}</span>
                          <span className="text-[11px] font-semibold text-gray-400">
                            {getRoleLabel(it.userRole)}
                          </span>
                          <span className={'text-[10.5px] font-bold px-2 py-0.5 rounded-md tracking-wide ' + (SECTION_BADGE[sec.key] || SECTION_BADGE.other)}>
                            {sec.label.toUpperCase()}
                          </span>
                        </div>
                        <div className="text-sm mt-1">
                          <b className="font-semibold">{actionLabel(it)}</b>
                          {it.entityName && <span className="text-gray-500"> — {it.entityName}</span>}
                          {fin?.name && !it.entityName && <span className="text-gray-500"> — «{fin.name}»</span>}
                        </div>
                        {fin?.amount != null && (
                          <div className="mt-1.5">
                            <span className={'text-sm font-bold tabular-nums ' + (fin.type === 'expense' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>
                              {fin.type === 'expense' ? '−' : '+'}{money(fin.amount)} с.
                            </span>
                          </div>
                        )}
                        {pairs.length > 0 && (
                          <button onClick={() => toggle(it.id)}
                                  className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-surface-600 dark:text-surface-400">
                            <ChevronDown size={13} className={'transition ' + (isOpen ? 'rotate-180' : '')} />
                            {isOpen ? 'скрыть детали' : 'детали'}
                          </button>
                        )}
                        {isOpen && pairs.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-dashed border-gray-200 dark:border-gray-700 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12.5px]">
                            {pairs.map((p, i) => (
                              <div key={i} className="contents">
                                <span className="text-gray-400">{p.label}</span>
                                <span>
                                  {p.before && <span className="text-gray-400 line-through mr-1.5">{p.before}</span>}
                                  <span className="font-medium">{p.value}</span>
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 tabular-nums shrink-0">{timeOf(it.createdAt)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {section !== 'all' && (
            <p className="text-center text-[11px] text-gray-400 mb-3">
              Фильтр по разделу применяется к загруженным записям. Нажмите «Показать ещё», чтобы подгрузить больше.
            </p>
          )}
          {hasMore && (
            <button onClick={() => setLimit(l => l + 40)} disabled={isFetching}
                    className="mx-auto flex items-center gap-2 text-sm font-semibold text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-6 py-2.5 hover:border-surface-400 disabled:opacity-60">
              {isFetching && <Loader2 size={15} className="animate-spin" />}
              Показать ещё
            </button>
          )}
        </>
      )}
      </>)}
    </div>
  )
}

function Chip({ children, active, onClick }: { children: ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick}
            className={'inline-flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-full border transition '
              + (active
                ? 'bg-surface-500 border-surface-500 text-white'
                : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300')}>
      {children}
    </button>
  )
}

/** Смены за сегодня: кто на работе, во сколько начал, сколько отработал.
 *  Живёт здесь же, где лента активности: у основателя это одна страница
 *  «что происходит в команде», разносить по двум смысла нет. */
/** Опоздания за день. Система их считает, но деньгами это становится только
 *  по нажатию владельца — молча списывать нельзя. Разбираем в тот же день:
 *  копилка за месяц не работала, провести можно было только всё разом. */
function LateFines() {
  const qc = useQueryClient()
  const role = useAuthStore(s => s.user?.role)
  const canFine = role === 'founder'
  const { data } = useQuery({
    queryKey: ['late-fines'],
    queryFn: () => financeApi.lateFines(),
    enabled: canFine,
    refetchInterval: 120_000,
  })
  const pending: any[] = data?.pending ?? []
  const fined: any[] = data?.fined ?? []
  const amount = Number(data?.amountPerLate) || 100

  // По умолчанию отмечены все, кого вообще можно оштрафовать.
  const [off, setOff] = useState<Set<string>>(new Set())
  const chosen = pending.filter(i => i.linked && !off.has(i.userId))
  const toggle = (id: string) => setOff(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const after = (msg: string) => {
    toast.success(msg)
    setOff(new Set())
    qc.invalidateQueries({ queryKey: ['late-fines'] })
    qc.invalidateQueries({ queryKey: ['finance'] })
  }
  const apply = useMutation({
    mutationFn: () => financeApi.applyLateFines({ date: data?.date, amount, userIds: chosen.map(i => i.userId) }),
    onSuccess: (r: any) => after(`Штрафов проведено: ${r?.created ?? 0}`),
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось провести'),
  })
  const forgive = useMutation({
    mutationFn: () => financeApi.forgiveLate({ date: data?.date }),
    onSuccess: () => after('День разобран'),
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось'),
  })
  const cancel = useMutation({
    mutationFn: (userId: string) => financeApi.cancelLateFine(data?.date, userId),
    onSuccess: () => after('Штраф отменён'),
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось отменить'),
  })

  if (!canFine || (!pending.length && !fined.length)) return null
  const dayLabel = data?.date
    ? new Date(`${data.date}T00:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    : 'сегодня'
  const total = chosen.length * amount

  return (
    <div className="flex flex-col gap-3 mb-3">
      {pending.length > 0 && (
        <div className="rounded-2xl border border-red-500/35 bg-red-500/[0.06] p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2.5">
            <span className="text-sm font-semibold">Опоздали {dayLabel} · {pending.length}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">приход после {data?.lateAfter ?? '09:30'} · по {amount} с.</span>
          </div>
          <div className="flex flex-col gap-1.5 mb-3">
            {pending.map(i => (
              <label key={i.userId}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 ${i.linked ? 'cursor-pointer' : 'opacity-60'}`}>
                <input type="checkbox" disabled={!i.linked} checked={i.linked && !off.has(i.userId)}
                  onChange={() => toggle(i.userId)}
                  className="w-[18px] h-[18px] shrink-0 accent-primary-600" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold truncate">
                    {i.name}
                    {!i.linked && <span className="ml-2 text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400">нет строки в ведомости</span>}
                  </span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    {getRoleLabel(i.role)} · пришёл в {i.arrivedAt}
                    {!i.linked && ' · штраф провести некуда'}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400 tabular-nums">+{i.lateMinutes} мин</span>
                <span className="shrink-0 w-[70px] text-right text-sm font-semibold tabular-nums text-red-600 dark:text-red-400">−{amount} с.</span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button disabled={apply.isPending || !chosen.length} onClick={() => apply.mutate()}
              className="h-11 px-4 rounded-xl bg-red-700 text-white text-sm font-bold disabled:opacity-50">
              {chosen.length ? `Провести штраф на ${total} с.` : 'Никто не выбран'}
            </button>
            <button disabled={forgive.isPending} onClick={() => forgive.mutate()}
              className="h-11 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-600 dark:text-gray-300 disabled:opacity-60">
              Простить всем
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              выбрано {chosen.length} из {pending.length}
            </span>
          </div>
        </div>
      )}

      {fined.length > 0 && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="text-sm font-semibold mb-2.5">Оштрафованы {dayLabel} · {fined.length}</div>
          <div className="flex flex-col gap-1.5">
            {fined.map(i => (
              <div key={i.userId} className="flex items-center gap-3 rounded-xl px-3 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold truncate">{i.name}</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">пришёл в {i.arrivedAt} · опоздание {i.lateMinutes} мин</span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-red-600 dark:text-red-400">−{i.amount} с.</span>
                <button disabled={cancel.isPending} onClick={() => cancel.mutate(i.userId)}
                  className="shrink-0 h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-300 disabled:opacity-60">
                  Отменить
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Просьбы «приду позже». Одобренная снимает опоздание за день — поэтому
 *  отвечать на них надо до того, как система подведёт итог. */
function LateNotices() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['work-shift-notices'],
    queryFn: () => workShiftsApi.notices(),
    refetchInterval: 120_000,
  })
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => workShiftsApi.decideNotice(id, approve),
    onSuccess: (_d, v) => {
      toast.success(v.approve ? 'Одобрено' : 'Отклонено')
      qc.invalidateQueries({ queryKey: ['work-shift-notices'] })
      qc.invalidateQueries({ queryKey: ['late-fines'] })
      qc.invalidateQueries({ queryKey: ['work-shifts-team'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось'),
  })
  const items: any[] = (data?.items ?? []).filter((n: any) => n.status === 'pending')
  if (!items.length) return null
  return (
    <div className="rounded-2xl border border-blue-500/35 bg-blue-500/[0.06] p-4 mb-3">
      <div className="text-sm font-semibold mb-2.5">Просьбы прийти позже · {items.length}</div>
      <div className="flex flex-col gap-2">
        {items.map(n => (
          <div key={n.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-2.5">
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold truncate">
                {n.name} · {n.date.slice(8, 10)}.{n.date.slice(5, 7)}
              </span>
              <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">
                придёт в {n.plannedTime} вместо {n.startTime}
                {n.reason ? ` · ${n.reason}` : ''}
              </span>
            </span>
            <span className="flex gap-2 shrink-0">
              <button disabled={decide.isPending} onClick={() => decide.mutate({ id: n.id, approve: true })}
                className="h-9 px-3 rounded-lg bg-emerald-600 text-white text-xs font-semibold disabled:opacity-60">Одобрить</button>
              <button disabled={decide.isPending} onClick={() => decide.mutate({ id: n.id, approve: false })}
                className="h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-300 disabled:opacity-60">Отказать</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Очередь правок времени: «забыл нажать в 9:00». До подтверждения в табеле
 *  остаётся то, что записала система, — поэтому решать надо здесь. */
function ShiftEdits() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['work-shift-edits'],
    queryFn: () => workShiftsApi.edits(),
    refetchInterval: 120_000,
  })
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => workShiftsApi.decideEdit(id, approve),
    onSuccess: (_d, v) => {
      toast.success(v.approve ? 'Время поправлено' : 'Отклонено')
      qc.invalidateQueries({ queryKey: ['work-shift-edits'] })
      qc.invalidateQueries({ queryKey: ['work-shifts-month'] })
      qc.invalidateQueries({ queryKey: ['work-shifts-team'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось'),
  })
  const items: any[] = data?.items ?? []
  if (!items.length) return null
  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] p-4 mb-3">
      <div className="text-sm font-semibold mb-2">Правки времени · {items.length}</div>
      <div className="flex flex-col gap-2">
        {items.map(r => (
          <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-2.5">
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold truncate">{r.name}</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                {r.date.slice(8, 10)}.{r.date.slice(5, 7)} · {r.field === 'start' ? 'начало' : 'конец'}:{' '}
                <span className="line-through">{r.currentTime ?? '—'}</span> → <b className="text-gray-700 dark:text-gray-200">{r.requestedTime}</b>
                {r.note ? ` · ${r.note}` : ''}
              </span>
            </span>
            <span className="flex gap-2 shrink-0">
              <button disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, approve: true })}
                className="h-9 px-3 rounded-lg bg-emerald-600 text-white text-xs font-semibold disabled:opacity-60">Подтвердить</button>
              <button disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, approve: false })}
                className="h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-300 disabled:opacity-60">Отклонить</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const PAUSE_LABEL: Record<string, string> = {
  lunch: 'обед', work: 'выехал по работе', personal: 'личное',
}

const ABSENCE_LABEL: Record<string, string> = {
  dayoff: 'отгул', vacation: 'отпуск', sick: 'больничный', holiday: 'праздник',
}

function ShiftsToday({ finesOpen, onToggleFines }: { finesOpen: boolean; onToggleFines: () => void }) {
  const qc = useQueryClient()
  const role = useAuthStore(s => s.user?.role)
  const canFine = role === 'founder'
  const { data } = useQuery({
    queryKey: ['work-shifts-team'],
    queryFn: () => workShiftsApi.team(),
    refetchInterval: 60_000,
  })
  // Счётчик неразобранных опозданий для плитки — тот же запрос, что у блока
  // штрафов, поэтому лишнего похода на сервер нет.
  const fines = useQuery({
    queryKey: ['late-fines'],
    queryFn: () => financeApi.lateFines(),
    enabled: canFine,
  })
  const [marking, setMarking] = useState<string | null>(null)
  const absence = useMutation({
    mutationFn: ({ employeeId, kind }: { employeeId: string; kind: 'dayoff' | 'vacation' | 'sick' | 'holiday' }) =>
      workShiftsApi.setAbsence({ employeeId, date: data?.date, kind }),
    onSuccess: () => {
      toast.success('Отмечено')
      setMarking(null)
      qc.invalidateQueries({ queryKey: ['work-shifts-team'] })
      qc.invalidateQueries({ queryKey: ['late-fines'] })
    },
    onError: () => toast.error('Не удалось отметить'),
  })
  const clearAbsence = useMutation({
    mutationFn: (employeeId: string) => workShiftsApi.removeAbsence(employeeId, data?.date),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['work-shifts-team'] }) },
  })

  const items: any[] = data?.items ?? []
  if (!items.length) return null

  /** «2:48» — часы:минуты, чтобы колонка читалась в столбик. */
  const hm = (min: number) => {
    if (!min) return '—'
    return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`
  }
  const dayLabel = data?.date
    ? new Date(`${data.date}T00:00:00`).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
    : ''
  const pendingFines = (fines.data?.pending ?? []).length

  // Порядок групп — как читают утром: кто на месте, кто отошёл, кого нет.
  const GROUPS: Array<{ key: string; label: string; cls: string }> = [
    { key: 'working', label: 'На работе', cls: 'text-emerald-600 dark:text-emerald-400' },
    { key: 'paused', label: 'На перерыве', cls: 'text-amber-600 dark:text-amber-400' },
    { key: 'closed', label: 'Смена закрыта', cls: 'text-gray-500 dark:text-gray-400' },
    { key: 'off', label: 'Нерабочий день', cls: 'text-blue-600 dark:text-blue-400' },
    { key: 'absent', label: 'Не вышли', cls: 'text-red-600 dark:text-red-400' },
  ]
  const countOf = (k: string) => items.filter(u => u.status === k).length

  /** Подпись под именем: должность плюс то, что важно именно сейчас. */
  const subOf = (u: any) => {
    const role = getRoleLabel(u.role)
    if (u.status === 'paused') return `${role} · ${PAUSE_LABEL[u.pauseKind] ?? 'перерыв'} с ${u.startedLabel ?? '—'}`
    if (u.status === 'off') return `${role} · ${ABSENCE_LABEL[u.absenceKind] ?? 'нерабочий день'}`
    if (u.floating) return `${role} · свободное начало`
    return u.startsAt ? `${role} · смена с ${u.startsAt}` : role
  }

  return (
    <div className="flex flex-col gap-3">

      {/* Четыре цифры вместо простыни: главное видно, не читая список */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {[
          { n: countOf('working'), l: 'на работе', cls: '' },
          { n: countOf('paused'), l: 'на перерыве', cls: 'text-amber-600 dark:text-amber-400' },
          { n: countOf('absent'), l: 'не вышли', cls: 'text-red-600 dark:text-red-400' },
        ].map(t => (
          <div key={t.l} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3.5 py-3">
            <div className={`text-xl font-bold tabular-nums ${t.cls}`}>{t.n}</div>
            <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5">{t.l}</div>
          </div>
        ))}
        {canFine && (
          <button onClick={onToggleFines}
            className={`rounded-xl border px-3.5 py-3 text-left flex items-center gap-3 transition-colors ${pendingFines
              ? 'border-red-500/40 bg-red-500/[0.07]'
              : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}>
            <span className="flex-1 min-w-0">
              <span className={`block text-xl font-bold tabular-nums ${pendingFines ? 'text-red-600 dark:text-red-400' : ''}`}>{pendingFines}</span>
              <span className="block text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                {pendingFines ? 'опоздания · не разобраны' : 'опозданий нет'}
              </span>
            </span>
            {pendingFines > 0 && (
              <span className="shrink-0 text-[12.5px] font-semibold text-red-600 dark:text-red-400">
                {finesOpen ? 'Свернуть' : 'Разобрать →'}
              </span>
            )}
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
          <Clock size={15} className="text-emerald-500 shrink-0" />
          <b className="text-sm font-bold">Смены сегодня</b>
          <span className="text-xs text-gray-500 first-letter:uppercase">{dayLabel}</span>
        </div>

        {/* Заголовки колонок: раньше приходилось догадываться, что есть что */}
        <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_92px_92px_104px] gap-3 px-4 pb-2 border-b border-gray-100 dark:border-gray-800">
          <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">Сотрудник</span>
          <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 text-right">Пришёл</span>
          <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 text-right">Сегодня</span>
          <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 text-right">За неделю</span>
        </div>

        <div className="px-4 pb-3">
          {GROUPS.map(g => {
            const list = items.filter(u => u.status === g.key)
            if (!list.length) return null
            return (
              <div key={g.key}>
                <div className={`text-[10.5px] font-bold uppercase tracking-wide pt-3 pb-1 ${g.cls}`}>
                  {g.label} · {list.length}
                </div>
                {list.map(u => (
                  <div key={u.id} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_92px_92px_104px] gap-x-3 gap-y-1.5 items-center py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-full grid place-items-center text-white font-bold text-[10px] shrink-0"
                        style={{ background: u.status === 'absent' || u.status === 'off' ? '#4b5563' : avColor(u.id) }}>
                        {initials(u.name)}
                      </div>
                      <div className="min-w-0">
                        <p className={`text-[13px] font-semibold truncate ${u.status === 'absent' || u.status === 'off' ? 'text-gray-500 dark:text-gray-400' : ''}`}>
                          {u.name}
                        </p>
                        <p className="text-[11px] text-gray-500 truncate">{subOf(u)}</p>
                      </div>
                    </div>

                    {u.status === 'absent' ? (
                      <div className="sm:col-span-3 flex justify-end gap-1.5">
                        {marking === u.id ? (
                          <>
                            {(['dayoff', 'vacation', 'sick'] as const).map(k => (
                              <button key={k} disabled={absence.isPending} onClick={() => absence.mutate({ employeeId: u.id, kind: k })}
                                className="h-8 px-2.5 rounded-lg bg-blue-500/12 text-blue-600 dark:text-blue-400 text-[11.5px] font-semibold disabled:opacity-60">
                                {ABSENCE_LABEL[k]}
                              </button>
                            ))}
                            <button onClick={() => setMarking(null)} className="h-8 px-2 rounded-lg text-[11.5px] text-gray-400">×</button>
                          </>
                        ) : (
                          <button onClick={() => setMarking(u.id)}
                            className="h-8 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[11.5px] text-gray-500 dark:text-gray-400">
                            отметить отгул
                          </button>
                        )}
                      </div>
                    ) : u.status === 'off' ? (
                      <div className="sm:col-span-3 flex justify-end">
                        <button onClick={() => clearAbsence.mutate(u.id)}
                          className="h-8 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[11.5px] text-gray-500 dark:text-gray-400">
                          снять отметку
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className={`text-[13px] tabular-nums text-right ${u.late ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-gray-600 dark:text-gray-300'}`}>
                          {u.startedLabel || '—'}
                          {u.excused && <span className="block text-[9.5px] text-blue-500">предупредил</span>}
                        </span>
                        <span className="text-[13px] font-semibold tabular-nums text-right">{hm(u.todayMinutes)}</span>
                        <span className="text-[12px] text-gray-400 tabular-nums text-right">{hm(u.weekMinutes)}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )
          })}

          <p className="pt-3 text-[11px] text-gray-400 dark:text-gray-500">
            Время прихода янтарным — опоздание по личному графику сотрудника. График правится во вкладке «График работы».
          </p>
        </div>
      </div>
    </div>
  )
}

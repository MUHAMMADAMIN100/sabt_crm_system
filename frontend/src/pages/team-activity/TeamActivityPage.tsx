// Активность команды — единая лента действий всех сотрудников (включая
// финансовые действия сооснователя) для основателя. Только чтение: журнал
// пишется бэкендом на каждое изменение. Данные из /activity-log/team
// (объединение общего журнала и финансового).
import { useMemo, useState, type ReactNode } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Loader2, ChevronDown, Radio } from 'lucide-react'
import { activityLogApi, usersApi } from '@/services/api.service'
import { getRoleLabel } from '@/lib/permissions'

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
const isCofounder = (role?: string | null) => role === 'co_founder'

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
    <div className="max-w-4xl mx-auto px-4 py-6 pb-16">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Активность команды</h1>
          <p className="text-sm text-gray-500 mt-1">
            Кто, что и когда сделал — задачи, проекты, клиенты и <b className="text-emerald-600 dark:text-emerald-400">финансы</b>.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 border border-gray-200 dark:border-gray-700 rounded-full px-2.5 py-1 shrink-0">
          <Radio size={12} className="text-emerald-500" /> обновляется автоматически
        </span>
      </div>

      {/* Filters: who */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Chip active={!userId} onClick={() => setUserId(undefined)}>Все сотрудники</Chip>
          {users.map(u => (
            <Chip key={u.id} active={userId === u.id} cofounder={isCofounder(u.role)} onClick={() => setUserId(u.id)}>
              <span className="rounded-full grid place-items-center text-[9px] font-bold text-white shrink-0"
                    style={{ width: 18, height: 18, background: isCofounder(u.role) ? '#dc2626' : avColor(u.id) }}>
                {initials(u.name)}
              </span>
              {u.name}
              {isCofounder(u.role) && <span className="text-[10px] font-bold text-red-600 dark:text-red-400">Сооснователь</span>}
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
        {SECTION_FILTERS.map(s => (
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
                  const cof = isCofounder(it.userRole)
                  const fin = it.source === 'finance' ? financeMeta(it.details) : null
                  const pairs = collectPairs(it.details)
                  const isOpen = expanded.has(it.id)
                  return (
                    <div key={it.id}
                         className={'bg-white dark:bg-gray-900 border rounded-xl px-4 py-3 flex gap-3 items-start transition '
                           + (cof ? 'border-l-[3px] border-l-red-500 border-gray-200 dark:border-gray-700' : 'border-gray-200 dark:border-gray-700')}>
                      <div className="w-9 h-9 rounded-full grid place-items-center text-white font-bold text-sm shrink-0"
                           style={{ background: cof ? '#dc2626' : avColor(it.userId || it.id) }}>
                        {initials(it.userName)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{it.userName || 'Система'}</span>
                          <span className={'text-[11px] font-semibold ' + (cof ? 'text-red-600 dark:text-red-400' : 'text-gray-400')}>
                            {cof ? 'Сооснователь' : getRoleLabel(it.userRole)}
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
    </div>
  )
}

function Chip({ children, active, cofounder, onClick }: { children: ReactNode; active?: boolean; cofounder?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick}
            className={'inline-flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-full border transition '
              + (active
                ? 'bg-surface-500 border-surface-500 text-white'
                : cofounder
                  ? 'bg-white dark:bg-gray-900 border-red-300 dark:border-red-800 text-gray-600 dark:text-gray-300 hover:border-red-400'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300')}>
      {children}
    </button>
  )
}

// Оргструктура компании — режим «Схема» на странице «Сотрудники».
// Строится из реальных сотрудников: каждый ставится в свой отдел по роли
// (или по должности как запасной вариант). Руководитель отдела — отдельная
// ячейка сверху, команда отдела — под ним. Без иконок/эмодзи, только аватары.
import { useNavigate } from 'react-router-dom'
import { Avatar } from '@/components/ui'
import { getRoleLabel } from '@/lib/permissions'
import clsx from 'clsx'

const OWNER_ROLES = ['founder', 'co_founder']

/** Отделы: руководитель (head) и роли команды (members). Порядок важен —
 *  первый подходящий отдел забирает сотрудника (пересечений ролей нет). */
const DEPARTMENTS: { key: string; title: string; head: string | null; members: string[] }[] = [
  { key: 'smm',   title: 'SMM',          head: 'smm_director',   members: ['smm_specialist', 'storymaker', 'scriptwriter', 'publisher', 'targetologist', 'designer'] },
  { key: 'video', title: 'Видеография',  head: 'video_director', members: ['videographer', 'video_editor', 'organizer'] },
  { key: 'dev',   title: 'Разработка',   head: 'dev_director',   members: ['pm_dev', 'developer', 'qa'] },
  { key: 'sales', title: 'Продажи',      head: null,             members: ['sales_manager_smm', 'sales_manager_dev'] },
]

const roleOf = (e: any) => e?.user?.role || ''
const posOf = (e: any) => (e?.position || '').trim()
const labelFor = (e: any) => posOf(e) || getRoleLabel(roleOf(e))

/** Тонкая вертикальная линия-связка между уровнями. */
const Connector = () => <div className="w-px h-5 bg-surface-300 dark:bg-surface-600 mx-auto" />

function PersonCard({ emp, onClick, variant = 'default' }: {
  emp: any; onClick: () => void; variant?: 'owner' | 'head' | 'default'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'w-full text-left flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-shadow hover:shadow-md',
        variant === 'owner'
          ? 'border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/20'
          : variant === 'head'
            ? 'border-primary-200 dark:border-primary-800 bg-surface-50 dark:bg-surface-800'
            : 'border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800',
      )}
    >
      <Avatar name={emp.fullName} src={emp.avatar} size={variant === 'default' ? 30 : 36} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate" title={emp.fullName}>{emp.fullName}</p>
        <p className="text-[11px] text-surface-500 dark:text-surface-400 truncate" title={labelFor(emp)}>{labelFor(emp)}</p>
      </div>
    </button>
  )
}

/** Заглушка, когда у отдела нет назначенного руководителя. */
const EmptyHead = () => (
  <div className="w-full rounded-xl border border-dashed border-surface-300 dark:border-surface-600 px-3 py-2.5 text-center">
    <p className="text-xs text-surface-400 dark:text-surface-500">Руководитель не назначен</p>
  </div>
)

export default function OrgChart({ employees }: { employees: any[] }) {
  const navigate = useNavigate()
  const go = (id: string) => navigate(`/employees/${id}`)

  // Раскладываем сотрудников по уровням/отделам, каждый — ровно один раз.
  const assigned = new Set<string>()
  const take = (pred: (e: any) => boolean) => {
    const res = (employees || []).filter(e => !assigned.has(e.id) && pred(e))
    res.forEach(e => assigned.add(e.id))
    return res
  }
  const isRole = (e: any, role: string) => roleOf(e) === role || posOf(e) === getRoleLabel(role)

  const owners = take(e => OWNER_ROLES.includes(roleOf(e)) || ['Основатель', 'Сооснователь'].includes(posOf(e)))
  const admins = take(e => roleOf(e) === 'admin' || posOf(e) === 'Администратор')
  const depts = DEPARTMENTS.map(d => ({
    ...d,
    heads: d.head ? take(e => isRole(e, d.head!)) : [],
    members: take(e => d.members.some(m => isRole(e, m))),
  }))
  const others = (employees || []).filter(e => !assigned.has(e.id))
  const visibleDepts = depts.filter(d => d.heads.length || d.members.length)

  return (
    <div className="card p-6 overflow-x-auto">
      <div className="min-w-[300px]">
        {/* Уровень 1 — владельцы */}
        {owners.length > 0 && (
          <div className="flex flex-wrap justify-center gap-3">
            {owners.map(e => (
              <div key={e.id} className="w-60"><PersonCard emp={e} variant="owner" onClick={() => go(e.id)} /></div>
            ))}
          </div>
        )}

        {/* Уровень 2 — администратор */}
        {admins.length > 0 && (
          <>
            {owners.length > 0 && <Connector />}
            <div className="flex flex-wrap justify-center gap-3">
              {admins.map(e => (
                <div key={e.id} className="w-60"><PersonCard emp={e} variant="head" onClick={() => go(e.id)} /></div>
              ))}
            </div>
          </>
        )}

        {/* Уровень 3 — отделы: руководитель отдельной ячейкой + команда под ним */}
        {visibleDepts.length > 0 && (
          <>
            {(owners.length > 0 || admins.length > 0) && <Connector />}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {visibleDepts.map(d => (
                <div key={d.key} className="rounded-2xl border border-surface-200 dark:border-surface-700 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 text-center mb-2">{d.title}</p>
                  {d.heads.length > 0
                    ? d.heads.map(e => <PersonCard key={e.id} emp={e} variant="head" onClick={() => go(e.id)} />)
                    : d.head && <EmptyHead />}
                  {d.members.length > 0 && (
                    <>
                      <Connector />
                      <div className="space-y-2">
                        {d.members.map(e => <PersonCard key={e.id} emp={e} onClick={() => go(e.id)} />)}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Прочие роли, не попавшие в отделы */}
        {others.length > 0 && (
          <>
            <Connector />
            <div className="rounded-2xl border border-surface-200 dark:border-surface-700 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-400 dark:text-surface-500 text-center mb-2">Другие сотрудники</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {others.map(e => <PersonCard key={e.id} emp={e} onClick={() => go(e.id)} />)}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

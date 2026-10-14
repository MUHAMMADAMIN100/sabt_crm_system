// Блок «Команда» страницы проекта разработки (макет 14.10.2026): кто ведёт
// проект (PM) и разработчики, у каждого — сколько открытых задач на доске.
// Read-only для всех без права редактирования проекта (canEdit приходит
// со страницы). С правом — селект PM (активные pm_dev/dev_director/admin)
// + мультиселект разработчиков (developer/pm_dev) → PATCH {managerId,
// memberIds} → invalidate + тост. Кандидаты — исполнители доски
// (/dev-tracker/assignees): этот список открыт и руководителю разработки,
// а общий список сотрудников — только основателю и админу.

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import { devTrackerApi, projectsApi } from '@/services/api.service'
import { Avatar } from '@/components/ui'
import { devRoleLabel, type DevTeamPerson } from '../devTeam'
import { tasksWord } from '../devProjects'

// PM выбирают из этих ролей, разработчиков — из этих (только активные).
const PM_ROLES = ['pm_dev', 'dev_director', 'admin']
const DEV_ROLES = ['developer', 'pm_dev']

const editBtnCls = 'inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-2.5 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 shrink-0'
const selCls = 'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-400 dark:focus:border-gray-500 max-w-full'

type ApiUser = { id: string; name: string; role?: string; avatar?: string | null; isActive?: boolean }

export function DevTeamBlock({ projectId, manager, members, canEdit, loading, openByUser }: {
  projectId: string
  manager?: DevTeamPerson | null
  members?: DevTeamPerson[] | null
  /** Право редактировать проект (projects.edit) — со страницы. */
  canEdit: boolean
  loading?: boolean
  /** Открытые задачи доски по исполнителю — «5 задач» у разработчика. */
  openByUser?: Map<string, number>
}) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [managerDraft, setManagerDraft] = useState('')
  const [memberDraft, setMemberDraft] = useState<string[]>([])

  const all = useMemo(() => (Array.isArray(members) ? members : []).filter(m => m?.id), [members])
  // Бэк держит менеджера в составе проекта — в списке разработчиков
  // его не дублируем, он уже показан в строке «Ведёт».
  const managerId = manager?.id ?? null
  const devs = useMemo(() => all.filter(m => m.id !== managerId), [all, managerId])
  const empty = !managerId && devs.length === 0

  const startEdit = () => {
    setManagerDraft(managerId ?? '')
    setMemberDraft(devs.map(d => d.id))
    setEditing(true)
  }

  const { data: users, isLoading: usersLoading, isError: usersError } = useQuery<ApiUser[]>({
    queryKey: ['dev-tracker', 'assignees'],
    queryFn: () => devTrackerApi.assignees(),
    enabled: canEdit && editing,
    retry: false,
  })
  const activeUsers = useMemo(() => (users ?? []).filter(u => u.isActive !== false), [users])
  // Текущие PM/участники вне фильтров ролей не должны теряться из формы:
  // подмешиваем их к кандидатам, чтобы селект не сбрасывал значение.
  const pmCandidates = useMemo(() => {
    const base = activeUsers.filter(u => PM_ROLES.includes(u.role ?? ''))
    if (managerId && manager && !base.some(u => u.id === managerId)) {
      base.unshift({ id: managerId, name: manager.name, role: manager.role ?? undefined, avatar: manager.avatar ?? null })
    }
    return base
  }, [activeUsers, managerId, manager])
  const devCandidates = useMemo(() => {
    const base = activeUsers.filter(u => DEV_ROLES.includes(u.role ?? ''))
    for (const d of devs) {
      if (!base.some(u => u.id === d.id)) base.push({ id: d.id, name: d.name, role: d.role ?? undefined, avatar: d.avatar ?? null })
    }
    return base.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'))
  }, [activeUsers, devs])

  const teamMut = useMutation({
    mutationFn: (v: { managerId: string | null; memberIds: string[] }) => projectsApi.update(projectId, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dev-project', projectId] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      setEditing(false)
      toast.success('Состав обновлён')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось сохранить состав'),
  })
  const save = () => {
    teamMut.mutate({
      managerId: managerDraft || null,
      // Менеджера бэк сам держит в составе — дубль в memberIds не шлём.
      memberIds: memberDraft.filter(mid => mid !== (managerDraft || '')),
    })
  }
  const toggleMember = (uid: string) => {
    setMemberDraft(cur => (cur.includes(uid) ? cur.filter(x => x !== uid) : [...cur, uid]))
  }

  return (
    <section className="card min-w-0">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h2 className="text-[15px] font-semibold text-surface-900 dark:text-surface-50">Команда</h2>
        {canEdit && !editing && (
          <button onClick={startEdit} className={editBtnCls}><Pencil size={13} /> Изменить</button>
        )}
        {canEdit && editing && (
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">Отмена</button>
            <button onClick={save} disabled={teamMut.isPending} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[#2D5DA8] text-white hover:bg-[#244C8C] disabled:opacity-60">
              {teamMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Сохранить
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Загрузка команды…</p>
      ) : editing ? (
        usersError ? (
          <p className="text-sm text-gray-400">Нет доступа к списку сотрудников — состав доступен только для чтения.</p>
        ) : (
          <div className="space-y-3 min-w-0">
            <label className="block min-w-0">
              <span className="block text-sm text-gray-500 mb-1">Ведёт проект (PM)</span>
              <select value={managerDraft} onChange={e => setManagerDraft(e.target.value)} disabled={usersLoading} className={selCls + ' w-full'}>
                <option value="">Не назначен</option>
                {pmCandidates.map(u => (
                  <option key={u.id} value={u.id}>{u.name}{u.role ? ` · ${devRoleLabel(u.role)}` : ''}</option>
                ))}
              </select>
            </label>
            <div className="min-w-0">
              <span className="block text-sm text-gray-500 mb-1">Разработчики</span>
              {usersLoading ? (
                <p className="text-sm text-gray-400">Загрузка сотрудников…</p>
              ) : devCandidates.length === 0 ? (
                <p className="text-sm text-gray-400">Нет разработчиков</p>
              ) : (
                <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                  {devCandidates.map(u => {
                    const on = memberDraft.includes(u.id)
                    return (
                      <button key={u.id} type="button" onClick={() => toggleMember(u.id)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 min-w-0">
                        <Avatar name={u.name} src={u.avatar || undefined} size={26} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{u.name}</span>
                          {u.role && <span className="block text-[11.5px] text-gray-400 truncate">{devRoleLabel(u.role)}</span>}
                        </span>
                        <span className={'w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ' + (on ? 'bg-[#2D5DA8] border-[#2D5DA8]' : 'border-gray-300 dark:border-gray-600')}>
                          {on && <Check size={13} className="text-white" />}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )
      ) : empty ? (
        <p className="text-sm text-surface-500">Команда не набрана</p>
      ) : (
        <ul className="space-y-2.5 min-w-0">
          <li className="flex items-center gap-2.5 min-w-0">
            {managerId && manager ? (
              <>
                <Avatar name={manager.name} src={manager.avatar || undefined} size={30} />
                <span className="flex-1 min-w-0 text-sm text-surface-900 dark:text-surface-100 truncate">{manager.name}</span>
                <span className="text-[12.5px] text-surface-500 shrink-0">ведёт проект</span>
              </>
            ) : (
              <span className="text-sm text-surface-500">Проект-менеджер не назначен</span>
            )}
          </li>
          {devs.map(d => {
            const open = openByUser?.get(d.id) ?? 0
            return (
              <li key={d.id} className="flex items-center gap-2.5 min-w-0">
                <Avatar name={d.name} src={d.avatar || undefined} size={30} />
                <span className="flex-1 min-w-0 text-sm text-surface-900 dark:text-surface-100 truncate">{d.name}</span>
                <span className="text-[12.5px] text-surface-500 shrink-0">
                  {openByUser ? tasksWord(open) : devRoleLabel(d.role)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

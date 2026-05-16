import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { Plus, Edit, Trash2, Users, UserCog, Search, X, Check, Crown, Network } from 'lucide-react'
import { teamsApi, employeesApi } from '@/services/api.service'
import { Modal, FormField, ConfirmDialog, EmptyState, PageLoader, Avatar } from '@/components/ui'

interface Team {
  id: string
  name: string
  description: string | null
  color: string | null
  leadId: string | null
  lead?: { id: string; name: string } | null
  isActive: boolean
  memberCount?: number
}

const COLORS = ['#6B4FCF', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#14b8a6']

export default function TeamsPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [editTeam, setEditTeam] = useState<Team | null>(null)
  const [deleteTeam, setDeleteTeam] = useState<Team | null>(null)
  const [membersTeam, setMembersTeam] = useState<Team | null>(null)
  const [detailTeam, setDetailTeam] = useState<Team | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const { data: teams, isLoading } = useQuery<Team[]>({
    queryKey: ['teams', { includeInactive: showInactive }],
    queryFn: () => teamsApi.list(showInactive),
  })

  const { data: employees } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeesApi.list(),
  })

  const createMut = useMutation({
    mutationFn: teamsApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teams'] }); setShowCreate(false); toast.success('Команда создана') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => teamsApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teams'] }); setEditTeam(null); toast.success('Сохранено') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })
  const deleteMut = useMutation({
    mutationFn: teamsApi.remove,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teams'] }); qc.invalidateQueries({ queryKey: ['employees'] }); setDeleteTeam(null); toast.success('Удалено') },
    onError: () => toast.error('Ошибка'),
  })

  if (isLoading) return <PageLoader />

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UserCog size={22} className="text-purple-500" /> Команды
          </h1>
          <p className="text-sm text-gray-500">Рабочие группы сотрудников. Используются при выборе участников проекта.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Показать выключенные
          </label>
          <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm">
            <Plus size={14} /> Новая команда
          </button>
        </div>
      </header>

      {(teams ?? []).length === 0 ? (
        <EmptyState title="Команд пока нет" description="Создайте первую команду — она появится в списке выбора при создании проектов." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(teams ?? []).map(t => (
            <div
              key={t.id}
              onClick={() => setDetailTeam(t)}
              className={clsx(
                'rounded-xl border p-4 bg-white dark:bg-gray-900 shadow-sm cursor-pointer transition-all',
                'hover:shadow-md hover:border-purple-300 dark:hover:border-purple-700',
                t.isActive ? 'border-gray-200 dark:border-gray-700' : 'border-gray-200 dark:border-gray-800 opacity-60',
              )}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.color || '#6B4FCF' }} />
                  <h3 className="font-semibold text-base truncate">{t.name}</h3>
                </div>
                {!t.isActive && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800">выкл</span>
                )}
              </div>

              {t.description && (
                <p className="text-xs text-gray-500 mb-3 line-clamp-2">{t.description}</p>
              )}

              <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
                <span className="inline-flex items-center gap-1">
                  <Users size={12} /> {t.memberCount ?? 0} {membersWord(t.memberCount ?? 0)}
                </span>
                {t.lead && (
                  <span className="inline-flex items-center gap-1"><Crown size={11} className="text-amber-500" /> {t.lead.name}</span>
                )}
              </div>

              <div className="flex items-center gap-1 pt-3 border-t border-gray-100 dark:border-gray-800" onClick={e => e.stopPropagation()}>
                <button onClick={() => setMembersTeam(t)} className="px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-xs flex-1 text-left">
                  👥 Состав
                </button>
                <button onClick={() => setEditTeam(t)} className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800" title="Редактировать">
                  <Edit size={14} />
                </button>
                <button onClick={() => setDeleteTeam(t)} className="p-2 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500" title="Удалить">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Org-схема: пирамида структуры команд ───────────────────── */}
      {(teams ?? []).length > 0 && (
        <OrgChart teams={teams ?? []} employees={employees ?? []} />
      )}

      {showCreate && (
        <Modal open onClose={() => setShowCreate(false)} title="Новая команда" size="md">
          <TeamForm
            employees={employees ?? []}
            loading={createMut.isPending}
            onCancel={() => setShowCreate(false)}
            onSubmit={data => createMut.mutate(data)}
          />
        </Modal>
      )}

      {editTeam && (
        <Modal open onClose={() => setEditTeam(null)} title={`Редактировать: ${editTeam.name}`} size="md">
          <TeamForm
            initial={editTeam}
            employees={employees ?? []}
            loading={updateMut.isPending}
            onCancel={() => setEditTeam(null)}
            onSubmit={data => updateMut.mutate({ id: editTeam.id, data })}
          />
        </Modal>
      )}

      {membersTeam && (
        <Modal open onClose={() => setMembersTeam(null)} title={`Состав: ${membersTeam.name}`} size="lg">
          <MembersManager
            team={membersTeam}
            allEmployees={employees ?? []}
            onClose={() => setMembersTeam(null)}
          />
        </Modal>
      )}

      {detailTeam && (
        <Modal open onClose={() => setDetailTeam(null)} title={detailTeam.name} size="lg">
          <TeamDetail
            team={detailTeam}
            allEmployees={employees ?? []}
            onEdit={() => { setEditTeam(detailTeam); setDetailTeam(null) }}
            onMembers={() => { setMembersTeam(detailTeam); setDetailTeam(null) }}
            onDelete={() => { setDeleteTeam(detailTeam); setDetailTeam(null) }}
          />
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleteTeam}
        onClose={() => setDeleteTeam(null)}
        onConfirm={() => deleteTeam && deleteMut.mutate(deleteTeam.id)}
        title="Удалить команду?"
        message={deleteTeam ? `Команда "${deleteTeam.name}" будет удалена. Сотрудники останутся в системе, но без команды.` : ''}
        danger
      />
    </div>
  )
}

function membersWord(n: number) {
  const last = n % 10
  if (n >= 5 && n <= 20) return 'участников'
  if (last === 1) return 'участник'
  if (last >= 2 && last <= 4) return 'участника'
  return 'участников'
}

// ─── Team form ────────────────────────────────────────────────────────
function TeamForm({ initial, employees, onSubmit, onCancel, loading }: {
  initial?: Team
  employees: any[]
  onSubmit: (data: any) => void
  onCancel: () => void
  loading: boolean
}) {
  const [color, setColor] = useState(initial?.color || COLORS[0])
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      name: initial?.name ?? '',
      description: initial?.description ?? '',
      leadId: initial?.leadId ?? '',
      isActive: initial?.isActive ?? true,
    },
  })

  return (
    <form
      onSubmit={handleSubmit(data => onSubmit({
        ...data,
        leadId: data.leadId || null,
        color,
      }))}
      className="space-y-4"
    >
      <FormField label="Название" required error={errors.name?.message as string}>
        <input {...register('name', { required: 'Введите название' })} className="input" />
      </FormField>

      <FormField label="Описание">
        <textarea {...register('description')} rows={2} className="input resize-none" />
      </FormField>

      <FormField label="Лидер команды (опционально)">
        <select {...register('leadId')} className="input">
          <option value="">— Не назначен —</option>
          {employees.map((e: any) => (
            <option key={e.userId || e.id} value={e.userId || e.id}>{e.fullName || e.name}</option>
          ))}
        </select>
      </FormField>

      <div>
        <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-2">Цвет</label>
        <div className="flex flex-wrap gap-2">
          {COLORS.map(c => (
            <button
              key={c} type="button" onClick={() => setColor(c)}
              className={clsx(
                'w-7 h-7 rounded-full border-2 transition-all',
                color === c ? 'border-gray-700 dark:border-white scale-110' : 'border-transparent',
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" {...register('isActive')} /> Активная
      </label>

      <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm border border-gray-200 dark:border-gray-700">Отмена</button>
        <button type="submit" disabled={loading} className="px-4 py-2 rounded-lg text-sm bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50">
          {loading ? 'Сохранение...' : 'Сохранить'}
        </button>
      </div>
    </form>
  )
}

// ─── Members manager ──────────────────────────────────────────────────
function MembersManager({ team, allEmployees, onClose }: {
  team: Team
  allEmployees: any[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')

  const { data: members, isLoading } = useQuery({
    queryKey: ['team-members', team.id],
    queryFn: () => teamsApi.members(team.id),
  })

  const memberIds = useMemo(
    () => new Set<string>((members ?? []).map((m: any) => m.id as string)),
    [members],
  )

  const [selected, setSelected] = useState<Set<string>>(new Set<string>())
  // Инициализируем выбранных текущим составом — один раз при загрузке.
  useEffect(() => {
    if (members) setSelected(new Set<string>(memberIds))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members])

  const filteredEmployees = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return allEmployees
    return allEmployees.filter((e: any) =>
      (e.fullName || e.name || '').toLowerCase().includes(q),
    )
  }, [allEmployees, search])

  const saveMut = useMutation({
    mutationFn: () => teamsApi.setMembers(team.id, Array.from(selected)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] })
      qc.invalidateQueries({ queryKey: ['team-members', team.id] })
      qc.invalidateQueries({ queryKey: ['employees'] })
      toast.success('Состав обновлён')
      onClose()
    },
    onError: () => toast.error('Не удалось сохранить'),
  })

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-gray-500">
      Отметь сотрудников для команды. Если сотрудник был в другой команде — он автоматически перейдёт сюда.
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по имени..." className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
      </div>

      <div className="text-xs text-gray-500 flex items-center justify-between">
        <span>Выбрано: <b>{selected.size}</b> из {allEmployees.length}</span>
        <button onClick={() => setSelected(new Set())} className="text-purple-600 hover:underline" type="button">
          Очистить
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-sm text-gray-500">Загрузка...</div>
      ) : (
        <ul className="max-h-[50vh] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
          {filteredEmployees.map((e: any) => {
            const eid = e.userId || e.id
            const isSelected = selected.has(eid)
            const inOtherTeam = e.teamId && e.teamId !== team.id
            return (
              <li
                key={eid}
                onClick={() => toggle(eid)}
                className={clsx(
                  'flex items-center justify-between gap-2 px-3 py-2 cursor-pointer transition-colors',
                  isSelected ? 'bg-purple-50 dark:bg-purple-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50',
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={clsx(
                    'w-5 h-5 rounded flex items-center justify-center shrink-0',
                    isSelected ? 'bg-purple-600 text-white' : 'border border-gray-300 dark:border-gray-600',
                  )}>
                    {isSelected && <Check size={12} />}
                  </span>
                  <span className="text-sm truncate">{e.fullName || e.name}</span>
                  {e.position && <span className="text-xs text-gray-400 truncate">— {e.position}</span>}
                </div>
                {inOtherTeam && (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">в другой команде</span>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border border-gray-200 dark:border-gray-700">
          <X size={14} className="inline mr-1" /> Отмена
        </button>
        <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
          className="px-4 py-2 rounded-lg text-sm bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50">
          {saveMut.isPending ? 'Сохранение...' : 'Сохранить состав'}
        </button>
      </div>
    </div>
  )
}

// ─── Детальная карточка команды ───────────────────────────────────────
function TeamDetail({ team, allEmployees, onEdit, onMembers, onDelete }: {
  team: Team
  allEmployees: any[]
  onEdit: () => void
  onMembers: () => void
  onDelete: () => void
}) {
  // Состав берём из сотрудников у которых teamId === team.id (так не
  // нужен отдельный запрос — данные уже загружены на странице).
  const members = useMemo(
    () => allEmployees.filter((e: any) => e.teamId === team.id),
    [allEmployees, team.id],
  )
  const leadId = team.leadId
  const lead = members.find((e: any) => (e.userId || e.id) === leadId)
    || allEmployees.find((e: any) => (e.userId || e.id) === leadId)

  return (
    <div className="space-y-5">
      {/* Шапка с цветом и описанием */}
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center" style={{ backgroundColor: team.color || '#6B4FCF' }}>
          <Users size={20} className="text-white" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-lg">{team.name}</h3>
          {team.description
            ? <p className="text-sm text-gray-500 mt-0.5">{team.description}</p>
            : <p className="text-sm text-gray-400 italic mt-0.5">Описание не задано</p>}
        </div>
        <span className={clsx(
          'text-xs px-2 py-1 rounded-full shrink-0',
          team.isActive
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : 'bg-gray-100 text-gray-500 dark:bg-gray-800',
        )}>
          {team.isActive ? 'Активна' : 'Выключена'}
        </span>
      </div>

      {/* Метрики */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
          <p className="text-xs text-gray-500">Участников</p>
          <p className="text-xl font-bold text-purple-600">{members.length}</p>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
          <p className="text-xs text-gray-500">Лидер</p>
          <p className="text-sm font-semibold mt-1 flex items-center gap-1">
            {lead
              ? <><Crown size={13} className="text-amber-500" /> {lead.fullName || lead.name}</>
              : <span className="text-gray-400">не назначен</span>}
          </p>
        </div>
      </div>

      {/* Лидер + состав */}
      <div>
        <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <Users size={14} /> Состав команды
        </h4>
        {members.length === 0 ? (
          <p className="text-sm text-gray-400 italic">В команде пока нет участников</p>
        ) : (
          <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
            {/* Сначала лидер, затем остальные */}
            {[...members].sort((a: any, b: any) => {
              const aLead = (a.userId || a.id) === leadId ? -1 : 0
              const bLead = (b.userId || b.id) === leadId ? -1 : 0
              return aLead - bLead
            }).map((e: any) => {
              const isLead = (e.userId || e.id) === leadId
              return (
                <div key={e.userId || e.id} className="flex items-center gap-2.5 p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                  <Avatar name={e.fullName || e.name} src={e.avatar} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate flex items-center gap-1">
                      {e.fullName || e.name}
                      {isLead && <Crown size={12} className="text-amber-500 shrink-0" />}
                    </p>
                    {e.position && <p className="text-xs text-gray-400 truncate">{e.position}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Действия — полное управление */}
      <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
        <button onClick={onDelete} className="px-3 py-2 rounded-lg text-sm border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20">
          <Trash2 size={14} className="inline mr-1" /> Удалить
        </button>
        <button onClick={onMembers} className="px-3 py-2 rounded-lg text-sm border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
          👥 Изменить состав
        </button>
        <button onClick={onEdit} className="px-3 py-2 rounded-lg text-sm bg-purple-600 hover:bg-purple-700 text-white">
          <Edit size={14} className="inline mr-1" /> Редактировать
        </button>
      </div>
    </div>
  )
}

// ─── Org-схема: пирамида структуры компании ───────────────────────────
function OrgChart({ teams, employees }: { teams: Team[]; employees: any[] }) {
  // Верхушка пирамиды — руководство (founder / co_founder).
  const leadership = useMemo(
    () => employees.filter((e: any) =>
      ['founder', 'co_founder'].includes(e.user?.role || e.role || ''),
    ),
    [employees],
  )
  // Активные команды с участниками.
  const activeTeams = teams.filter(t => t.isActive)

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
      <h2 className="text-base font-semibold flex items-center gap-2 mb-5">
        <Network size={18} className="text-purple-500" /> Структура компании
      </h2>

      {/* Уровень 1 — руководство */}
      {leadership.length > 0 && (
        <div className="flex flex-col items-center">
          <div className="flex flex-wrap justify-center gap-3">
            {leadership.map((e: any) => (
              <div key={e.userId || e.id} className="flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl bg-gradient-to-b from-amber-100 to-amber-50 dark:from-amber-900/30 dark:to-amber-900/10 border border-amber-200 dark:border-amber-800">
                <Crown size={16} className="text-amber-500" />
                <p className="text-sm font-semibold">{e.fullName || e.name}</p>
                <p className="text-[11px] text-gray-500">{e.position || 'Руководство'}</p>
              </div>
            ))}
          </div>
          {/* Соединительная линия вниз */}
          <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />
        </div>
      )}

      {/* Уровень 2+3 — команды (лидер → участники) */}
      {activeTeams.length === 0 ? (
        <p className="text-sm text-gray-400 text-center italic">Нет активных команд</p>
      ) : (
        <div className="flex flex-wrap justify-center gap-6">
          {activeTeams.map(team => {
            const members = employees.filter((e: any) => e.teamId === team.id)
            const lead = members.find((e: any) => (e.userId || e.id) === team.leadId)
            const rest = members.filter((e: any) => (e.userId || e.id) !== team.leadId)
            return (
              <div key={team.id} className="flex flex-col items-center min-w-[160px]">
                {/* Лидер команды */}
                <div
                  className="flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl border-2 text-center"
                  style={{ borderColor: team.color || '#6B4FCF' }}
                >
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: team.color || '#6B4FCF' }} />
                  <p className="text-sm font-bold">{team.name}</p>
                  {lead
                    ? <p className="text-[11px] text-gray-500 flex items-center gap-1"><Crown size={10} className="text-amber-500" /> {lead.fullName || lead.name}</p>
                    : <p className="text-[11px] text-gray-400 italic">без лидера</p>}
                </div>
                {/* Линия к участникам */}
                {rest.length > 0 && <div className="w-px h-5 bg-gray-300 dark:bg-gray-600" />}
                {/* Участники */}
                {rest.length > 0 && (
                  <div className="flex flex-col gap-1.5 items-stretch">
                    {rest.map((e: any) => (
                      <div key={e.userId || e.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700">
                        <Avatar name={e.fullName || e.name} src={e.avatar} size={22} />
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{e.fullName || e.name}</p>
                          {e.position && <p className="text-[10px] text-gray-400 truncate">{e.position}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Страница проекта разработки (макет 14.10.2026). Раньше проект разработки
// открывался страницей SMM-проекта: «Выполнение плана: Рилсы, Посты, Сторис»
// и анкета SMM-клиента. Теперь — этап, сроки, команда, задачи доски и
// контакты клиента; рилсов, циклов и контент-плана у разработки нет.
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Check, ChevronLeft, ChevronRight, Loader2, MoreVertical, Pencil, X } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { devTrackerApi, projectsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { userCan } from '@/lib/permissions'
import { isDevProjectType } from '@/lib/projectType'
import { DEV_STAGES } from '@/lib/devStages'
import { Avatar, Modal } from '@/components/ui'
import { DatePicker } from '@/components/ui/DatePicker'
import { isDevTaskOverdue, type DevTask, type DevTaskStatus } from '@/pages/dev-board/devBoardTypes'
import { DevTasksTab } from './components/DevTasksTab'
import { DevTeamBlock } from './components/DevTeamBlock'
import { DevTypeChip } from './components/DevTypeChip'
import { boardUrl, taskUrl } from './devLinks'
import {
  deadlineInfo, longDay, nearestDeadlines, openByAssignee, plural, shortDay, stageOf, taskStats,
  timeProgress, todayIso,
} from './devProjects'

/** Этап двигают руководство и проект-менеджер — как сервер (dev-stage). */
const STAGE_ROLES = ['admin', 'founder', 'dev_director', 'pm_dev']

/** Плитки «Задачи на доске»: колонки доски, короткие подписи. */
const STATUS_TILES: { key: DevTaskStatus; label: string; cls: string }[] = [
  { key: 'backlog', label: 'Бэклог', cls: 'bg-surface-100 text-surface-700 dark:bg-surface-700/50 dark:text-surface-300' },
  { key: 'todo', label: 'К работе', cls: 'bg-[#EEF1F7] text-[#3D4A66] dark:bg-[#5B6B8C]/20 dark:text-[#B8C2D9]' },
  { key: 'in_progress', label: 'В работе', cls: 'bg-[#E7EEF9] text-[#244C8C] dark:bg-[#2D5DA8]/25 dark:text-[#A9C1EA]' },
  { key: 'testing', label: 'Тест', cls: 'bg-[#FDF3E1] text-[#7A4700] dark:bg-amber-500/15 dark:text-amber-300' },
  { key: 'done', label: 'Готово', cls: 'bg-[#E5F3EB] text-[#1C5E3E] dark:bg-emerald-500/15 dark:text-emerald-300' },
]
const STATUS_PILL: Record<DevTaskStatus, { label: string; cls: string }> = {
  backlog: { label: 'Бэклог', cls: 'bg-surface-100 text-surface-600 dark:bg-surface-700 dark:text-surface-300' },
  todo: { label: 'К работе', cls: 'bg-[#EEF1F7] text-[#3D4A66] dark:bg-[#5B6B8C]/20 dark:text-[#B8C2D9]' },
  in_progress: { label: 'В работе', cls: 'bg-[#E7EEF9] text-[#244C8C] dark:bg-[#2D5DA8]/25 dark:text-[#A9C1EA]' },
  testing: { label: 'Тест', cls: 'bg-[#FDF3E1] text-[#7A4700] dark:bg-amber-500/15 dark:text-amber-300' },
  done: { label: 'Готово', cls: 'bg-[#E5F3EB] text-[#1C5E3E] dark:bg-emerald-500/15 dark:text-emerald-300' },
}
const LATE_PILL = 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300'

/** Контакты клиента (clientInfo) — те же поля, что в общей карточке проекта. */
const CLIENT_FIELDS: { key: string; label: string; placeholder: string; type?: string }[] = [
  { key: 'companyName', label: 'Компания', placeholder: 'Название компании' },
  { key: 'contactPerson', label: 'Контактное лицо', placeholder: 'Имя' },
  { key: 'phone', label: 'Телефон', placeholder: '+992', type: 'tel' },
  { key: 'whatsapp', label: 'WhatsApp', placeholder: '+992', type: 'tel' },
  { key: 'email', label: 'E-mail', placeholder: 'name@company.tj', type: 'email' },
]

const titleCls = 'text-[15px] font-semibold text-surface-900 dark:text-surface-50'
const editBtnCls = 'inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-2.5 py-1.5 rounded-lg border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 shrink-0'
const blueBtnCls = 'inline-flex items-center justify-center gap-1.5 min-h-[34px] px-3.5 rounded-[10px] text-[13.5px] font-semibold text-white bg-[#2D5DA8] hover:bg-[#244C8C] disabled:opacity-60'

type Tab = 'overview' | 'tasks' | 'client'

export default function DevProjectPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canEdit = userCan(user, 'projects.edit')
  const canArchive = userCan(user, 'projects.archive')
  const seesBoard = userCan(user, 'dev-tracker.view')
  const canStage = [user?.role, user?.secondaryRole].some(r => !!r && STAGE_ROLES.includes(r))
  const [tab, setTab] = useState<Tab>('overview')

  const { data: project, isLoading, isError } = useQuery<any>({
    queryKey: ['dev-project', id],
    queryFn: () => projectsApi.get(id!),
    enabled: !!id,
    retry: false,
  })
  // Тот же запрос, что у вкладки «Задачи», — один на страницу.
  const { data: tasksRaw } = useQuery<DevTask[]>({
    queryKey: ['dev-tracker', 'list', 'project', id],
    queryFn: () => devTrackerApi.list(id!),
    enabled: !!id && seesBoard,
    retry: false,
  })
  const tasks = useMemo(() => (Array.isArray(tasksRaw) ? tasksRaw : []), [tasksRaw])
  const stats = useMemo(() => taskStats(tasks), [tasks])
  const near = useMemo(() => nearestDeadlines(tasks), [tasks])
  const openBy = useMemo(() => openByAssignee(tasks), [tasks])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['dev-project', id] })
    qc.invalidateQueries({ queryKey: ['projects'] })
  }
  const updMut = useMutation({
    mutationFn: (patch: Record<string, any>) => projectsApi.update(id!, patch),
    onSuccess: () => { refresh(); toast.success('Сохранено') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось сохранить'),
  })
  const stageMut = useMutation({
    mutationFn: (n: number) => projectsApi.setDevStage(id!, n),
    onSuccess: (_r, n) => {
      qc.setQueryData(['dev-project', id], (old: any) => (old ? { ...old, devStage: n } : old))
      refresh()
      const s = stageOf(n)
      toast.success(s ? `Этап ${s.num} · ${s.label}` : 'Этап сохранён')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось сменить этап'),
  })
  const archiveMut = useMutation({
    mutationFn: () => projectsApi.archive(id!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); toast.success('Проект в архиве'); navigate('/dev/projects') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось перенести в архив'),
  })

  // ── имя ──
  const [nameEditing, setNameEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const saveName = () => {
    const v = nameDraft.trim()
    if (!v) { toast.error('Название не может быть пустым'); return }
    if (v !== project?.name) updMut.mutate({ name: v })
    setNameEditing(false)
  }
  // ── сроки ──
  const [datesEditing, setDatesEditing] = useState(false)
  const [startDraft, setStartDraft] = useState('')
  const [endDraft, setEndDraft] = useState('')
  const startDates = () => {
    setStartDraft(String(project?.startDate ?? '').slice(0, 10))
    setEndDraft(String(project?.endDate ?? '').slice(0, 10))
    setDatesEditing(true)
  }
  const saveDates = () => {
    updMut.mutate({ startDate: startDraft || null, endDate: endDraft || null })
    setDatesEditing(false)
  }
  // ── клиент ──
  const info: Record<string, any> = project?.clientInfo && typeof project.clientInfo === 'object' ? project.clientInfo : {}
  const [clientEditing, setClientEditing] = useState(false)
  const [clientDraft, setClientDraft] = useState<Record<string, string>>({})
  const startClient = () => {
    const d: Record<string, string> = {}
    for (const f of CLIENT_FIELDS) d[f.key] = String(info[f.key] ?? '')
    d.notes = String(info.notes ?? '')
    setClientDraft(d)
    setClientEditing(true)
  }
  const saveClient = () => {
    // Остальные поля clientInfo (например, Instagram из общей карточки) не трогаем.
    const next: Record<string, any> = { ...info }
    for (const [k, v] of Object.entries(clientDraft)) next[k] = v.trim()
    updMut.mutate({ clientInfo: next })
    setClientEditing(false)
  }
  // ── меню и архив ──
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  useEffect(() => { setTab('overview') }, [id])

  if (isLoading) return <div className="flex justify-center py-24"><Loader2 className="animate-spin text-surface-400" /></div>
  if (isError || !project || !isDevProjectType(project.projectType)) {
    return (
      <div className="space-y-3">
        <Link to="/dev/projects" className="inline-flex items-center gap-1 text-sm text-[#2D5DA8] dark:text-[#8FB0E6]"><ChevronLeft size={16} /> Проекты</Link>
        <p className="text-surface-500">{project && !isError ? 'Это не проект разработки.' : 'Проект не найден или нет доступа.'}</p>
      </div>
    )
  }

  const stage = stageOf(project.devStage)
  const nextStage = stage ? DEV_STAGES.find(s => s.num === stage.num + 1) ?? null : DEV_STAGES[0]
  const dl = deadlineInfo(project.endDate)
  const time = timeProgress(project.startDate, project.endDate)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1.5">
        <Link to="/dev/projects" className="self-start inline-flex items-center gap-1 text-[13.5px] text-[#2D5DA8] hover:text-[#1E4785] dark:text-[#8FB0E6]">
          <ChevronLeft size={15} /> Проекты
        </Link>
        <div className="flex items-center gap-3 flex-wrap">
          {nameEditing ? (
            <div className="flex items-center gap-2">
              <input autoFocus value={nameDraft} onChange={e => setNameDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setNameEditing(false) }}
                aria-label="Название проекта"
                className="page-title min-w-[220px] bg-transparent border-b-2 border-surface-300 dark:border-surface-600 focus:border-[#2D5DA8] outline-none px-0.5" />
              <button type="button" onClick={saveName} title="Сохранить" className="p-1.5 rounded-lg bg-[#2D5DA8] text-white hover:bg-[#244C8C]"><Check size={16} /></button>
              <button type="button" onClick={() => setNameEditing(false)} title="Отмена" className="p-1.5 rounded-lg text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700"><X size={16} /></button>
            </div>
          ) : (
            <>
              <h1 className="page-title">{project.name}</h1>
              {canEdit && (
                <button type="button" onClick={() => { setNameDraft(project.name); setNameEditing(true) }} title="Переименовать проект"
                  className="p-1.5 rounded-lg text-surface-400 hover:text-surface-700 hover:bg-surface-100 dark:hover:text-surface-200 dark:hover:bg-surface-700"><Pencil size={15} /></button>
              )}
            </>
          )}
          <DevTypeChip type={project.projectType} />
          <div className="ml-auto flex items-center gap-2">
            {seesBoard && (
              <Link to={boardUrl(id)} className="inline-flex items-center gap-1.5 min-h-[36px] px-3.5 rounded-[10px] border border-surface-300 bg-surface-50 text-sm font-semibold text-[#2D5DA8] hover:bg-surface-100 dark:border-surface-600 dark:bg-surface-800 dark:text-[#8FB0E6] dark:hover:bg-surface-700">
                Открыть доску <ChevronRight size={15} />
              </Link>
            )}
            {canArchive && (
              <div className="relative">
                <button type="button" onClick={() => setMenuOpen(o => !o)} aria-label="Ещё" aria-expanded={menuOpen}
                  className="grid h-9 w-9 place-items-center rounded-[10px] border border-surface-300 text-surface-500 hover:bg-surface-100 dark:border-surface-600 dark:hover:bg-surface-700">
                  <MoreVertical size={17} />
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 z-50 mt-1 w-60 rounded-xl border border-surface-200 bg-surface-50 py-1 shadow-xl dark:border-surface-700 dark:bg-surface-800">
                      <button type="button" onClick={() => { setMenuOpen(false); setConfirmArchive(true) }}
                        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10">
                        <Archive size={15} /> Завершить проект
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <nav aria-label="Вкладки проекта" className="flex gap-1 overflow-x-auto border-b border-surface-200 dark:border-surface-700 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {([['overview', 'Обзор'], ['tasks', 'Задачи'], ['client', 'Клиент']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}
              className={clsx('-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors',
                tab === k
                  ? 'border-[#2D5DA8] text-surface-900 dark:border-[#8FB0E6] dark:text-surface-50'
                  : 'border-transparent text-surface-500 hover:text-surface-800 dark:hover:text-surface-200')}>
              {label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          {/* Этап проекта */}
          <section className="card space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className={titleCls}>Этап проекта</h2>
              <span className="text-[13.5px] text-surface-500">{stage ? `${stage.num} из ${DEV_STAGES.length} · ${stage.pct} %` : 'не задан'}</span>
              {canStage && nextStage && (
                <button type="button" disabled={stageMut.isPending} onClick={() => stageMut.mutate(nextStage.num)} className={clsx(blueBtnCls, 'ml-auto')}>
                  {stageMut.isPending && <Loader2 size={14} className="animate-spin" />}
                  {stage ? 'Следующий этап' : `Начать: этап ${nextStage.num}`}
                </button>
              )}
            </div>
            <ol className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-2 gap-y-3">
              {DEV_STAGES.map(s => {
                const state = !stage || s.num > stage.num ? 'todo' : s.num < stage.num ? 'done' : 'current'
                const body = (
                  <>
                    <span className={clsx('relative block h-1.5 overflow-hidden rounded-full',
                      state === 'done' ? 'bg-[#2D5DA8] dark:bg-[#6F95D6]'
                        : state === 'current' ? 'bg-[#C9D6EC] dark:bg-[#2D5DA8]/35' : 'bg-surface-200 dark:bg-surface-700')}>
                      {state === 'current' && <span className="absolute inset-y-0 left-0 w-[55%] rounded-full bg-[#2D5DA8] dark:bg-[#6F95D6]" />}
                    </span>
                    <span className={clsx('text-[12.5px] leading-snug',
                      state === 'current' ? 'font-semibold text-[#244C8C] dark:text-[#A9C1EA]'
                        : state === 'done' ? 'text-surface-800 dark:text-surface-200' : 'text-surface-500')}>
                      {s.num} · {s.label}
                    </span>
                    <span className={clsx('text-[12px]', state === 'current' ? 'font-semibold text-[#244C8C] dark:text-[#A9C1EA]' : 'text-surface-500')}>
                      {s.pct} %{state === 'current' ? ' · сейчас' : ''}
                    </span>
                  </>
                )
                return (
                  <li key={s.num}>
                    {canStage ? (
                      <button type="button" title={`Поставить этап ${s.num}: ${s.label}`} disabled={stageMut.isPending || s.num === stage?.num}
                        onClick={() => stageMut.mutate(s.num)}
                        className="flex w-full flex-col gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D5DA8]/40 disabled:cursor-default">
                        {body}
                      </button>
                    ) : (
                      <div className="flex flex-col gap-1.5">{body}</div>
                    )}
                  </li>
                )
              })}
            </ol>
            {stage && <p className="text-[13.5px] leading-relaxed text-surface-600 dark:text-surface-300">Сейчас: {stage.hint}</p>}
          </section>

          <div className="grid gap-4 lg:grid-cols-2 items-start">
            {/* Сроки */}
            <section className="card space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className={titleCls}>Сроки</h2>
                {canEdit && !datesEditing && <button type="button" onClick={startDates} className={editBtnCls}><Pencil size={13} /> Изменить</button>}
                {datesEditing && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setDatesEditing(false)} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700">Отмена</button>
                    <button type="button" onClick={saveDates} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg text-white bg-[#2D5DA8] hover:bg-[#244C8C]"><Check size={14} /> Сохранить</button>
                  </div>
                )}
              </div>
              {datesEditing ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5 text-[12.5px] text-surface-500">Старт<DatePicker value={startDraft} onChange={setStartDraft} placeholder="Дата старта" /></div>
                  <div className="flex flex-col gap-1.5 text-[12.5px] text-surface-500">Сдача<DatePicker value={endDraft} onChange={setEndDraft} placeholder="Срок сдачи" /></div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="flex flex-col gap-0.5"><span className="text-[12.5px] text-surface-500">Старт</span><span className="text-[15px] font-semibold">{longDay(project.startDate)}</span></div>
                    <div className="flex flex-col gap-0.5"><span className="text-[12.5px] text-surface-500">Сдача</span><span className="text-[15px] font-semibold">{longDay(project.endDate)}</span></div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[12.5px] text-surface-500">{dl?.overdue ? 'Просрочено' : dl?.days === 0 ? 'Срок' : 'Осталось'}</span>
                      <span className={clsx('text-[15px] font-semibold', dl?.overdue ? 'text-red-600 dark:text-red-400' : 'text-[#244C8C] dark:text-[#A9C1EA]')}>
                        {!dl ? '—' : dl.days === 0 ? 'сегодня' : `${Math.abs(dl.days)} ${plural(Math.abs(dl.days), 'день', 'дня', 'дней')}`}
                      </span>
                    </div>
                  </div>
                  {time && (
                    <div className="flex flex-col gap-1.5">
                      <div className="h-2 overflow-hidden rounded-full bg-surface-200 dark:bg-surface-700">
                        <div className={clsx('h-full rounded-full', dl?.overdue ? 'bg-red-400/80' : 'bg-[#9DB4DA] dark:bg-[#6F95D6]/70')} style={{ width: `${time.pct}%` }} />
                      </div>
                      <div className="flex justify-between text-[12px] text-surface-500">
                        <span>прошло {time.passed} {plural(time.passed, 'день', 'дня', 'дней')} из {time.total}</span>
                        <span>сегодня {shortDay(todayIso())}</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>

            <DevTeamBlock projectId={id!} manager={project.manager ?? null}
              members={Array.isArray(project.members) ? project.members : []}
              canEdit={canEdit} openByUser={seesBoard ? openBy : undefined} />
          </div>

          {seesBoard && (
            <div className="grid gap-4 lg:grid-cols-2 items-start">
              {/* Задачи на доске */}
              <section className="card space-y-3">
                <h2 className={titleCls}>Задачи на доске</h2>
                <div className="grid grid-cols-5 gap-2">
                  {STATUS_TILES.map(t => (
                    <div key={t.key} className={clsx('flex flex-col gap-0.5 rounded-[10px] px-2.5 py-2', t.cls)}>
                      <span className="text-xl font-bold leading-tight tabular-nums">{stats.by[t.key]}</span>
                      <span className="text-[12px] leading-tight">{t.label}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]">
                  {stats.overdue > 0 && (
                    <>
                      <span className="h-2 w-2 rounded-full bg-red-600" aria-hidden="true" />
                      <span className="font-semibold text-red-600 dark:text-red-400">
                        {stats.overdue} {plural(stats.overdue, 'задача', 'задачи', 'задач')} {plural(stats.overdue, 'просрочена', 'просрочены', 'просрочено')}
                      </span>
                      <span className="text-surface-500">·</span>
                    </>
                  )}
                  <span className="text-surface-500">{stats.total ? `выполнено ${stats.done} из ${stats.total}` : 'задач пока нет'}</span>
                </div>
              </section>

              {/* Ближайшие дедлайны */}
              <section className="card space-y-2.5">
                <h2 className={titleCls}>Ближайшие дедлайны</h2>
                {near.length === 0 ? (
                  <p className="text-sm text-surface-500">Открытых задач со сроком нет</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {near.map(t => {
                      const late = isDevTaskOverdue(t)
                      const pill = late ? { label: 'просрочена', cls: LATE_PILL } : STATUS_PILL[t.status]
                      return (
                        <li key={t.id} className="grid grid-cols-[58px_minmax(0,1fr)_24px_auto] items-center gap-x-2.5 text-[13.5px]">
                          <span className={clsx('font-semibold', late ? 'text-red-600 dark:text-red-400' : 'text-surface-800 dark:text-surface-200')}>{shortDay(t.deadline)}</span>
                          <Link to={taskUrl(t.id)} className="truncate text-surface-900 hover:text-[#2D5DA8] dark:text-surface-100 dark:hover:text-[#8FB0E6]">{t.title}</Link>
                          {t.assignee ? <Avatar name={t.assignee.name} src={t.assignee.avatarUrl || t.assignee.avatar || undefined} size={24} /> : <span />}
                          <span className={clsx('justify-self-start rounded-md px-2 py-0.5 text-[12px] font-semibold', pill.cls)}>{pill.label}</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </div>
          )}
        </div>
      )}

      {tab === 'tasks' && <DevTasksTab projectId={id!} />}

      {tab === 'client' && (
        <section className="card max-w-3xl space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className={titleCls}>Клиент</h2>
            {canEdit && !clientEditing && <button type="button" onClick={startClient} className={editBtnCls}><Pencil size={13} /> Изменить</button>}
            {clientEditing && (
              <div className="flex gap-2">
                <button type="button" onClick={() => setClientEditing(false)} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700">Отмена</button>
                <button type="button" onClick={saveClient} className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg text-white bg-[#2D5DA8] hover:bg-[#244C8C]"><Check size={14} /> Сохранить</button>
              </div>
            )}
          </div>
          {clientEditing ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {CLIENT_FIELDS.map(f => (
                <label key={f.key} className="flex flex-col gap-1.5 text-[12.5px] text-surface-500">{f.label}
                  <input className="input" type={f.type ?? 'text'} value={clientDraft[f.key] ?? ''} placeholder={f.placeholder}
                    onChange={e => setClientDraft(d => ({ ...d, [f.key]: e.target.value }))} />
                </label>
              ))}
              <label className="sm:col-span-2 flex flex-col gap-1.5 text-[12.5px] text-surface-500">Заметки
                <textarea className="input min-h-[96px] resize-y leading-relaxed" value={clientDraft.notes ?? ''}
                  placeholder="Как удобнее связаться, кто согласует макеты, доступы…"
                  onChange={e => setClientDraft(d => ({ ...d, notes: e.target.value }))} />
              </label>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm">
              {CLIENT_FIELDS.map(f => {
                const v = String(info[f.key] ?? '').trim()
                return (
                  <div key={f.key} className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[12.5px] text-surface-500">{f.label}</span>
                    {!v ? <span className="font-semibold text-surface-400">—</span>
                      : f.type === 'tel' ? <a href={`tel:${v.replace(/[^\d+]/g, '')}`} className="truncate font-semibold text-surface-900 hover:text-[#2D5DA8] dark:text-surface-100">{v}</a>
                      : f.type === 'email' ? <a href={`mailto:${v}`} className="truncate font-semibold text-surface-900 hover:text-[#2D5DA8] dark:text-surface-100">{v}</a>
                      : <span className="truncate font-semibold text-surface-900 dark:text-surface-100">{v}</span>}
                  </div>
                )
              })}
              <div className="flex flex-col gap-0.5 sm:col-span-2 lg:col-span-3">
                <span className="text-[12.5px] text-surface-500">Заметки</span>
                {String(info.notes ?? '').trim()
                  ? <p className="whitespace-pre-wrap leading-relaxed text-surface-800 dark:text-surface-200">{info.notes}</p>
                  : <span className="font-semibold text-surface-400">—</span>}
              </div>
            </div>
          )}
        </section>
      )}

      <Modal open={confirmArchive} onClose={() => setConfirmArchive(false)} title="Завершить проект?" size="sm">
        <p className="text-sm leading-relaxed text-surface-600 dark:text-surface-300">
          Проект «{project.name}» уйдёт в архив и пропадёт из списка проектов разработки. Задачи на доске останутся. Вернуть проект можно из «Архива» на странице проектов.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setConfirmArchive(false)} className="btn-ghost">Отмена</button>
          <button type="button" onClick={() => archiveMut.mutate()} disabled={archiveMut.isPending} className="btn-danger">
            {archiveMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Archive size={15} />} Завершить
          </button>
        </div>
      </Modal>
    </div>
  )
}

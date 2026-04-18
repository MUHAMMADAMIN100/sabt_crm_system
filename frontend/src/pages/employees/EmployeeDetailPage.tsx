import { useState, lazy, Suspense } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { employeesApi, tasksApi, storiesApi } from '@/services/api.service'

const StoryCalendar = lazy(() => import('@/components/stories/StoryCalendar'))
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { PageLoader, StatusBadge, PriorityBadge, Avatar, ProgressBar, CollapsibleSection } from '@/components/ui'
import { ArrowLeft, Mail, Phone, Calendar, CheckSquare, Send, AtSign, ShieldCheck, Briefcase, Building2, Clock, AlertTriangle, TrendingUp, Camera, BookOpen, BarChart2, Edit2, Check, X, Trash2, Plus, Minus } from 'lucide-react'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { ru } from 'date-fns/locale'
import toast from 'react-hot-toast'

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const canView = ['admin', 'founder', 'co_founder', 'project_manager'].includes(user?.role || '')
  const isAdminOrFounder = user?.role === 'founder' || user?.role === 'co_founder'
  const canEditSalary = user?.role === 'founder' || user?.role === 'co_founder'

  const [editingSalary, setEditingSalary] = useState(false)
  const [salaryInput, setSalaryInput] = useState('')

  const { data: emp, isLoading } = useQuery({ queryKey: ['employee', id], queryFn: () => employeesApi.get(id!) })

  const salaryMut = useMutation({
    mutationFn: (salary: number) => employeesApi.update(id!, { salary }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee', id] })
      qc.invalidateQueries({ queryKey: ['employees'] })
      qc.invalidateQueries({ queryKey: ['payroll'] })
      qc.invalidateQueries({ queryKey: ['analytics-overview'] })
      setEditingSalary(false)
      toast.success('Зарплата обновлена')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка обновления'),
  })

  const saveSalary = (value: number) => {
    if (isNaN(value) || value < 0) { toast.error('Введите корректную сумму'); return }
    salaryMut.mutate(value)
  }

  const adjustSalary = (delta: number) => {
    const base = Number(salaryInput || emp?.salary || 0)
    const next = Math.max(0, base + delta)
    setSalaryInput(String(next))
  }

  const { data: tasks } = useQuery({
    queryKey: ['employee-tasks', id],
    queryFn: () => tasksApi.list({ assigneeId: emp?.userId }),
    enabled: !!emp?.userId,
  })

  const today = new Date()
  const monthFrom = format(startOfMonth(today), 'yyyy-MM-dd')
  const monthTo   = format(endOfMonth(today),   'yyyy-MM-dd')

  const { data: stories } = useQuery({
    queryKey: ['employee-stories', emp?.userId, monthFrom, monthTo],
    queryFn: () => storiesApi.all(monthFrom, monthTo),
    enabled: !!emp?.userId,
    select: (data: any[]) => data.filter((s: any) => s.employeeId === emp?.userId),
  })

  // Stories for last 3 months (for admin/founder view)
  const storiesFrom = format(startOfMonth(subMonths(new Date(), 2)), 'yyyy-MM-dd')
  const storiesTo = format(endOfMonth(new Date()), 'yyyy-MM-dd')

  const { data: allStories } = useQuery({
    queryKey: ['stories-all', storiesFrom, storiesTo],
    queryFn: () => storiesApi.all(storiesFrom, storiesTo),
    enabled: isAdminOrFounder,
  })

  if (isLoading) return <PageLoader />
  if (!emp) return <div className="text-surface-600 dark:text-surface-400">{t('common.noData')}</div>

  const doneTasks     = tasks?.filter((t: any) => t.status === 'done').length || 0
  const inProgress    = tasks?.filter((t: any) => t.status === 'in_progress') || []
  const overdueTasks  = tasks?.filter((t: any) =>
    t.deadline && new Date(t.deadline) < today && !['done','cancelled'].includes(t.status)
  ) || []
  const reviewTasks   = tasks?.filter((t: any) => t.status === 'review') || []
  const totalTasks    = tasks?.length || 0
  const pct           = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0
  const totalStories  = stories?.reduce((s: number, l: any) => s + (l.storiesCount || 0), 0) || 0
  const currentTask   = inProgress[0] || null

  // Group stories by project (only stories belonging to this employee's userId)
  const employeeStories = (allStories || []).filter(
    (s: any) => s.employeeId === emp.userId || s.employee?.id === emp.userId,
  )

  const storiesByProject: Record<string, { projectName: string; projectId: string; total: number; dates: string[] }> = {}
  employeeStories.forEach((s: any) => {
    const pid = s.projectId || s.project?.id
    const pname = s.project?.name || pid
    if (!pid) return
    if (!storiesByProject[pid]) {
      storiesByProject[pid] = { projectName: pname, projectId: pid, total: 0, dates: [] }
    }
    storiesByProject[pid].total += s.storiesCount || 0
    storiesByProject[pid].dates.push(s.date)
  })
  const storiesList = Object.values(storiesByProject).sort((a, b) => b.total - a.total)
  const totalStoriesCount = storiesList.reduce((s, p) => s + p.total, 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-xl text-surface-600 dark:text-surface-400">
          <ArrowLeft size={18} />
        </button>
        <h1 className="page-title">{t('employees.title')}</h1>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card text-center">
          <CheckSquare size={18} className="text-primary-600 mx-auto mb-1" />
          <p className="text-2xl font-bold text-surface-900 dark:text-surface-100">{totalTasks}</p>
          <p className="text-xs text-surface-500 dark:text-surface-400">{t('tasks.title')}</p>
        </div>
        <div className="card text-center">
          <TrendingUp size={18} className="text-green-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">{doneTasks}</p>
          <p className="text-xs text-surface-500 dark:text-surface-400">{t('common.completed')}</p>
        </div>
        <div className="card text-center">
          <AlertTriangle size={18} className="text-red-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">{overdueTasks.length}</p>
          <p className="text-xs text-surface-500 dark:text-surface-400">Просрочено</p>
        </div>
        <div className="card text-center">
          <Camera size={18} className="text-pink-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-pink-600 dark:text-pink-400">{totalStories}</p>
          <p className="text-xs text-surface-500 dark:text-surface-400">Историй (месяц)</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile card */}
        <div className="card text-center">
          <div className="flex justify-center mb-3"><Avatar name={emp.fullName} src={emp.avatar} size={80} /></div>
          <div className="flex items-center justify-center gap-2">
            <h2 className="font-bold text-xl text-surface-900 dark:text-surface-100">{emp.fullName}</h2>
            {emp.isSubAdmin && <ShieldCheck size={18} className="text-primary-500" />}
          </div>
          <p className="text-surface-500 dark:text-surface-400 mt-1">{emp.position}</p>
          <span className="inline-block mt-2 px-3 py-1 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 rounded-full text-sm font-medium">{emp.department}</span>

          <div className="mt-5 space-y-2.5 text-left">
            <InfoRow icon={<Mail size={14} />} label={t('employees.email')} value={emp.email} />
            {emp.phone && <InfoRow icon={<Phone size={14} />} label={t('employees.phone')} value={emp.phone} />}
            {emp.telegram && (
              <div className="flex items-center gap-3 p-2.5 bg-surface-50 dark:bg-surface-700/50 rounded-xl">
                <Send size={14} className="text-primary-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-surface-400 dark:text-surface-500">Telegram</p>
                  <a href={`https://t.me/${emp.telegram.replace('@', '')}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline">{emp.telegram}</a>
                </div>
              </div>
            )}
            {emp.instagram && (
              <div className="flex items-center gap-3 p-2.5 bg-surface-50 dark:bg-surface-700/50 rounded-xl">
                <AtSign size={14} className="text-pink-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-surface-400 dark:text-surface-500">Instagram</p>
                  <a href={`https://instagram.com/${emp.instagram.replace('@', '')}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-pink-600 dark:text-pink-400 hover:underline">{emp.instagram}</a>
                </div>
              </div>
            )}
            <InfoRow icon={<Calendar size={14} />} label={t('employees.hireDate')} value={format(new Date(emp.hireDate), 'dd.MM.yyyy')} />
            <InfoRow icon={<Briefcase size={14} />} label={t('employees.position')} value={emp.position} />
            <InfoRow icon={<Building2 size={14} />} label={t('employees.department')} value={emp.department} />
            {canEditSalary && (
              <div className="flex items-center gap-3 p-2.5 bg-surface-50 dark:bg-surface-700/50 rounded-xl">
                <BarChart2 size={14} className="text-surface-400 dark:text-surface-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-surface-400 dark:text-surface-500">Зарплата</p>
                  {editingSalary ? (
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <button
                        type="button"
                        onClick={() => adjustSalary(-100000)}
                        className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-500"
                        title="−100 000"
                      >
                        <Minus size={13} />
                      </button>
                      <input
                        type="number"
                        value={salaryInput}
                        onChange={ev => setSalaryInput(ev.target.value)}
                        className="input py-1 text-sm w-28 text-right"
                        min={0}
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => adjustSalary(100000)}
                        className="p-1 hover:bg-green-50 dark:hover:bg-green-900/20 rounded text-green-600"
                        title="+100 000"
                      >
                        <Plus size={13} />
                      </button>
                      <span className="text-xs text-surface-400">сомони</span>
                      <button
                        onClick={() => saveSalary(Number(salaryInput))}
                        disabled={salaryMut.isPending}
                        className="p-1 hover:bg-green-50 dark:hover:bg-green-900/20 rounded text-green-600"
                        title="Сохранить"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={() => { setEditingSalary(false); setSalaryInput('') }}
                        className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-500"
                        title="Отмена"
                      >
                        <X size={14} />
                      </button>
                      {(emp.salary || 0) > 0 && (
                        <button
                          onClick={() => { if (confirm('Удалить (обнулить) зарплату?')) saveSalary(0) }}
                          className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-500"
                          title="Обнулить"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-surface-900 dark:text-surface-100">
                        {(emp.salary || 0) > 0
                          ? `${(emp.salary || 0).toLocaleString('ru-RU')} сомони`
                          : <span className="text-surface-400 dark:text-surface-500 italic">не задана</span>}
                      </p>
                      <button
                        onClick={() => { setSalaryInput(String(emp.salary || 0)); setEditingSalary(true) }}
                        className="p-1 hover:bg-surface-100 dark:hover:bg-surface-600 rounded text-surface-400 hover:text-primary-600"
                        title="Изменить зарплату"
                      >
                        <Edit2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Progress */}
          <div className="mt-4 pt-4 border-t border-surface-100 dark:border-surface-700">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-surface-500 dark:text-surface-400">{t('common.completed')}</span>
              <span className="font-semibold text-surface-900 dark:text-surface-100">{pct}%</span>
            </div>
            <ProgressBar value={pct} />
          </div>
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-4">

          {/* Текущая задача */}
          {currentTask && (
            <div className="card border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-900/10">
              <h3 className="font-semibold mb-2 text-surface-700 dark:text-surface-300 text-sm flex items-center gap-2">
                <Clock size={15} className="text-primary-500" /> Сейчас работает над
              </h3>
              <Link to={`/tasks/${currentTask.id}`} className="flex items-center gap-3 p-3 rounded-xl hover:bg-primary-100/50 dark:hover:bg-primary-900/20 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{currentTask.title}</p>
                  <p className="text-xs text-surface-400 dark:text-surface-500">{currentTask.project?.name}</p>
                </div>
                <PriorityBadge priority={currentTask.priority} />
                {currentTask.deadline && (
                  <span className={`text-xs ${new Date(currentTask.deadline) < today && !['done','cancelled'].includes(currentTask.status) ? 'text-red-500' : 'text-surface-400 dark:text-surface-500'}`}>
                    {format(new Date(currentTask.deadline), 'dd.MM')}
                  </span>
                )}
              </Link>
            </div>
          )}

          {/* Просроченные задачи */}
          {overdueTasks.length > 0 && (
            <div className="card border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10">
              <h3 className="font-semibold mb-2 text-red-600 dark:text-red-400 text-sm flex items-center gap-2">
                <AlertTriangle size={15} /> Просроченные задачи ({overdueTasks.length})
              </h3>
              <div className="space-y-1.5">
                {overdueTasks.map((task: any) => (
                  <Link key={task.id} to={`/tasks/${task.id}`} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-red-100/50 dark:hover:bg-red-900/20 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{task.title}</p>
                        {task.createdById && task.assigneeId && (task.createdById === task.assigneeId || task.createdBy?.name?.trim()) && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${task.createdById === task.assigneeId ? 'bg-surface-100 dark:bg-surface-700 text-surface-400' : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'}`}>
                            {task.createdById === task.assigneeId ? 'сам' : (task.createdBy?.name?.trim().split(' ')[0] || '')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-surface-400 dark:text-surface-500">{task.project?.name}</p>
                    </div>
                    <StatusBadge status={task.status} />
                    <span className="text-xs text-red-500 font-medium shrink-0">{format(new Date(task.deadline), 'dd.MM')}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* На проверке */}
          {reviewTasks.length > 0 && (
            <div className="card border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
              <h3 className="font-semibold mb-2 text-amber-600 dark:text-amber-400 text-sm flex items-center gap-2">
                <CheckSquare size={15} /> На проверке ({reviewTasks.length})
              </h3>
              <div className="space-y-1.5">
                {reviewTasks.map((task: any) => (
                  <Link key={task.id} to={`/tasks/${task.id}`} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-amber-100/50 dark:hover:bg-amber-900/20 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{task.title}</p>
                        {task.createdById && task.assigneeId && (task.createdById === task.assigneeId || task.createdBy?.name?.trim()) && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${task.createdById === task.assigneeId ? 'bg-surface-100 dark:bg-surface-700 text-surface-400' : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'}`}>
                            {task.createdById === task.assigneeId ? 'сам' : (task.createdBy?.name?.trim().split(' ')[0] || '')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-surface-400 dark:text-surface-500">{task.project?.name}</p>
                    </div>
                    <PriorityBadge priority={task.priority} />
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Все задачи */}
          {canView && (
            <CollapsibleSection
              id={`emp-${id}-tasks`}
              title={<h3 className="font-semibold text-surface-700 dark:text-surface-300 text-sm flex items-center gap-2"><CheckSquare size={15} /> {t('tasks.title')} ({totalTasks})</h3>}
            >
              {!tasks?.length ? (
                <p className="text-sm text-surface-400 dark:text-surface-500 py-3 text-center">{t('tasks.noTasks')}</p>
              ) : (
                <div className="space-y-2">
                  {tasks.map((task: any) => (
                    <Link key={task.id} to={`/tasks/${task.id}`} className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700/50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{task.title}</p>
                          {task.createdById && task.assigneeId && (task.createdById === task.assigneeId || task.createdBy?.name?.trim()) && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${task.createdById === task.assigneeId ? 'bg-surface-100 dark:bg-surface-700 text-surface-400' : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'}`}>
                              {task.createdById === task.assigneeId ? 'сам' : (task.createdBy?.name?.trim().split(' ')[0] || '')}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-surface-400 dark:text-surface-500">{task.project?.name}</p>
                      </div>
                      <PriorityBadge priority={task.priority} />
                      <StatusBadge status={task.status} />
                      {task.deadline && (
                        <span className={`text-xs shrink-0 ${new Date(task.deadline) < today && !['done','cancelled'].includes(task.status) ? 'text-red-500 font-medium' : 'text-surface-400 dark:text-surface-500'}`}>
                          {format(new Date(task.deadline), 'dd.MM')}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </CollapsibleSection>
          )}

          {/* Календарь историй сотрудника */}
          {emp?.userId && (
            <Suspense fallback={<div className="text-center text-sm text-surface-400 py-4">Загрузка...</div>}>
              <StoryCalendar employeeId={emp.userId} compact />
            </Suspense>
          )}


          {emp.bio && (
            <div className="card">
              <h3 className="font-semibold mb-2 text-surface-700 dark:text-surface-300 text-sm">{t('tasks.description')}</h3>
              <p className="text-sm text-surface-600 dark:text-surface-400">{emp.bio}</p>
            </div>
          )}

          {/* Stories by project (admin/founder only) */}
          {isAdminOrFounder && (
            <CollapsibleSection
              id={`emp-${id}-stories-3m`}
              title={
                <h3 className="font-semibold text-surface-700 dark:text-surface-300 text-sm flex items-center gap-2 w-full">
                  <BookOpen size={15} className="text-pink-500" />
                  Истории по проектам
                  <span className="ml-auto text-xs text-surface-400 dark:text-surface-500 font-normal">последние 3 месяца</span>
                </h3>
              }
              defaultOpen={false}
            >
              {!storiesList.length ? (
                <p className="text-sm text-surface-400 dark:text-surface-500 py-3 text-center">Историй не найдено</p>
              ) : (
                <>
                  <div className="mb-3 p-3 bg-pink-50 dark:bg-pink-900/20 rounded-xl flex items-center justify-between">
                    <span className="text-sm text-surface-600 dark:text-surface-400">Всего историй</span>
                    <span className="text-xl font-bold text-pink-600 dark:text-pink-400">{totalStoriesCount}</span>
                  </div>
                  <div className="space-y-2">
                    {storiesList.map(p => {
                      const maxStories = Math.max(...storiesList.map(s => s.total), 1)
                      const pct = Math.round((p.total / maxStories) * 100)
                      return (
                        <div key={p.projectId} className="flex items-center gap-3">
                          <Link
                            to={`/projects/${p.projectId}`}
                            className="flex-1 min-w-0 text-sm font-medium text-surface-800 dark:text-surface-200 hover:text-primary-600 dark:hover:text-primary-400 truncate"
                          >
                            {p.projectName}
                          </Link>
                          <div className="flex items-center gap-2 shrink-0">
                            <div className="w-20 bg-surface-100 dark:bg-surface-700 rounded-full h-1.5">
                              <div
                                className="h-1.5 rounded-full bg-pink-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-sm font-semibold text-pink-600 dark:text-pink-400 w-8 text-right">{p.total}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-xs text-surface-400 dark:text-surface-500 mt-3 text-center">
                    {format(new Date(storiesFrom), 'dd MMM', { locale: ru })} — {format(new Date(storiesTo), 'dd MMM yyyy', { locale: ru })}
                  </p>
                </>
              )}
            </CollapsibleSection>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 p-2.5 bg-surface-50 dark:bg-surface-700/50 rounded-xl">
      <div className="text-surface-400 dark:text-surface-500 shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-surface-400 dark:text-surface-500">{label}</p>
        <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{value}</p>
      </div>
    </div>
  )
}

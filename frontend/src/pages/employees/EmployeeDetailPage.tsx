import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { employeesApi, tasksApi, storiesApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { PageLoader, StatusBadge, PriorityBadge, Avatar, ProgressBar } from '@/components/ui'
import { ArrowLeft, Mail, Phone, Calendar, CheckSquare, Send, AtSign, ShieldCheck, Briefcase, Building2, Clock, AlertTriangle, TrendingUp, Camera } from 'lucide-react'
import { format, startOfMonth, endOfMonth } from 'date-fns'

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const user = useAuthStore(s => s.user)
  const canView = ['admin', 'founder', 'project_manager'].includes(user?.role || '')

  const { data: emp, isLoading } = useQuery({ queryKey: ['employee', id], queryFn: () => employeesApi.get(id!) })
  const { data: tasks } = useQuery({
    queryKey: ['employee-tasks', id],
    queryFn: () => tasksApi.list({ assigneeId: emp?.userId }),
    enabled: !!emp?.userId,
  })

  const today = new Date()
  const monthFrom = format(startOfMonth(today), 'yyyy-MM-dd')
  const monthTo   = format(endOfMonth(today),   'yyyy-MM-dd')

  const { data: stories } = useQuery({
    queryKey: ['employee-stories', emp?.id, monthFrom, monthTo],
    queryFn: () => storiesApi.all(monthFrom, monthTo),
    enabled: !!emp?.id,
    select: (data: any[]) => data.filter((s: any) => s.employee?.id === emp?.id || s.employeeId === emp?.id),
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

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-xl text-surface-600 dark:text-surface-400"><ArrowLeft size={18} /></button>
        <h1 className="page-title">{t('employees.title')}</h1>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
                  <a href={`https://t.me/${emp.telegram.replace('@','')}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline">{emp.telegram}</a>
                </div>
              </div>
            )}
            {emp.instagram && (
              <div className="flex items-center gap-3 p-2.5 bg-surface-50 dark:bg-surface-700/50 rounded-xl">
                <AtSign size={14} className="text-pink-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-surface-400 dark:text-surface-500">Instagram</p>
                  <a href={`https://instagram.com/${emp.instagram.replace('@','')}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-pink-600 dark:text-pink-400 hover:underline">{emp.instagram}</a>
                </div>
              </div>
            )}
            <InfoRow icon={<Calendar size={14} />} label={t('employees.hireDate')} value={format(new Date(emp.hireDate), 'dd.MM.yyyy')} />
            <InfoRow icon={<Briefcase size={14} />} label={t('employees.position')} value={emp.position} />
            <InfoRow icon={<Building2 size={14} />} label={t('employees.department')} value={emp.department} />
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
                  <span className={`text-xs ${new Date(currentTask.deadline) < today ? 'text-red-500' : 'text-surface-400 dark:text-surface-500'}`}>
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
                      <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{task.title}</p>
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
                      <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{task.title}</p>
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
            <div className="card">
              <h3 className="font-semibold mb-3 text-surface-700 dark:text-surface-300 text-sm flex items-center gap-2">
                <CheckSquare size={15} /> {t('tasks.title')} ({totalTasks})
              </h3>
              {!tasks?.length ? (
                <p className="text-sm text-surface-400 dark:text-surface-500 py-3 text-center">{t('tasks.noTasks')}</p>
              ) : (
                <div className="space-y-2">
                  {tasks.map((task: any) => (
                    <Link key={task.id} to={`/tasks/${task.id}`} className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700/50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{task.title}</p>
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
            </div>
          )}

          {/* Истории по месяцам */}
          {stories && stories.length > 0 && (
            <div className="card">
              <h3 className="font-semibold mb-3 text-surface-700 dark:text-surface-300 text-sm flex items-center gap-2">
                <Camera size={15} className="text-pink-500" /> Истории за месяц ({monthFrom.slice(0,7)})
              </h3>
              <div className="space-y-2">
                {stories.map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between p-2.5 rounded-xl bg-surface-50 dark:bg-surface-700/50">
                    <div>
                      <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{s.project?.name || '—'}</p>
                      <p className="text-xs text-surface-400 dark:text-surface-500">{s.date}</p>
                    </div>
                    <span className="text-sm font-bold text-pink-600 dark:text-pink-400">{s.storiesCount} шт.</span>
                  </div>
                ))}
                <div className="flex justify-between pt-2 border-t border-surface-100 dark:border-surface-700">
                  <span className="text-sm text-surface-500 dark:text-surface-400">Итого:</span>
                  <span className="text-sm font-bold text-surface-900 dark:text-surface-100">{totalStories} историй</span>
                </div>
              </div>
            </div>
          )}

          {emp.bio && (
            <div className="card">
              <h3 className="font-semibold mb-2 text-surface-700 dark:text-surface-300 text-sm">{t('tasks.description')}</h3>
              <p className="text-sm text-surface-600 dark:text-surface-400">{emp.bio}</p>
            </div>
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

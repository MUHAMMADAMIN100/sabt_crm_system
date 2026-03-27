import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { employeesApi, tasksApi } from '@/services/api.service'
import { useTranslation } from '@/i18n'
import { PageLoader, StatusBadge, PriorityBadge, Avatar, ProgressBar } from '@/components/ui'
import { ArrowLeft, Mail, Phone, Calendar, CheckSquare, Send, AtSign, ShieldCheck, Briefcase, Building2 } from 'lucide-react'
import { format } from 'date-fns'

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useTranslation()

  const { data: emp, isLoading } = useQuery({ queryKey: ['employee', id], queryFn: () => employeesApi.get(id!) })
  const { data: tasks } = useQuery({ queryKey: ['employee-tasks', id], queryFn: () => tasksApi.list({ assigneeId: emp?.userId }), enabled: !!emp?.userId })

  if (isLoading) return <PageLoader />
  if (!emp) return <div className="text-surface-600 dark:text-surface-400">{t('common.noData')}</div>

  const doneTasks = tasks?.filter((t: any) => t.status === 'done').length || 0
  const totalTasks = tasks?.length || 0
  const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/employees" className="p-2 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-xl text-surface-600 dark:text-surface-400"><ArrowLeft size={18} /></Link>
        <h1 className="page-title">{t('employees.title')}</h1>
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
                <Send size={14} className="text-blue-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-surface-400 dark:text-surface-500">Telegram</p>
                  <a href={`https://t.me/${emp.telegram.replace('@','')}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">{emp.telegram}</a>
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

          <div className="mt-4 pt-4 border-t border-surface-100 dark:border-surface-700">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-surface-500 dark:text-surface-400">{t('common.completed')}</span>
              <span className="font-semibold text-surface-900 dark:text-surface-100">{pct}%</span>
            </div>
            <ProgressBar value={pct} />
            <div className="grid grid-cols-2 gap-3 mt-3 text-center">
              <div>
                <p className="text-2xl font-bold text-surface-900 dark:text-surface-100">{totalTasks}</p>
                <p className="text-xs text-surface-500 dark:text-surface-400">{t('tasks.title')}</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{doneTasks}</p>
                <p className="text-xs text-surface-500 dark:text-surface-400">{t('common.completed')}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tasks */}
        <div className="lg:col-span-2 space-y-4">
          {emp.bio && (
            <div className="card">
              <h3 className="font-semibold mb-2 text-surface-700 dark:text-surface-300 text-sm">{t('tasks.description')}</h3>
              <p className="text-sm text-surface-600 dark:text-surface-400">{emp.bio}</p>
            </div>
          )}

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
                      <span className={`text-xs ${new Date(task.deadline) < new Date() ? 'text-red-500' : 'text-surface-400 dark:text-surface-500'}`}>
                        {format(new Date(task.deadline), 'dd.MM')}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>
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

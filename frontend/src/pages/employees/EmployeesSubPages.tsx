// Подстраницы раздела «Сотрудники» (решение владельца 19.10.2026): то, что
// раньше переключалось значками на одной странице, теперь — пункты меню,
// как у «СММ» и «Финансов».
import { useQuery } from '@tanstack/react-query'
import { employeesApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { EmptyState, PageLoader } from '@/components/ui'
import TeamActivity from '@/pages/team-activity/TeamActivityPage'
import OrgChart from './OrgChart'
import WeekTasks from './WeekTasks'

/** Оргструктура. Руководитель SMM видит только SMM-сотрудников — как в списке. */
export function EmployeesOrgPage() {
  const user = useAuthStore(s => s.user)
  const { data, isLoading } = useQuery({ queryKey: ['employees'], queryFn: () => employeesApi.list() })
  if (isLoading) return <PageLoader />
  const smmLead = user?.role === 'smm_director'
  const list = (data || []).filter((emp: any) => !smmLead
    || ['SMM специалист', 'Руководитель SMM'].includes(emp.position || '')
    || ['smm_specialist', 'smm_director'].includes(emp.user?.role || ''))
  return (
    <div className="space-y-5">
      <h1 className="page-title">Оргструктура</h1>
      {list.length ? <OrgChart employees={list} /> : <EmptyState title="Сотрудников пока нет" />}
    </div>
  )
}

export function EmployeesWeekPage() {
  return (
    <div className="space-y-5">
      <h1 className="page-title">Задачи недели</h1>
      <WeekTasks />
    </div>
  )
}

export function EmployeesActivityPage() {
  return (
    <div className="space-y-5">
      <h1 className="page-title">Активность и смены</h1>
      <TeamActivity />
    </div>
  )
}

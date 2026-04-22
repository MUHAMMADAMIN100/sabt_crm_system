import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  AlertTriangle, AlertCircle, CheckCircle2, ExternalLink,
  Users, Briefcase, Activity,
} from 'lucide-react'
import { riskApi } from '@/services/api.service'
import { PageLoader, EmptyState } from '@/components/ui'

type Level = 'green' | 'yellow' | 'red'

interface RiskFactor {
  key: string
  label: string
  triggered: boolean
  weight: number
  detail?: string
}

interface ProjectRisk {
  projectId: string
  projectName: string
  managerId: string | null
  managerName: string | null
  level: Level
  score: number
  factors: RiskFactor[]
}

interface EmployeeRisk {
  userId: string
  userName: string
  role: string
  level: Level
  score: number
  factors: RiskFactor[]
}

interface PmWorkload {
  pmId: string
  pmName: string
  projectCount: number
  smmSpecialistCount: number
  tasksOnReview: number
  tasksOnRework: number
  projectsAtRisk: number
}

const LEVEL_CHIP: Record<Level, string> = {
  green:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  yellow: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  red:    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const LEVEL_ICON: Record<Level, any> = {
  green:  CheckCircle2,
  yellow: AlertCircle,
  red:    AlertTriangle,
}

type Filter = 'all' | 'red' | 'yellow' | 'green'

export default function RisksPage() {
  const [projectFilter, setProjectFilter] = useState<Filter>('all')
  const [employeeFilter, setEmployeeFilter] = useState<Filter>('all')

  const { data: projectRisks, isLoading: pLoad } = useQuery<ProjectRisk[]>({
    queryKey: ['risks-projects'],
    queryFn: riskApi.projectRisks,
  })

  const { data: employeeRisks, isLoading: eLoad } = useQuery<EmployeeRisk[]>({
    queryKey: ['risks-employees'],
    queryFn: riskApi.employeeRisks,
  })

  const { data: pmWorkloads } = useQuery<PmWorkload[]>({
    queryKey: ['workload-pm'],
    queryFn: () => riskApi.workloadPm(),
  })

  if (pLoad || eLoad) return <PageLoader />

  const filteredProjects = (projectRisks ?? []).filter(p =>
    projectFilter === 'all' ? true : p.level === projectFilter,
  )
  const filteredEmployees = (employeeRisks ?? []).filter(e =>
    employeeFilter === 'all' ? true : e.level === employeeFilter,
  )

  const projectStats = countByLevel(projectRisks ?? [])
  const employeeStats = countByLevel(employeeRisks ?? [])

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Риски и нагрузка</h1>
        <p className="text-sm text-gray-500">
          Сводка операционных рисков по проектам, сотрудникам и нагрузке менеджеров.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SummaryCard title="Проекты" stats={projectStats} icon={Briefcase} />
        <SummaryCard title="Сотрудники" stats={employeeStats} icon={Users} />
      </div>

      <Section
        title="Проекты в риске"
        icon={Briefcase}
        filter={projectFilter}
        onFilterChange={setProjectFilter}
        stats={projectStats}
      >
        {filteredProjects.length === 0 ? (
          <EmptyState title="Ничего не найдено" description="Попробуйте сменить фильтр." />
        ) : (
          <div className="space-y-2">
            {filteredProjects.map(p => <ProjectRiskRow key={p.projectId} risk={p} />)}
          </div>
        )}
      </Section>

      <Section
        title="Сотрудники в риске"
        icon={Users}
        filter={employeeFilter}
        onFilterChange={setEmployeeFilter}
        stats={employeeStats}
      >
        {filteredEmployees.length === 0 ? (
          <EmptyState title="Ничего не найдено" description="Попробуйте сменить фильтр." />
        ) : (
          <div className="space-y-2">
            {filteredEmployees.map(e => <EmployeeRiskRow key={e.userId} risk={e} />)}
          </div>
        )}
      </Section>

      <section>
        <div className="flex items-center gap-2 mb-3">
          <Activity size={18} className="text-purple-500" />
          <h2 className="font-semibold">Нагрузка PM-ов</h2>
        </div>
        {(pmWorkloads ?? []).length === 0 ? (
          <EmptyState title="Нет данных" description="Загружу когда появятся PM с активными проектами." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {pmWorkloads!.map(p => <PmWorkloadCard key={p.pmId} pm={p} />)}
          </div>
        )}
      </section>
    </div>
  )
}

function countByLevel(rows: { level: Level }[]) {
  return rows.reduce(
    (acc, r) => { acc[r.level] = (acc[r.level] || 0) + 1; return acc },
    { green: 0, yellow: 0, red: 0 } as Record<Level, number>,
  )
}

function SummaryCard({ title, stats, icon: Icon }: { title: string; stats: Record<Level, number>; icon: any }) {
  const total = stats.green + stats.yellow + stats.red
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
          <Icon size={16} /> {title}
        </div>
        <div className="text-2xl font-bold">{total}</div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Tile value={stats.red} label="Red" cls="bg-red-50 dark:bg-red-900/10 text-red-700 dark:text-red-400" />
        <Tile value={stats.yellow} label="Yellow" cls="bg-amber-50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-400" />
        <Tile value={stats.green} label="Green" cls="bg-emerald-50 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-400" />
      </div>
    </div>
  )
}

function Tile({ value, label, cls }: { value: number; label: string; cls: string }) {
  return (
    <div className={clsx('rounded-lg py-3', cls)}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
    </div>
  )
}

function Section({ title, icon: Icon, filter, onFilterChange, stats, children }: {
  title: string
  icon: any
  filter: Filter
  onFilterChange: (f: Filter) => void
  stats: Record<Level, number>
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Icon size={18} className="text-purple-500" />
          <h2 className="font-semibold">{title}</h2>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <FilterChip active={filter === 'all'}    onClick={() => onFilterChange('all')}    label={`Все ${stats.green + stats.yellow + stats.red}`} />
          <FilterChip active={filter === 'red'}    onClick={() => onFilterChange('red')}    label={`🔥 Red ${stats.red}`} />
          <FilterChip active={filter === 'yellow'} onClick={() => onFilterChange('yellow')} label={`⚠️ Yellow ${stats.yellow}`} />
          <FilterChip active={filter === 'green'}  onClick={() => onFilterChange('green')}  label={`✓ Green ${stats.green}`} />
        </div>
      </div>
      {children}
    </section>
  )
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'px-2.5 py-1 rounded-full transition-colors',
        active
          ? 'bg-purple-600 text-white'
          : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700',
      )}
    >{label}</button>
  )
}

function ProjectRiskRow({ risk }: { risk: ProjectRisk }) {
  const Icon = LEVEL_ICON[risk.level]
  const triggered = risk.factors.filter(f => f.triggered)
  return (
    <div className={clsx(
      'rounded-lg border p-3 bg-white dark:bg-gray-900',
      risk.level === 'red'    ? 'border-red-200 dark:border-red-900/50' :
      risk.level === 'yellow' ? 'border-amber-200 dark:border-amber-900/50' :
      'border-gray-200 dark:border-gray-700',
    )}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Icon size={20} className={
            risk.level === 'red' ? 'text-red-500' :
            risk.level === 'yellow' ? 'text-amber-500' : 'text-emerald-500'
          } />
          <div className="min-w-0">
            <Link
              to={`/projects/${risk.projectId}`}
              className="font-medium text-sm hover:text-purple-600 inline-flex items-center gap-1"
            >
              {risk.projectName}
              <ExternalLink size={12} className="opacity-50" />
            </Link>
            <div className="text-xs text-gray-500 mt-0.5">
              PM: {risk.managerName ?? '—'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={clsx('text-xs px-2 py-1 rounded-full font-medium', LEVEL_CHIP[risk.level])}>
            {risk.level.toUpperCase()} · {risk.score}
          </span>
        </div>
      </div>
      {triggered.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {triggered.map(f => (
            <span key={f.key} className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
              {f.label}{f.detail ? ` (${f.detail})` : ''} +{f.weight}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function EmployeeRiskRow({ risk }: { risk: EmployeeRisk }) {
  const Icon = LEVEL_ICON[risk.level]
  const triggered = risk.factors.filter(f => f.triggered)
  return (
    <div className={clsx(
      'rounded-lg border p-3 bg-white dark:bg-gray-900',
      risk.level === 'red'    ? 'border-red-200 dark:border-red-900/50' :
      risk.level === 'yellow' ? 'border-amber-200 dark:border-amber-900/50' :
      'border-gray-200 dark:border-gray-700',
    )}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Icon size={20} className={
            risk.level === 'red' ? 'text-red-500' :
            risk.level === 'yellow' ? 'text-amber-500' : 'text-emerald-500'
          } />
          <div className="min-w-0">
            <Link
              to={`/employees/${risk.userId}`}
              className="font-medium text-sm hover:text-purple-600 inline-flex items-center gap-1"
            >
              {risk.userName}
              <ExternalLink size={12} className="opacity-50" />
            </Link>
            <div className="text-xs text-gray-500 mt-0.5">{risk.role}</div>
          </div>
        </div>
        <span className={clsx('text-xs px-2 py-1 rounded-full font-medium', LEVEL_CHIP[risk.level])}>
          {risk.level.toUpperCase()} · {risk.score}
        </span>
      </div>
      {triggered.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {triggered.map(f => (
            <span key={f.key} className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
              {f.label}{f.detail ? ` (${f.detail})` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function PmWorkloadCard({ pm }: { pm: PmWorkload }) {
  const overloaded = pm.tasksOnReview > 10 || pm.projectCount > 8 || pm.projectsAtRisk > 0
  return (
    <div className={clsx(
      'rounded-xl border p-4 bg-white dark:bg-gray-900',
      overloaded ? 'border-amber-200 dark:border-amber-900/50' : 'border-gray-200 dark:border-gray-700',
    )}>
      <div className="font-medium text-sm mb-3">{pm.pmName}</div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-gray-500">Проектов</dt>
        <dd className="font-medium text-right">{pm.projectCount}</dd>
        <dt className="text-gray-500">SMM в команде</dt>
        <dd className="font-medium text-right">{pm.smmSpecialistCount}</dd>
        <dt className="text-gray-500">На проверке</dt>
        <dd className={clsx('font-medium text-right', pm.tasksOnReview > 10 && 'text-amber-600')}>{pm.tasksOnReview}</dd>
        <dt className="text-gray-500">На доработке</dt>
        <dd className="font-medium text-right">{pm.tasksOnRework}</dd>
        <dt className="text-gray-500">Проектов в риске</dt>
        <dd className={clsx('font-medium text-right', pm.projectsAtRisk > 0 && 'text-red-600')}>{pm.projectsAtRisk}</dd>
      </dl>
    </div>
  )
}

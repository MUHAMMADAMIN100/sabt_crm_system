import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '@/services/api.service'
import { useTranslation } from '@/i18n'
import { PageLoader, EmptyState, ProgressBar } from '@/components/ui'
import { RotateCcw, FolderKanban } from 'lucide-react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const PROJECT_TYPE_FILTERS = [
  { value: '', label: 'Все типы' },
  { value: 'Web сайт', label: 'Web сайт' },
  { value: 'Дизайн', label: 'Дизайн' },
  { value: 'SMM', label: 'SMM' },
]

export default function ArchivePage() {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const [projectType, setProjectType] = useState('')

  const { data: allProjects, isLoading } = useQuery({
    queryKey: ['projects-archived'],
    queryFn: () => projectsApi.list({ archived: 'true' }),
  })

  const projects = (allProjects || []).filter((p: any) =>
    !projectType || p.projectType === projectType,
  )

  const restoreMut = useMutation({
    mutationFn: projectsApi.restore,
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['projects-archived'] })
      const previous = qc.getQueryData(['projects-archived'])
      qc.setQueryData(['projects-archived'], (old: any[]) => old?.filter((p: any) => p.id !== id) ?? [])
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['projects-archived'], context?.previous)
      toast.error('Ошибка')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects-archived'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      toast.success(t('archive.restored'))
    },
  })

  if (isLoading) return <PageLoader />

  return (
    <div className="space-y-5">
      <h1 className="page-title">{t('archive.title')}</h1>

      {/* Project type filter */}
      {(allProjects?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-surface-500 dark:text-surface-400 mr-1">Тип:</span>
          {PROJECT_TYPE_FILTERS.map(pt => (
            <button
              key={pt.value}
              onClick={() => setProjectType(pt.value)}
              className={clsx(
                'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                projectType === pt.value
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600',
              )}
            >{pt.label}</button>
          ))}
        </div>
      )}

      {!projects?.length ? (
        <EmptyState title={t('archive.noArchived')} description={t('archive.noArchivedDesc')} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p: any) => (
            <div key={p.id} className="card opacity-80 hover:opacity-100 transition-opacity">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-surface-100 dark:bg-surface-700 flex items-center justify-center">
                    <FolderKanban size={16} className="text-surface-400 dark:text-surface-500" />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Link to={`/projects/${p.id}`} className="font-semibold text-surface-700 dark:text-surface-300 hover:text-primary-600 dark:hover:text-primary-400 text-sm">{p.name}</Link>
                    {p.projectType && (
                      <button
                        type="button"
                        onClick={() => setProjectType(p.projectType)}
                        title={`Показать только "${p.projectType}"`}
                        className="text-[10px] bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 hover:bg-primary-200 dark:hover:bg-primary-900/50 px-1.5 py-0.5 rounded-full transition-colors"
                      >{p.projectType}</button>
                    )}
                  </div>
                </div>
                <button onClick={() => restoreMut.mutate(p.id)} className="btn-secondary text-xs py-1">
                  <RotateCcw size={12} /> {t('common.restore')}
                </button>
              </div>
              {p.description && <p className="text-xs text-surface-400 dark:text-surface-500 mb-2 line-clamp-2">{p.description}</p>}
              <div className="mb-2">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-surface-400 dark:text-surface-500">{t('projects.progress')}</span>
                  <span className="text-surface-700 dark:text-surface-300">{p.progress}%</span>
                </div>
                <ProgressBar value={p.progress} />
              </div>
              <p className="text-xs text-surface-400 dark:text-surface-500">
                {p.endDate ? `${format(new Date(p.endDate), 'dd.MM.yyyy')}` : `${format(new Date(p.createdAt), 'dd.MM.yyyy')}`}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Circle, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { launchApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'

interface LaunchItem {
  key: string
  label: string
  done: boolean
  manual: boolean
}

interface LaunchState {
  items: LaunchItem[]
  completedCount: number
  totalCount: number
  percent: number
  isComplete: boolean
}

const EDIT_ROLES = ['admin', 'founder', 'co_founder', 'smm_director', 'project_manager', 'head_smm']

export default function LaunchChecklistTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient()
  const role = useAuthStore(s => s.user?.role)
  const canEditManual = !!role && EDIT_ROLES.includes(role)

  const { data, isLoading } = useQuery<LaunchState>({
    queryKey: ['launch-checklist', projectId],
    queryFn: () => launchApi.get(projectId),
  })

  const toggleMut = useMutation({
    mutationFn: ({ item, value }: { item: string; value: boolean }) =>
      launchApi.setItem(projectId, item, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['launch-checklist', projectId] })
      qc.invalidateQueries({ queryKey: ['project', projectId] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="animate-spin text-surface-500" />
      </div>
    )
  }

  if (!data) return null

  const barColor = data.percent === 100
    ? 'bg-green-500'
    : data.percent >= 70
    ? 'bg-surface-500'
    : 'bg-red-500'

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold text-base">Готовность к запуску</h3>
            <p className="text-xs text-gray-500">
              Проект нельзя перевести в работу, пока чеклист не закрыт.
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{data.percent}%</div>
            <div className="text-xs text-gray-500">{data.completedCount} / {data.totalCount}</div>
          </div>
        </div>
        <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <div
            className={clsx('h-full transition-all duration-300', barColor)}
            style={{ width: `${data.percent}%` }}
          />
        </div>
      </div>

      <ul className="space-y-2">
        {data.items.map(item => {
          const interactive = item.manual && canEditManual
          return (
            <li
              key={item.key}
              className={clsx(
                'flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors',
                item.done
                  ? 'border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-900/10'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900',
                interactive ? 'cursor-pointer hover:border-surface-400' : '',
              )}
              onClick={() => interactive && !toggleMut.isPending && toggleMut.mutate({ item: item.key, value: !item.done })}
            >
              <span className={clsx(
                'w-6 h-6 rounded-full flex items-center justify-center shrink-0',
                item.done
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400',
              )}>
                {item.done ? <Check size={14} /> : <Circle size={10} />}
              </span>
              <span className={clsx('flex-1 text-sm', item.done && 'line-through text-gray-500')}>
                {item.label}
              </span>
              <span className={clsx(
                'text-[10px] px-2 py-0.5 rounded-full',
                item.manual
                  ? 'bg-surface-100 text-surface-700 dark:bg-surface-900/30 dark:text-surface-400'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
              )}>
                {item.manual ? 'вручную' : 'авто'}
              </span>
            </li>
          )
        })}
      </ul>

      {!canEditManual && (
        <p className="text-xs text-gray-500 italic">
          Ручные пункты могут переключать только PM, head_smm, admin, основатели.
        </p>
      )}
    </div>
  )
}

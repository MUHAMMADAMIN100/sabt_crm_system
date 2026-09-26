// Стек команды для карточки списка /dev/projects: аватары (до 5 + «+N»
// с тултипами имён) и бейдж «Ведёт: имя» (или иконка, если PM не назначен).
// Используется ТОЛЬКО в dev-ветке списка — SMM-карточки не трогает.

import { UserX } from 'lucide-react'
import { Avatar } from '@/components/ui'
import { devRoleLabel, type DevTeamPerson } from '../devTeam'

const MAX_SHOWN = 5

export function DevTeamStack({ manager, members, membersCount }: {
  manager?: DevTeamPerson | null
  members?: DevTeamPerson[] | null
  membersCount?: number | null
}) {
  const list = (Array.isArray(members) ? members : []).filter(m => m?.id)
  const total = typeof membersCount === 'number' && membersCount >= 0 ? membersCount : list.length
  const shown = list.slice(0, MAX_SHOWN)
  const extra = Math.max(0, total - shown.length)
  const hasStack = shown.length > 0 || extra > 0
  return (
    <div className="min-w-0 max-w-full">
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        {hasStack ? (
          <span className="flex -space-x-2 shrink-0" title={shown.map(m => m.name).join(', ')}>
            {shown.map(m => (
              <span key={m.id} className="ring-2 ring-white dark:ring-gray-900 rounded-full">
                <Avatar name={m.name} src={m.avatar || undefined} size={22} />
              </span>
            ))}
            {extra > 0 && (
              <span
                title={`Ещё ${extra}`}
                className="w-[22px] h-[22px] rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-[10px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-gray-900 shrink-0"
              >
                +{extra}
              </span>
            )}
          </span>
        ) : !manager?.id ? (
          <span className="text-[11.5px] text-gray-400 shrink-0">Команда не набрана</span>
        ) : null}
        {manager?.id ? (
          <span
            title={manager.role ? `${manager.name} · ${devRoleLabel(manager.role)}` : manager.name}
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 min-w-0 max-w-full"
          >
            <span className="text-gray-400 shrink-0">Ведёт:</span>
            <span className="truncate max-w-[140px]">{manager.name}</span>
          </span>
        ) : (
          <span title="PM не назначен" className="inline-flex items-center text-gray-300 dark:text-gray-600 shrink-0">
            <UserX size={15} />
          </span>
        )}
      </div>
    </div>
  )
}

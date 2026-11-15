import { AlertTriangle } from 'lucide-react'
import StageBadge from './StageBadge'

export type DuplicateItem = { id: string; name: string; status: string; ownerName: string | null }

/**
 * «Похоже, такой клиент уже есть» (15.11.2026): сервер нашёл совпадение по
 * телефону, Instagram или названию (409). Два менеджера не должны
 * обзванивать одного клиента — сначала показываем найденных, создать
 * всё равно можно осознанно.
 */
export default function DuplicateNotice({ duplicates, onOpen, onForce, forcing }: {
  duplicates: DuplicateItem[]
  onOpen: (id: string) => void
  onForce: () => void
  forcing?: boolean
}) {
  return (
    <div role="alert" className="rounded-lg border border-amber-400/70 bg-amber-50 p-3 dark:border-amber-500/50 dark:bg-amber-900/20">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
        <AlertTriangle size={16} aria-hidden="true" /> Похоже, такой клиент уже есть
      </p>
      <ul className="mt-2 divide-y divide-amber-200/70 dark:divide-amber-800/40">
        {duplicates.map(d => (
          <li key={d.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-surface-900 dark:text-surface-50">{d.name}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-surface-600 dark:text-surface-300">
                <StageBadge status={d.status} />
                {d.ownerName ? `ведёт ${d.ownerName}` : 'без ответственного'}
              </p>
            </div>
            <button type="button" onClick={() => onOpen(d.id)} className="btn-secondary min-h-[44px] shrink-0"
              aria-label={`Открыть «${d.name}»`}>
              Открыть
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onForce} disabled={forcing} className="btn-ghost mt-1 min-h-[44px] w-full text-amber-900 dark:text-amber-200">
        {forcing ? 'Создание…' : 'Всё равно создать'}
      </button>
    </div>
  )
}

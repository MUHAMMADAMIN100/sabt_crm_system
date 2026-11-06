import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { ChevronDown, User as UserIcon } from 'lucide-react'
import { directApi, type DirectConversation } from '@/services/direct.api'
import { isSocketConnected } from '@/lib/socketState'
import { applyDirectConversation } from './directCache'
import { canTransferIn, isSalesUser, MANAGER_ROLE } from './directAccess'

type Me = { id: string; name: string; role?: string | null; secondaryRole?: string | null } | null | undefined

/**
 * Кто ведёт клиента и передача чата: «Ведёт: Мадина Сафарова · Передать ▾».
 * Передать или освободить может руководство (любой чат, свободный — закрепить)
 * и сам менеджер (свой чат). В ленте после этого появляется отметка.
 */
export default function AssigneeControl({ c, me, onChanged }: { c: DirectConversation; me: Me; onChanged: () => void }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const assignee = c.assignee
  const mine = !!assignee && assignee.id === me?.id
  const can = canTransferIn(me, assignee?.id)

  const { data: managers, isLoading } = useQuery({
    queryKey: ['direct', 'managers'],
    queryFn: directApi.managers,
    staleTime: 5 * 60_000,
    enabled: can,
  })

  // Меню закрывается кликом мимо него и клавишей Esc.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const assign = useMutation({
    mutationFn: (userId: string | null) => directApi.assign(c.id, userId),
    onSuccess: (fresh, userId) => {
      setOpen(false)
      applyDirectConversation(qc, fresh)
      toast.success(userId ? `Чат ведёт ${fresh.assignee?.name ?? 'другой менеджер'}` : 'Чат освобождён — ответить может любой менеджер продаж')
      // Без вебсокета отметка в ленте сама не придёт.
      if (!isSocketConnected()) onChanged()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не получилось передать чат'),
  })

  const label = assignee ? (mine ? 'Ведёте вы' : `Ведёт: ${assignee.name}`) : 'Свободный чат'
  const hint = assignee ? null : isSalesUser(me) ? 'закрепится за вами, когда ответите' : 'закрепится за менеджером, который ответит первым'
  const others = (managers ?? []).filter(m => m.id !== assignee?.id)

  return (
    <div ref={box} className="relative inline-flex min-w-0 max-w-full items-center gap-1.5">
      <UserIcon size={13} className="shrink-0" aria-hidden />
      <span className={clsx('min-w-0 truncate', assignee && 'font-medium text-surface-700 dark:text-surface-200')}>{label}</span>
      {hint && <span className="hidden min-w-0 truncate text-surface-400 sm:inline">— {hint}</span>}
      {can && (
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-haspopup="menu"
          className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 font-medium text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-500/10 sm:py-0.5">
          {assignee ? 'Передать' : 'Закрепить'} <ChevronDown size={12} aria-hidden />
        </button>
      )}
      {open && (
        <div role="menu" className="absolute left-0 top-full z-30 mt-1 w-[min(17rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-surface-200 bg-white py-1 text-[13px] shadow-lg dark:border-surface-700 dark:bg-surface-800">
          <div className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-surface-400">
            {assignee ? 'Передать менеджеру' : 'Закрепить за менеджером'}
          </div>
          {isLoading ? (
            <div className="px-3 py-2 text-surface-400">Загружаю…</div>
          ) : others.length === 0 ? (
            <div className="px-3 py-2 text-surface-400">Других менеджеров продаж нет</div>
          ) : (
            // Менеджеров много — список прокручивается, «Освободить» остаётся на виду.
            <div className="max-h-[min(50vh,18rem)] overflow-y-auto overscroll-contain">
              {others.map(m => (
                <button key={m.id} type="button" role="menuitem" disabled={assign.isPending} onClick={() => assign.mutate(m.id)}
                  className="block w-full px-3 py-2 text-left hover:bg-surface-50 disabled:opacity-50 dark:hover:bg-surface-700">
                  <span className="block truncate font-medium text-surface-800 dark:text-surface-100">{m.name}</span>
                  {MANAGER_ROLE[m.role] && <span className="block text-[11px] text-surface-400">{MANAGER_ROLE[m.role]}</span>}
                </button>
              ))}
            </div>
          )}
          {assignee && (
            <>
              <div className="my-1 border-t border-surface-100 dark:border-surface-700" />
              <button type="button" role="menuitem" disabled={assign.isPending} onClick={() => assign.mutate(null)}
                className="block w-full px-3 py-2 text-left hover:bg-surface-50 disabled:opacity-50 dark:hover:bg-surface-700">
                <span className="block font-medium text-surface-800 dark:text-surface-100">Освободить чат</span>
                <span className="block text-[11px] text-surface-400">ответить сможет любой менеджер продаж</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

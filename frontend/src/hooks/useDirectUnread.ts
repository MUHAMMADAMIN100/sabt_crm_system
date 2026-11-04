import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth.store'
import { userCan } from '@/lib/permissions'
import { directApi } from '@/services/direct.api'

/** Сколько чатов «Директа» с непрочитанным — число в меню и во вкладке
 *  браузера. Живые изменения приходят по сокету (direct:changed), опрос раз
 *  в минуту — запасной путь. */
export function useDirectUnread(): number {
  const user = useAuthStore(s => s.user)
  const allowed = !!user && !user.vacation && userCan(user, 'clients.view')
  const { data } = useQuery({
    queryKey: ['direct', 'unread'],
    queryFn: directApi.unread,
    enabled: allowed,
    refetchInterval: 60_000,
    staleTime: 15_000,
  })
  const count = allowed ? data?.count ?? 0 : 0

  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\) /, '')
    document.title = count > 0 ? `(${count > 99 ? '99+' : count}) ${base}` : base
  }, [count])

  return count
}

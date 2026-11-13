// «Войти как» (13.11.2026): основатель или администратор открывает кабинет
// сотрудника и видит всё ровно так, как видит он. Свой вход основателя при
// этом не теряется — «Вернуться» возвращает его в собственный аккаунт.
// Правила (кто к кому) проверяет сервер; здесь — только переключение.
import api, { impersonationLocal } from '@/lib/api'
import { queryClient } from '@/lib/queryClient'
import { wipePersistedCache } from '@/lib/persistCache'

/** Полная перезагрузка, а не переход внутри приложения: сокет, кэш запросов,
 *  меню и права должны собраться заново уже для другого человека. */
const reloadTo = (path: string) => {
  wipePersistedCache()
  try { queryClient.clear() } catch { /* ignore */ }
  window.location.assign(path)
}

export async function startImpersonation(target: { userId: string; name: string }, actorName: string) {
  const { data } = await api.post(`/auth/impersonate/${target.userId}`)
  if (!data?.token) throw new Error('Сервер не выдал вход')
  impersonationLocal.begin(
    { targetId: target.userId, targetName: data?.user?.name || target.name, actorName },
    data.token,
  )
  reloadTo('/')
}

export async function stopImpersonation(path = '/employees') {
  // Сначала сервер убирает куку входа (ничего не записывая), потом свои
  // токены — на место. Даже если сервер не ответил, токены вернём: иначе
  // основатель застрял бы в чужом кабинете.
  try { await api.post('/auth/impersonate/stop') } catch { /* ignore */ }
  impersonationLocal.restore()
  try { sessionStorage.setItem('impersonation-message', 'Вы вернулись в свой аккаунт') } catch { /* ignore */ }
  reloadTo(path)
}

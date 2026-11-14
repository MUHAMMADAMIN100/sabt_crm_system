// Пароль клиента приезжает отдельным запросом и только по действию —
// «Показать», «Скопировать» или «Изменить» (решение владельца 14.11.2026),
// а не при каждом открытии карточки проекта.
import { useEffect, useState } from 'react'
import { projectsApi } from '@/services/api.service'

export function useClientPassword(projectId: string) {
  const [password, setPassword] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Другой проект — другой пароль.
  useEffect(() => { setPassword(null) }, [projectId])

  const load = async (): Promise<string> => {
    if (password != null) return password
    setLoading(true)
    try {
      const r = await projectsApi.clientAccessPassword(projectId)
      const pw = String(r?.password ?? '')
      setPassword(pw)
      return pw
    } finally {
      setLoading(false)
    }
  }

  return { password, loading, load, forget: () => setPassword(null) }
}

/** Скопировать текст, который ещё надо загрузить. Safari после await
 *  теряет «нажатие» и не даёт писать в буфер, поэтому сначала пробуем
 *  ClipboardItem с обещанием — его Safari принимает. */
export async function copyLoaded(get: () => Promise<string>): Promise<void> {
  const clip: any = typeof navigator !== 'undefined' ? navigator.clipboard : null
  const Item: any = typeof window !== 'undefined' ? (window as any).ClipboardItem : undefined
  if (clip?.write && Item) {
    try {
      await clip.write([new Item({ 'text/plain': get().then(t => new Blob([t], { type: 'text/plain' })) })])
      return
    } catch { /* ниже — обычный путь */ }
  }
  await clip.writeText(await get())
}

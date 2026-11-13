import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { directApi, type DirectConversation, type DirectReminder } from '@/services/direct.api'
import { applyDirectConversation } from './directCache'

const errorText = (e: any, fallback = 'Не получилось') => e?.response?.data?.message || fallback

/** Мои активные напоминания — общий кэш для списка, шапки и карточки. */
export function useMyReminders() {
  return useQuery({ queryKey: ['direct', 'reminders'], queryFn: directApi.reminders, staleTime: 60_000 })
}

/** Справочник меток. */
export function useLabels() {
  return useQuery({ queryKey: ['direct', 'labels'], queryFn: directApi.labels, staleTime: 5 * 60_000 })
}

/**
 * Действия с чатом: закреп, архив, «непрочитанное», метки, напоминание.
 * Ответ сервера сразу кладём в кэш — строка в списке и шапка меняются без
 * повторного запроса.
 */
export function useChatActions() {
  const qc = useQueryClient()
  const fresh = (c: DirectConversation) => applyDirectConversation(qc, c)

  const pin = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => directApi.pin(id, on),
    onSuccess: (c, v) => { fresh(c); toast.success(v.on ? 'Чат закреплён сверху' : 'Чат откреплён') },
    onError: (e: any) => toast.error(errorText(e)),
  })
  const archive = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => directApi.archive(id, on),
    onSuccess: (c, v) => { fresh(c); toast.success(v.on ? 'Чат в архиве — вернётся сам, когда клиент напишет' : 'Чат возвращён из архива') },
    onError: (e: any) => toast.error(errorText(e)),
  })
  const markUnread = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => directApi.markUnread(id, on),
    onSuccess: (c, v) => { fresh(c); toast.success(v.on ? 'Помечен непрочитанным' : 'Помечен прочитанным') },
    onError: (e: any) => toast.error(errorText(e)),
  })
  const setLabels = useMutation({
    mutationFn: ({ id, labelIds }: { id: string; labelIds: string[] }) => directApi.setLabels(id, labelIds),
    onSuccess: c => fresh(c),
    onError: (e: any) => toast.error(errorText(e, 'Метки не сохранились')),
  })
  const onReminders = (list: DirectReminder[], conversationId: string) => {
    qc.setQueryData(['direct', 'reminders'], list)
    qc.invalidateQueries({ queryKey: ['direct', 'details', conversationId] })
    qc.invalidateQueries({ queryKey: ['direct', 'list'] })
  }
  const setReminder = useMutation({
    mutationFn: ({ id, remindAt, note }: { id: string; remindAt: string; note?: string }) => directApi.setReminder(id, remindAt, note),
    onSuccess: (list, v) => { onReminders(list, v.id); toast.success(`Напомню ${remindLabel(v.remindAt)}`) },
    onError: (e: any) => toast.error(errorText(e, 'Напоминание не поставлено')),
  })
  const removeReminder = useMutation({
    mutationFn: ({ reminderId }: { reminderId: string; conversationId: string }) => directApi.removeReminder(reminderId),
    onSuccess: (list, v) => { onReminders(list, v.conversationId); toast.success('Напоминание снято') },
    onError: (e: any) => toast.error(errorText(e)),
  })
  return { pin, archive, markUnread, setLabels, setReminder, removeReminder }
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** «сегодня в 18:00», «завтра в 10:00», «15 нояб в 10:00». */
export function remindLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (sameDay(d, now)) return `сегодня в ${time}`
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (sameDay(d, tomorrow)) return `завтра в ${time}`
  const date = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }).replace('.', '')
  return `${date} в ${time}`
}

/** Готовые варианты «напомнить»: через час, сегодня вечером, завтра утром, в понедельник. */
export function reminderPresets(now = new Date()): { label: string; at: Date }[] {
  const at = (days: number, hour: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    d.setHours(hour, 0, 0, 0)
    return d
  }
  const list: { label: string; at: Date }[] = [{ label: 'Через час', at: new Date(now.getTime() + 60 * 60 * 1000) }]
  if (now.getHours() < 17) list.push({ label: 'Сегодня в 18:00', at: at(0, 18) })
  list.push({ label: 'Завтра в 10:00', at: at(1, 10) })
  const toMonday = ((8 - now.getDay()) % 7) || 7
  if (toMonday > 1) list.push({ label: 'В понедельник в 10:00', at: at(toMonday, 10) })
  return list
}

/** Значение для <input type="datetime-local"> по часам сотрудника. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

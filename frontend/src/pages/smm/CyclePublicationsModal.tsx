// Окно «Публикации цикла» в «Контроле» (макет владельца 21.10.2026): нажали
// «Отстаёт на N» — видно, что именно не вышло, и это можно закрыть прямо
// отсюда, как задачи в панели СММ: галочка «готово», «На сегодня», перенос,
// отмена, подробности. Галочки ставят SMM-специалист проекта, руководитель
// СММ и руководство; менеджеры по продажам только смотрят.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, differenceInCalendarDays } from 'date-fns'
import { ru } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { Loader2, X } from 'lucide-react'
import { contentPlanApi } from '@/services/api.service'
import { TaskRow, TaskPanel } from '@/pages/dashboard/components/SmmSpecialistDashboard'

type Plan = { done: number; norm: number; expected: number; start: string; end: string }

const dk = (d: Date) => format(d, 'yyyy-MM-dd')
const shortDay = (iso: string) => format(new Date(`${iso}T00:00:00`), 'd MMM', { locale: ru })
const isDone = (e: any) => e.status === 'published'
const isCancelled = (e: any) => e.status === 'cancelled'

/** Раздел окна: заголовок с числом и строки. Пустой не показываем. */
function Section({ title, n, tone, children }: { title: string; n: number; tone?: string; children: React.ReactNode }) {
  if (n === 0) return null
  return (
    <>
      <div className={'text-[11px] font-bold uppercase tracking-wide mt-4 first:mt-0 mb-2 ' + (tone || 'text-surface-400 dark:text-surface-500')}>{title} · {n}</div>
      <div className="space-y-2">{children}</div>
    </>
  )
}

export default function CyclePublicationsModal({ projectId, name, plan, canEdit, onClose }: {
  projectId: string
  name: string
  plan: Plan
  canEdit: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const key = ['smm-calendar', 'cycle', projectId, plan.start, plan.end]
  const { data, isLoading } = useQuery<any>({
    queryKey: key,
    queryFn: () => contentPlanApi.smmCalendar({ from: plan.start, to: plan.end, projectId }),
  })
  const [openId, setOpenId] = useState<string | null>(null)
  const todayKey = dk(new Date())

  const groups = useMemo(() => {
    const pubs = ((data?.events || []) as any[])
      .filter(e => e.projectId === projectId && e.kind === 'publication' && e.contentType !== 'story' && e.date)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)))
    const backlog = ((data?.backlog || []) as any[]).filter(e => e.projectId === projectId && e.kind === 'publication')
    return {
      late: pubs.filter(e => !isDone(e) && !isCancelled(e) && e.date < todayKey),
      ahead: pubs.filter(e => !isDone(e) && !isCancelled(e) && e.date >= todayKey),
      backlog,
      done: pubs.filter(isDone),
      cancelled: pubs.filter(isCancelled),
    }
  }, [data, projectId, todayKey])
  const list = [...groups.late, ...groups.ahead, ...groups.backlog, ...groups.done, ...groups.cancelled]
  const openIdx = openId ? list.findIndex(e => e.id === openId) : -1
  const openEvent = openIdx >= 0 ? list[openIdx] : null

  // Правка — как в панели СММ: кэш меняется сразу, сервер догоняет.
  const patch = (itemId: string, fn: (e: any) => any) => qc.setQueryData<any>(key, (old: any) => old && {
    ...old,
    events: (old.events || []).map((e: any) => (e.itemId === itemId ? fn(e) : e)),
    backlog: (old.backlog || []).map((e: any) => (e.itemId === itemId ? fn(e) : e)),
  })
  // Что-то меняли — «Контроль» и календари пересчитываем один раз, при
  // закрытии окна, а не после каждой галочки: перезапрос посреди быстрых
  // отметок возвращал старое состояние, и галочки «не ставились».
  const dirty = useRef(false)
  useEffect(() => () => {
    if (!dirty.current) return
    qc.invalidateQueries({ queryKey: ['smm-control'] })
    qc.invalidateQueries({ queryKey: ['smm-calendar'] })
  }, [qc])
  const mut = useMutation({
    mutationFn: (v: { itemId: string; body: Record<string, any>; local: (e: any) => any }) => contentPlanApi.smartUpdate(v.itemId, v.body),
    onMutate: async v => {
      await qc.cancelQueries({ queryKey: key })
      const cur: any = qc.getQueryData(key)
      const before = [...(cur?.events || []), ...(cur?.backlog || [])].find((e: any) => e.itemId === v.itemId)
      patch(v.itemId, v.local)
      dirty.current = true
      return { before }
    },
    // Ошибка — возвращаем только эту карточку, соседние отметки не трогаем.
    onError: (e: any, v, ctx: any) => {
      if (ctx?.before) patch(v.itemId, () => ctx.before)
      toast.error(e?.response?.data?.message || 'Не удалось сохранить')
    },
  })
  const toggle = (e: any) => {
    if (!e.itemId || !canEdit) return
    const next = isDone(e) ? 'planned' : 'published'
    mut.mutate({ itemId: e.itemId, body: { status: next }, local: x => ({ ...x, status: next }) })
  }
  const moveTo = (e: any, d: Date) => {
    if (!e.itemId || !canEdit) return
    const date = dk(d)
    // Из «Не запланировано» карточка уходит в календарь: в окне цикла она
    // появится после обновления, если день попал в цикл.
    mut.mutate({ itemId: e.itemId, body: { publishDate: date, status: 'planned' }, local: x => ({ ...x, date, status: 'planned' }) })
  }
  const setCancelled = (e: any, cancel: boolean) => {
    if (!e.itemId || !canEdit) return
    const next = cancel ? 'cancelled' : 'planned'
    mut.mutate({ itemId: e.itemId, body: { status: next }, local: x => ({ ...x, status: next }) })
  }

  // Esc закрывает окно (если поверх не открыта задача); страница под окном не листается.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && !openId) onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [openId, onClose])

  const lag = Math.max(0, plan.expected - plan.done)
  const lateDays = (e: any) => Math.max(1, differenceInCalendarDays(new Date(`${todayKey}T00:00:00`), new Date(`${e.date}T00:00:00`)))
  const row = (e: any, extra?: { late?: number; note?: React.ReactNode }) => (
    <TaskRow key={e.id} e={e} readOnly={!canEdit}
      onToggle={() => toggle(e)} onInfo={() => setOpenId(e.id)}
      onMove={canEdit ? d => moveTo(e, d) : undefined} onCancel={canEdit ? c => setCancelled(e, c) : undefined}
      late={extra?.late} note={extra?.note} />
  )
  const dateNote = (e: any) => <span className="text-[11px] text-surface-400 dark:text-surface-500">выход {shortDay(e.date)}</span>

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div role="dialog" aria-label={`${name} — публикации цикла`}
        className="relative w-full sm:max-w-2xl max-h-[88vh] sm:max-h-[85vh] flex flex-col bg-white dark:bg-surface-900 rounded-t-[22px] sm:rounded-2xl sm:border border-surface-200 dark:border-surface-700 shadow-2xl">
        <div className="sm:hidden pt-2 pb-1"><div className="w-10 h-[5px] rounded-full bg-surface-300 dark:bg-surface-600 mx-auto" /></div>
        <div className="px-4 sm:px-5 pt-3 sm:pt-4 pb-3 space-y-2">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-base font-bold text-surface-900 dark:text-surface-100 truncate">{name}</h2>
            <span className="text-xs text-surface-400 dark:text-surface-500 whitespace-nowrap">цикл {shortDay(plan.start)} – {shortDay(plan.end)}</span>
            <button onClick={onClose} title="Закрыть" aria-label="Закрыть"
              className="ml-auto w-8 h-8 shrink-0 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 flex items-center justify-center self-center"><X size={15} /></button>
          </div>
          <p className="text-[13px]">
            <b className={lag === 0 ? 'text-green-600 dark:text-green-400' : lag === 1 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}>
              {lag === 0 ? 'По плану' : `Отстаёт на ${lag}`}
            </b>
            <span className="text-surface-500 dark:text-surface-400"> · вышло {plan.done} из {plan.norm} · к сегодня должно быть {plan.expected}</span>
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain border-t border-surface-100 dark:border-surface-800 px-4 sm:px-5 py-3.5 pb-[max(14px,env(safe-area-inset-bottom))]">
          {isLoading ? (
            <p className="py-8 flex justify-center"><Loader2 className="animate-spin text-surface-400" /></p>
          ) : list.length === 0 ? (
            <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-6">В этом цикле публикаций нет</p>
          ) : (
            <>
              <Section title="Просрочено" n={groups.late.length} tone="text-red-500 dark:text-red-400">
                {groups.late.map(e => row(e, { late: lateDays(e) }))}
              </Section>
              <Section title="Впереди" n={groups.ahead.length}>
                {groups.ahead.map(e => row(e, { note: dateNote(e) }))}
              </Section>
              <Section title="Не запланировано" n={groups.backlog.length}>
                {groups.backlog.map(e => row(e, { note: <span className="text-[11px] text-surface-400 dark:text-surface-500">дня нет</span> }))}
              </Section>
              <Section title="Вышло" n={groups.done.length} tone="text-green-600 dark:text-green-400">
                {groups.done.map(e => row(e, { note: dateNote(e) }))}
              </Section>
              <Section title="Отменено" n={groups.cancelled.length}>
                {groups.cancelled.map(e => row(e))}
              </Section>
            </>
          )}
        </div>
      </div>

      {openEvent && (
        <TaskPanel e={openEvent} pos={openIdx + 1} total={list.length} readOnly={!canEdit}
          onPrev={() => { if (openIdx > 0) setOpenId(list[openIdx - 1].id) }}
          onNext={() => { if (openIdx < list.length - 1) setOpenId(list[openIdx + 1].id) }}
          onClose={() => setOpenId(null)}
          onToggle={() => toggle(openEvent)}
          onMove={d => { moveTo(openEvent, d); toast.success(`Перенесено на ${format(d, 'd MMMM', { locale: ru })}`) }}
          onCancel={c => { setCancelled(openEvent, c); toast.success(c ? 'Задача отменена' : 'Задача возвращена в работу') }} />
      )}
    </div>,
    document.body,
  )
}

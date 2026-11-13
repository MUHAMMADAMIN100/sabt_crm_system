import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import {
  Archive, ArchiveRestore, BellRing, Check, ChevronLeft, Mail, MailOpen, PanelRight, Pin, PinOff, Settings2, Tag,
} from 'lucide-react'
import type { DirectConversation } from '@/services/direct.api'
import { useAuthStore } from '@/store/auth.store'
import { canReplyIn, isTopUser } from './directAccess'
import { remindLabel, reminderPresets, toLocalInput, useChatActions, useLabels, useMyReminders } from './chatActions'
import { labelColor } from './labelColors'
import LabelsManager from './LabelsManager'

/** Где открыть меню: под кнопкой или там, где щёлкнули правой кнопкой.
 *  above — нижний край меню, если внизу не хватает места (над кнопкой). */
export type MenuAnchor = { x: number; y: number; alignRight?: boolean; above?: number }

export const anchorOf = (el: HTMLElement): MenuAnchor => {
  const r = el.getBoundingClientRect()
  return { x: r.right, y: r.bottom + 4, alignRight: true, above: r.top - 4 }
}

/**
 * Всплывающее меню поверх страницы: не обрезается краем списка, у нижнего
 * края экрана открывается вверх. Esc и щелчок мимо закрывают.
 */
export function FloatingMenu({ anchor, onClose, children, width = 260, label }: {
  anchor: MenuAnchor
  onClose: () => void
  children: ReactNode
  width?: number
  label: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Место считаем по размеру меню; меню меняет высоту (страница «Метки»,
  // «Напомнить») — пересчитываем.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const place = () => {
      const h = el.offsetHeight
      const vw = window.innerWidth
      const vh = window.innerHeight
      const w = Math.min(width, vw - 16)
      const left = Math.max(8, Math.min(anchor.alignRight ? anchor.x - w : anchor.x, vw - w - 8))
      let top = anchor.y
      if (top + h > vh - 8) top = (anchor.above ?? anchor.y) - h
      top = Math.max(8, Math.min(top, vh - h - 8))
      setPos(p => (p && p.left === left && p.top === top ? p : { left, top }))
    }
    place()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [anchor.x, anchor.y, anchor.alignRight, anchor.above, width])

  useEffect(() => {
    const onDown = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }
    // Закрываемся, когда человек сам листает (палец, колёсико), а не от
    // прокрутки, которую делает страница: лента докручивается, пока грузятся
    // фото, — меню исчезало сразу после нажатия.
    const onUserScroll = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) onClose() }
    const t = setTimeout(() => {
      document.addEventListener('pointerdown', onDown)
      document.addEventListener('wheel', onUserScroll, { capture: true, passive: true })
      document.addEventListener('touchmove', onUserScroll, { capture: true, passive: true })
    }, 0)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onClose)
    return () => {
      clearTimeout(t)
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('wheel', onUserScroll, { capture: true })
      document.removeEventListener('touchmove', onUserScroll, { capture: true })
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return createPortal(
    <div ref={box} role="menu" aria-label={label}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: `min(${width}px, calc(100vw - 16px))` }}
      className="fixed z-[80] max-h-[80vh] overflow-y-auto rounded-xl border border-surface-200 bg-white py-1 shadow-modal dark:border-surface-600 dark:bg-surface-800">
      {children}
    </div>,
    document.body,
  )
}

export function MenuItem({ icon, children, onClick, disabled, hint }: { icon: ReactNode; children: ReactNode; onClick: () => void; disabled?: boolean; hint?: string }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} disabled={disabled} title={hint}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-surface-800 hover:bg-surface-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-surface-100 dark:hover:bg-surface-700">
      <span className="flex w-4 shrink-0 justify-center text-surface-500">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  )
}

/** Напомнить о клиенте: готовые варианты или своё время, необязательная пометка. */
export function ReminderForm({ onSubmit, busy, compact }: { onSubmit: (at: Date, note: string) => void; busy?: boolean; compact?: boolean }) {
  const [note, setNote] = useState('')
  const [custom, setCustom] = useState(() => {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000)
    d.setHours(10, 0, 0, 0)
    return toLocalInput(d)
  })
  const presets = reminderPresets()
  const customDate = custom ? new Date(custom) : null
  const customOk = !!customDate && !Number.isNaN(customDate.getTime()) && customDate.getTime() > Date.now()
  return (
    <div className={clsx('space-y-2', compact ? 'px-3 py-2' : '')}>
      <input value={note} onChange={e => setNote(e.target.value)} maxLength={300}
        placeholder="О чём напомнить (необязательно)" aria-label="О чём напомнить"
        className="input !min-h-[32px] !py-1 !text-[13px]" />
      <div className="grid grid-cols-2 gap-1.5">
        {presets.map(p => (
          <button key={p.label} type="button" disabled={busy} onClick={() => onSubmit(p.at, note)}
            className="rounded-lg border border-surface-200 px-2 py-1.5 text-left text-[12.5px] text-surface-700 hover:border-primary-400 hover:bg-primary-50 disabled:opacity-50 dark:border-surface-600 dark:text-surface-200 dark:hover:bg-primary-500/10">
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input type="datetime-local" value={custom} onChange={e => setCustom(e.target.value)} min={toLocalInput(new Date())}
          aria-label="Своё время напоминания" className="input !min-h-[32px] min-w-0 flex-1 !py-1 !text-[13px]" />
        <button type="button" className="btn-primary !min-h-[32px] shrink-0 !px-2.5 !py-1 text-xs" disabled={busy || !customOk}
          onClick={() => customDate && onSubmit(customDate, note)}>
          Напомнить
        </button>
      </div>
    </div>
  )
}

/** Метки чата галочками; руководству — «Управлять метками». */
export function LabelsPicker({ selected, onToggle, busy, onManage }: {
  selected: string[]
  onToggle: (labelId: string) => void
  busy?: boolean
  onManage?: () => void
}) {
  const { data: labels, isLoading } = useLabels()
  return (
    <div className="py-1">
      {isLoading ? <p className="px-3 py-2 text-[13px] text-surface-500">Загружаю…</p>
        : !labels?.length ? (
          <p className="px-3 py-2 text-[13px] text-surface-500">{onManage ? 'Меток пока нет — создайте первую.' : 'Меток пока нет — их заводит руководство.'}</p>
        ) : labels.map(l => {
          const on = selected.includes(l.id)
          return (
            <button key={l.id} type="button" role="menuitemcheckbox" aria-checked={on} disabled={busy} onClick={() => onToggle(l.id)}
              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13.5px] hover:bg-surface-100 disabled:opacity-60 dark:hover:bg-surface-700">
              <span className={clsx('h-2.5 w-2.5 shrink-0 rounded-full', labelColor(l.color).dot)} />
              <span className="min-w-0 flex-1 truncate text-surface-800 dark:text-surface-100">{l.name}</span>
              {on && <Check size={15} className="shrink-0 text-primary-600 dark:text-primary-300" />}
            </button>
          )
        })}
      {onManage && (
        <button type="button" onClick={onManage}
          className="mt-1 flex w-full items-center gap-2.5 border-t border-surface-100 px-3 py-2 text-left text-[13px] text-surface-600 hover:bg-surface-100 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-700">
          <Settings2 size={14} /> Управлять метками
        </button>
      )}
    </div>
  )
}

/**
 * Меню чата — в шапке переписки и у строки списка: закрепить, пометить
 * непрочитанным, метки, напомнить, в архив. Менять общее (закреп, архив,
 * метки, «непрочитанное») может тот, кто вправе отвечать в чате.
 */
export default function ChatMenu({ c, anchor, onClose, onMarkedUnread, onOpenCard, start = 'main' }: {
  c: DirectConversation
  anchor: MenuAnchor
  onClose: () => void
  /** Чат пометили непрочитанным — открытый чат закрываем, иначе отметка сразу снимется. */
  onMarkedUnread?: () => void
  /** Узкий экран: открыть карточку клиента. */
  onOpenCard?: () => void
  start?: 'main' | 'labels' | 'reminder'
}) {
  const user = useAuthStore(s => s.user)
  const can = canReplyIn(user, c.assignee?.id)
  const top = isTopUser(user)
  const actions = useChatActions()
  const { data: reminders } = useMyReminders()
  const mine = reminders?.find(r => r.conversationId === c.id) ?? null
  const [page, setPage] = useState<'main' | 'labels' | 'reminder'>(start)
  const [labelIds, setLabelIds] = useState(c.labels.map(l => l.id))
  const [manage, setManage] = useState(false)
  useEffect(() => { setLabelIds(c.labels.map(l => l.id)) }, [c.labels])
  const unread = c.unreadCount > 0 || c.markedUnread

  const back = (
    <button type="button" onClick={() => setPage('main')} className="flex w-full items-center gap-1.5 border-b border-surface-100 px-3 py-2 text-left text-[12.5px] font-medium text-surface-600 hover:bg-surface-50 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-700/50">
      <ChevronLeft size={15} /> {page === 'labels' ? 'Метки' : 'Напомнить о клиенте'}
    </button>
  )

  if (manage) return <LabelsManager onClose={() => { setManage(false); onClose() }} />

  return (
    <FloatingMenu anchor={anchor} onClose={onClose} label={`Действия с чатом ${c.contact.label}`} width={page === 'main' ? 250 : 290}>
      {page === 'labels' ? (
        <>
          {back}
          <LabelsPicker selected={labelIds} busy={actions.setLabels.isPending}
            onManage={top ? () => setManage(true) : undefined}
            onToggle={id => {
              const next = labelIds.includes(id) ? labelIds.filter(x => x !== id) : [...labelIds, id]
              setLabelIds(next)
              actions.setLabels.mutate({ id: c.id, labelIds: next }, { onError: () => setLabelIds(c.labels.map(l => l.id)) })
            }} />
        </>
      ) : page === 'reminder' ? (
        <>
          {back}
          {mine && (
            <div className="flex items-center gap-2 border-b border-surface-100 px-3 py-2 text-[12.5px] dark:border-surface-700">
              <BellRing size={14} className="shrink-0 text-amber-600" />
              <span className="min-w-0 flex-1">Уже стоит: {remindLabel(mine.remindAt)}{mine.note ? ` · ${mine.note}` : ''}</span>
              <button type="button" className="shrink-0 font-medium text-surface-600 hover:underline dark:text-surface-300"
                onClick={() => actions.removeReminder.mutate({ reminderId: mine.id, conversationId: c.id }, { onSuccess: onClose })}>
                Снять
              </button>
            </div>
          )}
          <ReminderForm compact busy={actions.setReminder.isPending}
            onSubmit={(at, note) => actions.setReminder.mutate({ id: c.id, remindAt: at.toISOString(), note }, { onSuccess: onClose })} />
        </>
      ) : (
        <>
          {onOpenCard && <MenuItem icon={<PanelRight size={15} />} onClick={() => { onClose(); onOpenCard() }}>Карточка клиента</MenuItem>}
          {can && (
            <MenuItem icon={c.pinned ? <PinOff size={15} /> : <Pin size={15} />}
              onClick={() => { actions.pin.mutate({ id: c.id, on: !c.pinned }); onClose() }}>
              {c.pinned ? 'Открепить' : 'Закрепить сверху'}
            </MenuItem>
          )}
          {can && (
            <MenuItem icon={unread ? <MailOpen size={15} /> : <Mail size={15} />}
              onClick={() => {
                actions.markUnread.mutate({ id: c.id, on: !unread })
                if (!unread) onMarkedUnread?.()
                onClose()
              }}>
              {unread ? 'Пометить прочитанным' : 'Пометить непрочитанным'}
            </MenuItem>
          )}
          {can && <MenuItem icon={<Tag size={15} />} onClick={() => setPage('labels')}>Метки…</MenuItem>}
          <MenuItem icon={<BellRing size={15} />} onClick={() => setPage('reminder')}>
            {mine ? `Напоминание: ${remindLabel(mine.remindAt)}` : 'Напомнить о клиенте…'}
          </MenuItem>
          {can && (
            <MenuItem icon={c.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
              onClick={() => { actions.archive.mutate({ id: c.id, on: !c.archived }); onClose() }}>
              {c.archived ? 'Вернуть из архива' : 'В архив'}
            </MenuItem>
          )}
          {!can && (
            <p className="border-t border-surface-100 px-3 py-2 text-[12px] leading-snug text-surface-500 dark:border-surface-700">
              Закреп, метки и архив меняет {c.assignee?.name || 'тот, кто ведёт чат'} или руководство.
            </p>
          )}
        </>
      )}
    </FloatingMenu>
  )
}

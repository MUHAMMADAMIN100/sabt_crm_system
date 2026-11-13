import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  Archive, ArchiveRestore, BellRing, Contact, ExternalLink, FileText, Mail, Phone, Pin, PinOff, Play, Plus, StickyNote, Tag, UserPlus, X,
} from 'lucide-react'
import { apiUrl, directApi, type DirectConversation, type DirectDetails } from '@/services/direct.api'
import { Spinner } from '@/components/ui'
import { useAuthStore } from '@/store/auth.store'
import ContactAvatar from './ContactAvatar'
import AssigneeControl from './AssigneeControl'
import { LabelsPicker, ReminderForm } from './ChatMenu'
import LabelsManager from './LabelsManager'
import { canReplyIn, isTopUser } from './directAccess'
import { remindLabel, useChatActions } from './chatActions'
import { labelColor } from './labelColors'
import { clockTime, dayLabel } from './directTime'
import type { LightboxItem } from './Lightbox'

export const LEAD_STATUS: Record<string, string> = {
  new: 'Новый', waiting: 'Ожидание ответа', negotiating: 'В переговорах', proposal: 'КП отправлено',
  won: 'Клиент', lost: 'Отказ', on_hold: 'На паузе', unknown: 'Неизвестно',
}

const formatSize = (bytes: number | null) => {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`
}

/**
 * Карточка клиента справа от переписки: лид и контакты, кто ведёт, метки,
 * напоминания, закреп и архив, фото и файлы чата, заметки команды.
 */
export default function ChatSidePanel({ c, onClose, onJump, onOpenGallery, onCreateLead, canCreateLead, onRefresh }: {
  c: DirectConversation
  onClose: () => void
  /** К сообщению в ленте (файл, заметка). */
  onJump: (messageId: string) => void
  onOpenGallery: (items: LightboxItem[], index: number) => void
  onCreateLead: () => void
  canCreateLead: boolean
  onRefresh: () => void
}) {
  const user = useAuthStore(s => s.user)
  const can = canReplyIn(user, c.assignee?.id)
  const top = isTopUser(user)
  const actions = useChatActions()
  const [editLabels, setEditLabels] = useState(false)
  const [manageLabels, setManageLabels] = useState(false)
  const [remind, setRemind] = useState(false)
  const [allMedia, setAllMedia] = useState(false)
  const details = useQuery({ queryKey: ['direct', 'details', c.id], queryFn: () => directApi.details(c.id), staleTime: 15_000 })
  const d: DirectDetails | undefined = details.data
  const [labelIds, setLabelIds] = useState<string[] | null>(null)
  const selected = labelIds ?? c.labels.map(l => l.id)

  const gallery: LightboxItem[] = (d?.media ?? []).map(m => ({
    id: m.id, url: m.url, video: (m.mimeType || '').startsWith('video/'),
    caption: `${dayLabel(m.sentAt)} · ${clockTime(m.sentAt)}`,
  }))
  const media = allMedia ? gallery : gallery.slice(0, 9)
  const myReminder = d?.reminders.find(r => r.mine) ?? null

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-surface-900">
      <div className="flex items-center gap-2 border-b border-surface-200 px-3 py-2.5 dark:border-surface-700">
        <span className="min-w-0 flex-1 text-[13px] font-semibold text-surface-700 dark:text-surface-200">О клиенте</span>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700" aria-label="Скрыть карточку клиента" title="Скрыть">
          <X size={17} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Кто это */}
        <div className="flex flex-col items-center gap-1.5 px-4 pb-3 pt-4 text-center">
          <ContactAvatar label={c.contact.label} picture={c.contact.picture} size={64} />
          <div className="max-w-full truncate text-[15px] font-semibold text-surface-900 dark:text-white">{c.contact.label}</div>
          {c.contact.username && (
            <a href={`https://www.instagram.com/${c.contact.username}/`} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12.5px] text-surface-500 hover:text-surface-800 dark:hover:text-surface-200">
              @{c.contact.username} <ExternalLink size={11} />
            </a>
          )}
          <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
            {can && (
              <PanelButton onClick={() => actions.pin.mutate({ id: c.id, on: !c.pinned })} active={c.pinned}
                icon={c.pinned ? <PinOff size={14} /> : <Pin size={14} />}>{c.pinned ? 'Открепить' : 'Закрепить'}</PanelButton>
            )}
            <PanelButton onClick={() => setRemind(v => !v)} active={remind || !!myReminder} icon={<BellRing size={14} />}>Напомнить</PanelButton>
            {can && (
              <PanelButton onClick={() => actions.archive.mutate({ id: c.id, on: !c.archived })} active={!!c.archived}
                icon={c.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}>{c.archived ? 'Из архива' : 'В архив'}</PanelButton>
            )}
          </div>
        </div>

        {/* Напоминания */}
        {(remind || (d?.reminders.length ?? 0) > 0) && (
          <Section title="Напоминания" icon={<BellRing size={13} />}>
            {d?.reminders.map(r => (
              <div key={r.id} className={clsx('mb-1.5 flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px]',
                r.fired ? 'bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200' : 'bg-surface-50 text-surface-700 dark:bg-surface-800 dark:text-surface-200')}>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{r.fired ? 'Пора: ' : ''}{remindLabel(r.remindAt)}{r.mine ? '' : ` · ${r.user.name}`}</div>
                  {r.note && <div className="break-words opacity-80">{r.note}</div>}
                </div>
                {r.mine && (
                  <button type="button" className="shrink-0 rounded px-1 text-[12px] font-medium hover:underline"
                    onClick={() => actions.removeReminder.mutate({ reminderId: r.id, conversationId: c.id })}>
                    {r.fired ? 'Готово' : 'Снять'}
                  </button>
                )}
              </div>
            ))}
            {remind ? (
              <div className="rounded-lg border border-surface-200 p-2 dark:border-surface-700">
                <ReminderForm busy={actions.setReminder.isPending}
                  onSubmit={(at, note) => actions.setReminder.mutate({ id: c.id, remindAt: at.toISOString(), note }, { onSuccess: () => setRemind(false) })} />
                {myReminder && <p className="mt-1.5 text-[11.5px] text-surface-500">Новое напоминание заменит ваше прежнее в этом чате.</p>}
              </div>
            ) : (
              <button type="button" onClick={() => setRemind(true)} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-primary-700 hover:underline dark:text-primary-300">
                <Plus size={13} /> Напомнить мне
              </button>
            )}
          </Section>
        )}

        {/* Лид */}
        <Section title="Лид" icon={<Contact size={13} />}>
          {details.isLoading ? <Spinner /> : d?.lead ? (
            <div className="space-y-1.5 text-[13px]">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium text-surface-900 dark:text-white">{d.lead.name}</span>
                <span className="shrink-0 rounded-full bg-surface-100 px-2 py-0.5 text-[11px] font-medium text-surface-600 dark:bg-surface-700 dark:text-surface-300">
                  {LEAD_STATUS[d.lead.status] || d.lead.status}
                </span>
              </div>
              {d.lead.contactPerson && d.lead.contactPerson !== d.lead.name && <Field label="Контакт">{d.lead.contactPerson}</Field>}
              {d.lead.phone && <Field label="Телефон"><a href={`tel:${d.lead.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 text-primary-700 hover:underline dark:text-primary-300"><Phone size={12} /> {d.lead.phone}</a></Field>}
              {d.lead.email && <Field label="Почта"><a href={`mailto:${d.lead.email}`} className="inline-flex items-center gap-1 break-all text-primary-700 hover:underline dark:text-primary-300"><Mail size={12} /> {d.lead.email}</a></Field>}
              {d.lead.sphere && <Field label="Сфера">{d.lead.sphere}</Field>}
              {d.lead.nextStep && <Field label="Следующий шаг">{d.lead.nextStep}</Field>}
              {d.lead.nextContactAt && <Field label="Связаться">{new Date(d.lead.nextContactAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</Field>}
              {d.lead.owner && <Field label="Ответственный">{d.lead.owner.name}</Field>}
              <Link to={`/clients?id=${d.lead.id}`} className="btn-secondary mt-1 w-full justify-center !py-1.5 text-xs">
                <Contact size={13} /> Открыть карточку в Базе клиентов
              </Link>
            </div>
          ) : (
            <div className="space-y-2 text-[13px] text-surface-500">
              <p>Лид из этого чата ещё не создан.</p>
              {canCreateLead && can && (
                <button type="button" onClick={onCreateLead} className="btn-secondary w-full justify-center !py-1.5 text-xs"><UserPlus size={13} /> Создать лид</button>
              )}
            </div>
          )}
        </Section>

        {/* Кто ведёт */}
        <Section title="Кто ведёт">
          <div className="text-[12.5px] text-surface-600 dark:text-surface-300"><AssigneeControl c={c} me={user} onChanged={onRefresh} wrap /></div>
        </Section>

        {/* Метки */}
        <Section title="Метки" icon={<Tag size={13} />}
          action={can ? (
            <button type="button" onClick={() => setEditLabels(v => !v)} className="text-[12px] font-medium text-primary-700 hover:underline dark:text-primary-300">
              {editLabels ? 'Готово' : 'Изменить'}
            </button>
          ) : null}>
          {editLabels ? (
            <div className="-mx-3 rounded-lg border border-surface-200 dark:border-surface-700">
              <LabelsPicker selected={selected} busy={actions.setLabels.isPending}
                onManage={top ? () => setManageLabels(true) : undefined}
                onToggle={id => {
                  const next = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]
                  setLabelIds(next)
                  actions.setLabels.mutate({ id: c.id, labelIds: next }, { onSettled: () => setLabelIds(null) })
                }} />
            </div>
          ) : c.labels.length ? (
            <div className="flex flex-wrap gap-1.5">
              {c.labels.map(l => (
                <span key={l.id} className={clsx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium', labelColor(l.color).chip)}>
                  <span className={clsx('h-1.5 w-1.5 rounded-full', labelColor(l.color).dot)} /> {l.name}
                </span>
              ))}
            </div>
          ) : <p className="text-[12.5px] text-surface-400">Меток нет</p>}
        </Section>

        {/* Фото и видео */}
        {gallery.length > 0 && (
          <Section title={`Фото и видео · ${gallery.length}`}>
            <div className="grid grid-cols-3 gap-1">
              {media.map((m, i) => (
                <button key={m.id} type="button" onClick={() => onOpenGallery(gallery, i)}
                  className="relative aspect-square overflow-hidden rounded-md bg-surface-100 dark:bg-surface-800" aria-label="Открыть на весь экран">
                  {m.video
                    ? <><video src={apiUrl(m.url) || ''} preload="metadata" muted className="h-full w-full object-cover" /><Play size={18} className="absolute inset-0 m-auto text-white drop-shadow" /></>
                    : <img src={apiUrl(m.url) || ''} alt="" loading="lazy" className="h-full w-full object-cover" />}
                </button>
              ))}
            </div>
            {gallery.length > 9 && (
              <button type="button" onClick={() => setAllMedia(v => !v)} className="mt-1.5 text-[12px] font-medium text-primary-700 hover:underline dark:text-primary-300">
                {allMedia ? 'Свернуть' : `Показать все (${gallery.length})`}
              </button>
            )}
          </Section>
        )}

        {/* Файлы */}
        {(d?.files.length ?? 0) > 0 && (
          <Section title="Файлы" icon={<FileText size={13} />}>
            <ul className="space-y-1">
              {d!.files.map(f => (
                <li key={f.id} className="flex items-center gap-2">
                  <a href={apiUrl(f.url) || '#'} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-surface-50 dark:hover:bg-surface-800">
                    <FileText size={16} className="shrink-0 text-surface-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-surface-800 dark:text-surface-100">{f.name || 'Документ'}</span>
                      <span className="block text-[11px] text-surface-400">{formatSize(f.size)} · {dayLabel(f.sentAt)}</span>
                    </span>
                  </a>
                  <button type="button" onClick={() => onJump(f.messageId)} className="shrink-0 rounded px-1 text-[11.5px] text-surface-500 hover:text-surface-800 hover:underline dark:hover:text-surface-200">в чате</button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Заметки */}
        <Section title="Заметки команды" icon={<StickyNote size={13} />}>
          {d?.notes.length ? (
            <ul className="space-y-1.5">
              {d.notes.map(n => (
                <li key={n.id}>
                  <button type="button" onClick={() => onJump(n.id)} className="block w-full rounded-lg bg-amber-50 px-2.5 py-1.5 text-left hover:bg-amber-100 dark:bg-amber-500/10 dark:hover:bg-amber-500/15">
                    <span className="block text-[11px] font-medium text-amber-800 dark:text-amber-300">{n.author?.name || 'Сотрудник'} · {dayLabel(n.sentAt)} {clockTime(n.sentAt)}</span>
                    <span className="line-clamp-3 whitespace-pre-wrap break-words text-[12.5px] text-surface-700 dark:text-surface-200">{n.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-[12.5px] text-surface-400">Заметок нет. Их видит только команда.</p>}
        </Section>
      </div>
      {manageLabels && <LabelsManager onClose={() => setManageLabels(false)} />}
    </div>
  )
}

function Section({ title, icon, action, children }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-surface-100 px-4 py-3 dark:border-surface-800">
      <div className="mb-2 flex items-center gap-1.5">
        {icon && <span className="text-surface-400">{icon}</span>}
        <h3 className="min-w-0 flex-1 text-[11.5px] font-semibold uppercase tracking-wide text-surface-500">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 text-[12.5px]">
      <span className="w-[92px] shrink-0 text-surface-400">{label}</span>
      <span className="min-w-0 flex-1 break-words text-surface-700 dark:text-surface-200">{children}</span>
    </div>
  )
}

function PanelButton({ icon, children, onClick, active }: { icon: ReactNode; children: ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors',
        active ? 'border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-500/40 dark:bg-primary-500/15 dark:text-primary-200'
          : 'border-surface-200 text-surface-600 hover:bg-surface-100 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-800')}>
      {icon} {children}
    </button>
  )
}

import { useState } from 'react'
import toast from 'react-hot-toast'
import { Copy, Instagram, Mail, Phone } from 'lucide-react'
import type { SalesLead } from '@/types/sales'
import { useLeadUpdate } from '../salesHooks'
import { contactInfoOf, instagramHandle, phoneHref } from '../leadUtils'
import Section, { Field, LinkButton } from './Section'

/** «Контакты» (15.11.2026): ЛПР, телефон (позвонить одним касанием и
 *  скопировать), Instagram, почта. */
export default function LeadContacts({ lead, canAct }: { lead: SalesLead; canAct: boolean }) {
  const [editing, setEditing] = useState(false)
  const ig = instagramHandle(lead.contactInstagram)
  const empty = !lead.contactPerson && !lead.contactPhone && !ig && !lead.contactEmail

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.success('Телефон скопирован'),
      () => toast.error('Не удалось скопировать'),
    )
  }

  return (
    <Section
      title="Контакты"
      action={canAct && !editing ? <LinkButton onClick={() => setEditing(true)}>{empty ? 'Добавить' : 'Изменить'}</LinkButton> : undefined}
    >
      {editing ? (
        <ContactsForm lead={lead} onDone={() => setEditing(false)} />
      ) : empty ? (
        <p className="text-sm text-surface-500 dark:text-surface-400">
          {lead.contactInfo ? <span className="whitespace-pre-line">{lead.contactInfo}</span> : 'Контакты не указаны'}
        </p>
      ) : (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {lead.contactPerson && <Field label="ЛПР">{lead.contactPerson}</Field>}
          {lead.contactPhone && (
            <Field label="Телефон">
              <span className="inline-flex items-center gap-1">
                <a href={phoneHref(lead.contactPhone)}
                  className="inline-flex min-h-[36px] items-center gap-1.5 font-medium text-primary-700 hover:underline dark:text-primary-300 max-lg:min-h-[44px]">
                  <Phone size={14} aria-hidden="true" /> {lead.contactPhone}
                </a>
                <button type="button" onClick={() => copy(lead.contactPhone!)} aria-label="Скопировать телефон" title="Скопировать"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 max-lg:h-11 max-lg:w-11">
                  <Copy size={14} aria-hidden="true" />
                </button>
              </span>
            </Field>
          )}
          {ig && (
            <Field label="Instagram">
              <a href={`https://instagram.com/${encodeURIComponent(ig)}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex min-h-[36px] items-center gap-1.5 font-medium text-primary-700 hover:underline dark:text-primary-300 max-lg:min-h-[44px]">
                <Instagram size={14} aria-hidden="true" /> @{ig}
              </a>
            </Field>
          )}
          {lead.contactEmail && (
            <Field label="Email">
              <a href={`mailto:${lead.contactEmail}`}
                className="inline-flex min-h-[36px] items-center gap-1.5 break-all font-medium text-primary-700 hover:underline dark:text-primary-300 max-lg:min-h-[44px]">
                <Mail size={14} aria-hidden="true" /> {lead.contactEmail}
              </a>
            </Field>
          )}
        </dl>
      )}
    </Section>
  )
}

function ContactsForm({ lead, onDone }: { lead: SalesLead; onDone: () => void }) {
  const [person, setPerson] = useState(lead.contactPerson || '')
  const [phone, setPhone] = useState(lead.contactPhone || '')
  const [ig, setIg] = useState(lead.contactInstagram || '')
  const [email, setEmail] = useState(lead.contactEmail || '')
  const update = useLeadUpdate()
  const id = `contacts-${lead.id}`
  const t = (v: string) => v.trim() || null

  const save = () => {
    const data = { contactPerson: t(person), contactPhone: t(phone), contactInstagram: t(ig), contactEmail: t(email) }
    update.mutate({ id: lead.id, data: { ...data, contactInfo: contactInfoOf(data) } }, {
      onSuccess: () => { toast.success('Контакты сохранены'); onDone() },
    })
  }

  return (
    <form onSubmit={e => { e.preventDefault(); save() }} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-person`} className="label">ЛПР</label>
          <input id={`${id}-person`} className="input" value={person} onChange={e => setPerson(e.target.value)} placeholder="Иван — директор" />
        </div>
        <div>
          <label htmlFor={`${id}-phone`} className="label">Телефон</label>
          <input id={`${id}-phone`} type="tel" inputMode="tel" className="input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+992 900 00 00 00" />
        </div>
        <div>
          <label htmlFor={`${id}-ig`} className="label">Instagram</label>
          <input id={`${id}-ig`} className="input" value={ig} onChange={e => setIg(e.target.value)} placeholder="@instagram" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-email`} className="label">Email</label>
          <input id={`${id}-email`} type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@domain.com" />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={update.isPending} className="btn-primary min-h-[44px]">
          {update.isPending ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button type="button" onClick={onDone} className="btn-ghost min-h-[44px]">Отмена</button>
      </div>
    </form>
  )
}

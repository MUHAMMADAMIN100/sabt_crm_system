import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ChevronDown } from 'lucide-react'
import { Modal } from '@/components/ui'
import { leadsApi, duplicatesOf } from '@/services/sales.api'
import { useAuthStore } from '@/store/auth.store'
import { FUNNEL_STAGES, ACTIVE_STATUSES } from '@/lib/salesStages'
import type { LeadDirection, LeadInterest, LeadStatus, SalesLead } from '@/types/sales'
import { afterLeadChange } from './salesHooks'
import {
  CHANNEL_OPTIONS, DIRECTION_LABEL, SOURCE_OPTIONS, SPHERE_SUGGESTIONS,
  contactInfoOf, daysFromNow, dateInput, errorText, isTopRole, joinLocal, splitLocal,
} from './leadUtils'
import DuplicateNotice, { type DuplicateItem } from './DuplicateNotice'

/**
 * «Новый лид» (15.11.2026): короткая форма — то, что менеджер знает в
 * момент звонка или сообщения. Остальное — под «Все поля». Дубли (409)
 * показываем до создания: два менеджера не должны вести одного клиента.
 */
export default function LeadCreateModal({ open, onClose, initial, onCreated }: {
  open: boolean
  onClose: () => void
  initial?: Partial<SalesLead>
  onCreated?: (lead: SalesLead) => void
}) {
  return (
    <Modal open={open} onClose={onClose} title="Новый лид" size="lg" closeOnBackdropClick={false}>
      {/* Форма живёт, пока окно на экране (и во время анимации закрытия);
          при следующем открытии — чистая. */}
      <CreateForm initial={initial} onClose={onClose} onCreated={onCreated} />
    </Modal>
  )
}

interface Draft {
  name: string
  contactPhone: string
  contactInstagram: string
  leadSource: string
  sphere: string
  nextStep: string
  nextStepDate: string
  nextStepTime: string
  contactPerson: string
  contactEmail: string
  problem: string
  dealPotential: string
  status: LeadStatus
  interest: '' | LeadInterest
  channel: string
  address: string
  direction: '' | LeadDirection
}

function draftOf(i?: Partial<SalesLead>): Draft {
  const step = splitLocal(i?.nextStepAt)
  return {
    name: i?.name || '',
    contactPhone: i?.contactPhone || '',
    contactInstagram: i?.contactInstagram || '',
    leadSource: i?.leadSource || '',
    sphere: i?.sphere || '',
    nextStep: i?.nextStep || '',
    nextStepDate: step.date,
    nextStepTime: step.time,
    contactPerson: i?.contactPerson || '',
    contactEmail: i?.contactEmail || '',
    problem: i?.problem || '',
    dealPotential: i?.dealPotential != null && i.dealPotential !== '' ? String(i.dealPotential) : '',
    status: i?.status && ACTIVE_STATUSES.includes(i.status) ? i.status : 'new',
    interest: i?.interest || '',
    channel: i?.channel || '',
    address: i?.address || '',
    direction: i?.direction || '',
  }
}

/** Только заполненные поля: пустые строки серверу не нужны. */
function payloadOf(d: Draft, top: boolean): Partial<SalesLead> {
  const out: Partial<SalesLead> = { name: d.name.trim(), status: d.status }
  const put = (k: keyof SalesLead, v: string) => { const t = v.trim(); if (t) (out as any)[k] = t }
  put('contactPhone', d.contactPhone)
  put('contactInstagram', d.contactInstagram)
  put('leadSource', d.leadSource)
  put('sphere', d.sphere)
  put('nextStep', d.nextStep)
  put('contactPerson', d.contactPerson)
  put('contactEmail', d.contactEmail)
  put('problem', d.problem)
  put('channel', d.channel)
  put('address', d.address)
  const at = joinLocal(d.nextStepDate, d.nextStepTime)
  if (at) out.nextStepAt = at
  const pot = Number(d.dealPotential.replace(',', '.'))
  if (d.dealPotential && pot > 0) out.dealPotential = pot
  if (d.interest) out.interest = d.interest
  // Направление выбирает только руководство: у МП оно — по роли (сервер).
  if (top && d.direction) out.direction = d.direction
  const info = contactInfoOf(out)
  if (info) out.contactInfo = info
  return out
}

function CreateForm({ initial, onClose, onCreated }: {
  initial?: Partial<SalesLead>
  onClose: () => void
  onCreated?: (lead: SalesLead) => void
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const top = isTopRole(useAuthStore(s => s.user))
  const [d, setD] = useState<Draft>(() => draftOf(initial))
  const [more, setMore] = useState(false)
  const [dups, setDups] = useState<DuplicateItem[] | null>(null)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD(prev => ({ ...prev, [k]: v }))
    // Поменяли телефон/название — прежний список дублей уже не про это.
    if (k === 'name' || k === 'contactPhone' || k === 'contactInstagram') setDups(null)
  }

  const create = useMutation({
    mutationFn: (force: boolean) => leadsApi.create({ ...payloadOf(d, top), ...(force ? { force: true } : {}) }),
    onSuccess: lead => {
      afterLeadChange(qc, lead)
      toast.success('Лид создан')
      onCreated?.(lead)
      onClose()
    },
    onError: (e: any) => {
      const found = duplicatesOf(e)
      if (found) { setDups(found); return }
      toast.error(errorText(e, 'Лид не создан'))
    },
  })

  const openDuplicate = (id: string) => {
    onClose()
    navigate(`/clients?lead=${encodeURIComponent(id)}`)
  }

  const quickDate = (days: number) => setD(p => ({ ...p, nextStepDate: dateInput(daysFromNow(days)), nextStepTime: p.nextStepTime || '11:00' }))

  return (
    <form onSubmit={e => { e.preventDefault(); if (d.name.trim()) create.mutate(false) }} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="lc-name" className="label">Название *</label>
          <input id="lc-name" autoFocus required className="input" value={d.name} maxLength={255}
            onChange={e => set('name', e.target.value)} placeholder="ООО Ромашка, @blogger_name" />
        </div>
        <div>
          <label htmlFor="lc-phone" className="label">Телефон</label>
          <input id="lc-phone" type="tel" inputMode="tel" className="input" value={d.contactPhone}
            onChange={e => set('contactPhone', e.target.value)} placeholder="+992 900 00 00 00" />
        </div>
        <div>
          <label htmlFor="lc-ig" className="label">Instagram</label>
          <input id="lc-ig" className="input" value={d.contactInstagram}
            onChange={e => set('contactInstagram', e.target.value)} placeholder="@instagram" />
        </div>
        <div>
          <label htmlFor="lc-source" className="label">Источник</label>
          <select id="lc-source" className="input" value={d.leadSource} onChange={e => set('leadSource', e.target.value)}>
            <option value="">Не указан</option>
            {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            {d.leadSource && !SOURCE_OPTIONS.includes(d.leadSource) && <option value={d.leadSource}>{d.leadSource}</option>}
          </select>
        </div>
        <div>
          <label htmlFor="lc-sphere" className="label">Сфера</label>
          <input id="lc-sphere" list="lc-sphere-list" className="input" value={d.sphere}
            onChange={e => set('sphere', e.target.value)} placeholder="Ресторан, клиника…" />
          <datalist id="lc-sphere-list">{SPHERE_SUGGESTIONS.map(s => <option key={s} value={s} />)}</datalist>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="lc-step" className="label">Следующий шаг</label>
          <input id="lc-step" className="input" maxLength={500} value={d.nextStep}
            onChange={e => set('nextStep', e.target.value)} placeholder="Позвонить, отправить КП…" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => quickDate(1)} className="btn-secondary min-h-[44px]">Завтра</button>
            <button type="button" onClick={() => quickDate(3)} className="btn-secondary min-h-[44px]">Через 3 дня</button>
            <label htmlFor="lc-step-date" className="sr-only">Дата шага</label>
            <input id="lc-step-date" type="date" className="input !w-auto" value={d.nextStepDate}
              onChange={e => set('nextStepDate', e.target.value)} />
            <label htmlFor="lc-step-time" className="sr-only">Время шага</label>
            <input id="lc-step-time" type="time" className="input !w-auto" value={d.nextStepTime}
              onChange={e => set('nextStepTime', e.target.value)} />
          </div>
        </div>
      </div>

      <button type="button" onClick={() => setMore(m => !m)} aria-expanded={more}
        className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-primary-700 hover:underline dark:text-primary-300">
        <ChevronDown size={16} aria-hidden="true" className={more ? 'rotate-180 transition-transform' : 'transition-transform'} />
        {more ? 'Скрыть поля' : 'Все поля'}
      </button>

      {more && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="lc-person" className="label">ЛПР (кто принимает решение)</label>
            <input id="lc-person" className="input" value={d.contactPerson} onChange={e => set('contactPerson', e.target.value)} placeholder="Иван — директор" />
          </div>
          <div>
            <label htmlFor="lc-email" className="label">Email</label>
            <input id="lc-email" type="email" className="input" value={d.contactEmail} onChange={e => set('contactEmail', e.target.value)} placeholder="email@domain.com" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="lc-problem" className="label">Что нужно клиенту</label>
            <textarea id="lc-problem" rows={2} className="input resize-none" value={d.problem} onChange={e => set('problem', e.target.value)} placeholder="Сайт, SMM-продвижение…" />
          </div>
          <div>
            <label htmlFor="lc-potential" className="label">Сумма сделки, с.</label>
            <input id="lc-potential" type="number" inputMode="decimal" min={0} className="input" value={d.dealPotential} onChange={e => set('dealPotential', e.target.value)} placeholder="10000" />
          </div>
          <div>
            <label htmlFor="lc-status" className="label">Этап</label>
            <select id="lc-status" className="input" value={d.status} onChange={e => set('status', e.target.value as LeadStatus)}>
              {FUNNEL_STAGES.filter(s => ACTIVE_STATUSES.includes(s.value)).map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="lc-interest" className="label">Интерес</label>
            <select id="lc-interest" className="input" value={d.interest} onChange={e => set('interest', e.target.value as Draft['interest'])}>
              <option value="">Не указан</option>
              <option value="cold">Холодный</option>
              <option value="warm">Тёплый</option>
              <option value="hot">Горячий</option>
            </select>
          </div>
          <div>
            <label htmlFor="lc-channel" className="label">Канал общения</label>
            <input id="lc-channel" list="lc-channel-list" className="input" value={d.channel} onChange={e => set('channel', e.target.value)} placeholder="WhatsApp, Telegram…" />
            <datalist id="lc-channel-list">{CHANNEL_OPTIONS.map(s => <option key={s} value={s} />)}</datalist>
          </div>
          <div>
            <label htmlFor="lc-address" className="label">Адрес</label>
            <input id="lc-address" className="input" value={d.address} onChange={e => set('address', e.target.value)} placeholder="Душанбе" />
          </div>
          {top && (
            <div>
              <label htmlFor="lc-direction" className="label">Направление</label>
              <select id="lc-direction" className="input" value={d.direction} onChange={e => set('direction', e.target.value as Draft['direction'])}>
                <option value="">Не указано</option>
                {(['smm', 'development'] as LeadDirection[]).map(x => <option key={x} value={x}>{DIRECTION_LABEL[x]}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {dups && <DuplicateNotice duplicates={dups} onOpen={openDuplicate} onForce={() => create.mutate(true)} forcing={create.isPending} />}

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="btn-secondary min-h-[44px]">Отмена</button>
        {!dups && (
          <button type="submit" disabled={!d.name.trim() || create.isPending} className="btn-primary min-h-[44px]">
            {create.isPending ? 'Создание…' : 'Создать лид'}
          </button>
        )}
      </div>
    </form>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm, Controller } from 'react-hook-form'
import { format } from 'date-fns'
import { Phone, Instagram, Mail, Calendar as CalendarIcon, PhoneCall } from 'lucide-react'
import { Modal } from '@/components/ui'
import { DatePicker, DateTimePicker } from '@/components/ui/DatePicker'
import { CollapsibleField } from '@/components/ui/CollapsibleField'
import { duplicatesOf } from '@/services/sales.api'
import { ALL_STAGES, LOST_REASONS, normalizeStatus, stageMeta } from '@/lib/salesStages'
import type { LeadStatus, LostReason, SalesLead } from '@/types/sales'
import {
  ADDRESS_OPTIONS, CHANNEL_OPTIONS, SOURCE_OPTIONS, SPHERE_SUGGESTIONS, contactInfoOf,
} from './leadUtils'
import DuplicateNotice, { type DuplicateItem } from './DuplicateNotice'

/**
 * Полная форма лида (15.11.2026) — «Все поля» из карточки и «Создать лид»
 * из Директа. Упрощена под единую воронку: 7 этапов, причина проигрыша,
 * следующий шаг со сроком, вероятность, ожидаемое закрытие, пауза.
 * Тип звонка и статус письма больше не правятся руками — их пишут
 * «Звонок» и «Письмо» в карточке (иначе KPI считался по полю формы).
 *
 * onSubmit может вернуть промис: если сервер ответил 409 о дублях, форма
 * покажет найденных и предложит «Всё равно создать» (повтор с force).
 */
export interface ClientFormProps {
  /** Редактируемый лид. */
  initial?: Partial<SalesLead> | null
  /** Заготовка НОВОГО лида (например, из чата «Директа»). */
  prefill?: Partial<SalesLead> | null
  title?: string
  onClose: () => void
  onSubmit: (data: Partial<SalesLead>, opts?: { force?: boolean }) => unknown
  loading?: boolean
}

interface FormValues {
  name: string
  sphere: string
  problem: string
  address: string
  contactPerson: string
  contactPhone: string
  contactInstagram: string
  contactEmail: string
  status: LeadStatus
  lostReason: '' | LostReason
  rejectionReason: string
  interest: string
  dealPotential: string
  probabilityMode: 'stage' | 'custom'
  probability: string
  expectedCloseAt: string
  leadSource: string
  channel: string
  nextStep: string
  nextStepAt: string
  nextContactAt: string
  repeatCallAt: string
  onHold: boolean
}

/** UTC из базы → местное «YYYY-MM-DDTHH:mm» для пикера. */
const localDT = (iso?: string | null) => (iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : '')
const toIso = (v: string) => (v ? new Date(v).toISOString() : null)
const orNull = (v: string) => (v.trim() ? v.trim() : null)

/** Старые лиды могли хранить контакты одной строкой — раскладываем. */
function parseLegacyContactInfo(raw?: string | null) {
  const out = { phone: '', instagram: '', email: '' }
  for (const part of String(raw || '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)) {
    if (/^https?:\/\/(www\.)?instagram\.com/i.test(part) || /^@/.test(part)) out.instagram ||= part
    else if (/@/.test(part) && /\./.test(part)) out.email ||= part
    else out.phone ||= part
  }
  return out
}

export function ClientForm({ initial: editing, prefill, title, onClose, onSubmit, loading }: ClientFormProps) {
  const navigate = useNavigate()
  const initial = editing || prefill || null
  const legacy = parseLegacyContactInfo(initial?.contactInfo)
  const [dups, setDups] = useState<DuplicateItem[] | null>(null)
  const [lastData, setLastData] = useState<Partial<SalesLead> | null>(null)
  const [busy, setBusy] = useState(false)

  const { register, handleSubmit, watch, control, setValue, formState: { errors } } = useForm<FormValues>({
    defaultValues: {
      name: initial?.name || '',
      sphere: initial?.sphere || '',
      problem: initial?.problem || '',
      address: initial?.address || '',
      contactPerson: initial?.contactPerson || '',
      contactPhone: initial?.contactPhone || legacy.phone,
      contactInstagram: initial?.contactInstagram || legacy.instagram,
      contactEmail: initial?.contactEmail || legacy.email,
      status: normalizeStatus(initial?.status),
      lostReason: initial?.lostReason || '',
      rejectionReason: initial?.rejectionReason || '',
      interest: initial?.interest || '',
      dealPotential: initial?.dealPotential != null ? String(initial.dealPotential) : '',
      probabilityMode: initial?.probability != null ? 'custom' : 'stage',
      probability: initial?.probability != null ? String(initial.probability) : '',
      expectedCloseAt: initial?.expectedCloseAt ? String(initial.expectedCloseAt).slice(0, 10) : '',
      leadSource: initial?.leadSource || '',
      channel: initial?.channel || '',
      nextStep: initial?.nextStep || '',
      nextStepAt: localDT(initial?.nextStepAt),
      nextContactAt: localDT(initial?.nextContactAt),
      repeatCallAt: localDT(initial?.repeatCallAt),
      onHold: !!initial?.onHold,
    },
  })

  const status = watch('status')
  const lostReason = watch('lostReason')
  const probabilityMode = watch('probabilityMode')
  const addressVal = watch('address') || ''
  const [addrOther, setAddrOther] = useState(!!(initial?.address && !ADDRESS_OPTIONS.includes(initial.address)))

  const normalize = (d: FormValues): Partial<SalesLead> => {
    const pot = Number(String(d.dealPotential).replace(',', '.'))
    const prob = Math.round(Number(d.probability))
    const out: Partial<SalesLead> = {
      name: d.name.trim(),
      sphere: orNull(d.sphere),
      problem: orNull(d.problem),
      address: orNull(d.address),
      contactPerson: orNull(d.contactPerson),
      contactPhone: orNull(d.contactPhone),
      contactInstagram: orNull(d.contactInstagram),
      contactEmail: orNull(d.contactEmail),
      status: d.status,
      interest: (d.interest || null) as SalesLead['interest'],
      dealPotential: d.dealPotential && pot > 0 ? pot : null,
      probability: d.probabilityMode === 'custom' && d.probability !== '' && Number.isFinite(prob)
        ? Math.min(100, Math.max(0, prob)) : null,
      expectedCloseAt: d.expectedCloseAt || null,
      leadSource: orNull(d.leadSource),
      channel: orNull(d.channel),
      nextStep: orNull(d.nextStep),
      nextStepAt: toIso(d.nextStepAt),
      nextContactAt: toIso(d.nextContactAt),
      repeatCallAt: toIso(d.repeatCallAt),
      onHold: d.onHold,
    }
    if (d.status === 'lost') {
      out.lostReason = (d.lostReason || null) as LostReason | null
      out.rejectionReason = orNull(d.rejectionReason)
    }
    // Текст «Контакты» собираем только для нового лида (16.11.2026): у
    // существующего в нём может быть то, чего нет в полях (второй телефон,
    // заметки из импорта), — перезапись стирала это навсегда.
    if (!editing?.id) out.contactInfo = contactInfoOf(out)
    return out
  }

  const send = async (data: Partial<SalesLead>, force: boolean) => {
    setBusy(true)
    try {
      await onSubmit(data, force ? { force: true } : undefined)
    } catch (e) {
      // Дубли показываем здесь; прочие ошибки показывает вызывающий (тост).
      const found = duplicatesOf(e)
      if (found) { setDups(found); setLastData(data) }
    } finally {
      setBusy(false)
    }
  }

  const submit = (d: FormValues) => { setDups(null); void send(normalize(d), false) }
  const pending = loading || busy

  return (
    <Modal
      open
      onClose={onClose}
      title={title || (editing ? 'Все поля лида' : 'Новый лид')}
      size="xl"
      closeOnBackdropClick={false}
    >
      <form onSubmit={handleSubmit(submit)} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="cf-name" className="label">Название компании / клиента *</label>
            <input id="cf-name" {...register('name', { required: true, validate: v => !!v.trim() })} className="input"
              placeholder="ООО Ромашка, @blogger_name" aria-invalid={!!errors.name} />
            {errors.name && <p className="mt-1 text-xs text-red-600 dark:text-red-300">Укажите название</p>}
          </div>
          <div>
            <label htmlFor="cf-sphere" className="label">Сфера</label>
            <input id="cf-sphere" list="cf-sphere-list" {...register('sphere')} className="input" placeholder="Ресторан, клиника, блогер…" />
            <datalist id="cf-sphere-list">{SPHERE_SUGGESTIONS.map(s => <option key={s} value={s} />)}</datalist>
          </div>
          <CollapsibleField label="Адрес" defaultOpen={!!initial?.address} hint={initial?.address || ''}>
            <select
              aria-label="Город"
              className="input"
              value={addrOther ? 'Другое' : (ADDRESS_OPTIONS.includes(addressVal) ? addressVal : '')}
              onChange={e => {
                const v = e.target.value
                if (v === 'Другое') { setAddrOther(true); setValue('address', '') }
                else { setAddrOther(false); setValue('address', v) }
              }}
            >
              <option value="">— Выберите —</option>
              {ADDRESS_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              <option value="Другое">Другое</option>
            </select>
            {addrOther && <input {...register('address')} aria-label="Адрес" className="input mt-2" placeholder="Город, адрес" />}
          </CollapsibleField>
          <div className="sm:col-span-2">
            <label htmlFor="cf-problem" className="label">Что нужно клиенту</label>
            <textarea id="cf-problem" {...register('problem')} rows={2} className="input resize-none" placeholder="Разработка сайта, SMM-продвижение…" />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="cf-person" className="label">ЛПР (кто принимает решение)</label>
            <input id="cf-person" {...register('contactPerson')} className="input" placeholder="Иван Иванов — директор" />
          </div>
          <div>
            <label htmlFor="cf-phone" className="label inline-flex items-center gap-1"><Phone size={12} aria-hidden="true" /> Телефон ЛПР</label>
            <input id="cf-phone" type="tel" {...register('contactPhone')} className="input" placeholder="+992 900 00 00 00" />
          </div>
          <div>
            <label htmlFor="cf-ig" className="label inline-flex items-center gap-1"><Instagram size={12} aria-hidden="true" /> Instagram ЛПР</label>
            <input id="cf-ig" {...register('contactInstagram')} className="input" placeholder="@instagram_handle" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="cf-email" className="label inline-flex items-center gap-1"><Mail size={12} aria-hidden="true" /> Email ЛПР</label>
            <input id="cf-email" type="email" {...register('contactEmail')} className="input" placeholder="email@domain.com" />
          </div>

          <div>
            <label htmlFor="cf-status" className="label">Этап *</label>
            <select id="cf-status" {...register('status')} className="input">
              {ALL_STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {status === 'won' && normalizeStatus(initial?.status) !== 'won' && (
              <p className="mt-1 text-[11px] text-surface-500 dark:text-surface-400">
                Чтобы команда получила проект, отметьте «Выиграно» в карточке лида — откроется «Передать в работу».
              </p>
            )}
          </div>
          <label className="flex min-h-[44px] cursor-pointer items-center gap-3 self-end text-sm text-surface-800 dark:text-surface-100">
            <input type="checkbox" {...register('onHold')} className="h-4 w-4" />
            На паузе (клиент просил вернуться позже)
          </label>

          {status === 'lost' && (
            <>
              <div>
                <label htmlFor="cf-lost" className="label">Причина проигрыша *</label>
                <select id="cf-lost" {...register('lostReason', { validate: v => status !== 'lost' || !!v })}
                  className="input" aria-invalid={!!errors.lostReason}>
                  <option value="">— Выберите —</option>
                  {LOST_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                {errors.lostReason && <p className="mt-1 text-xs text-red-600 dark:text-red-300">Укажите причину проигрыша</p>}
              </div>
              <div>
                <label htmlFor="cf-reject" className="label">{lostReason === 'other' ? 'Опишите причину *' : 'Подробнее'}</label>
                <input id="cf-reject" {...register('rejectionReason', { validate: v => status !== 'lost' || lostReason !== 'other' || !!v.trim() })}
                  className="input" placeholder="Что сказал клиент" aria-invalid={!!errors.rejectionReason} />
                {errors.rejectionReason && <p className="mt-1 text-xs text-red-600 dark:text-red-300">Для «Другое» нужен текст</p>}
              </div>
            </>
          )}

          <div>
            <label htmlFor="cf-potential" className="label">Сумма сделки, с.</label>
            <input id="cf-potential" type="number" inputMode="decimal" min={0} step="0.01" {...register('dealPotential')} className="input" placeholder="10000" />
          </div>
          <div>
            <label htmlFor="cf-prob-mode" className="label">Вероятность</label>
            <div className="flex gap-2">
              <select id="cf-prob-mode" {...register('probabilityMode')} className="input">
                <option value="stage">По этапу ({stageMeta(status).probability} %)</option>
                <option value="custom">Своя</option>
              </select>
              {probabilityMode === 'custom' && (
                <input type="number" min={0} max={100} aria-label="Вероятность, %" {...register('probability')} className="input !w-24" placeholder="%" />
              )}
            </div>
          </div>
          <div>
            <label className="label">Ожидаемое закрытие</label>
            <Controller name="expectedCloseAt" control={control}
              render={({ field }) => <DatePicker value={field.value || ''} onChange={field.onChange} />} />
          </div>
          <div>
            <label htmlFor="cf-interest" className="label">Интерес</label>
            <select id="cf-interest" {...register('interest')} className="input">
              <option value="">Не указан</option>
              <option value="cold">Холодный</option>
              <option value="warm">Тёплый</option>
              <option value="hot">Горячий</option>
            </select>
          </div>
          <div>
            <label htmlFor="cf-source" className="label">Источник</label>
            <input id="cf-source" list="cf-source-list" {...register('leadSource')} className="input" placeholder="Instagram, рекомендация…" />
            <datalist id="cf-source-list">{SOURCE_OPTIONS.map(s => <option key={s} value={s} />)}</datalist>
          </div>
          <div>
            <label htmlFor="cf-channel" className="label">Канал общения</label>
            <input id="cf-channel" list="cf-channel-list" {...register('channel')} className="input" placeholder="WhatsApp, Telegram…" />
            <datalist id="cf-channel-list">{CHANNEL_OPTIONS.map(s => <option key={s} value={s} />)}</datalist>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="cf-step" className="label">Следующий шаг</label>
            <input id="cf-step" {...register('nextStep')} maxLength={500} className="input" placeholder="Отправить коммерческое предложение…" />
          </div>
          <div>
            <label className="label">Срок шага</label>
            <Controller name="nextStepAt" control={control}
              render={({ field }) => <DateTimePicker value={field.value || ''} onChange={field.onChange} />} />
          </div>
          <div>
            <label className="label inline-flex items-center gap-1"><CalendarIcon size={12} aria-hidden="true" /> Встреча</label>
            <Controller name="nextContactAt" control={control}
              render={({ field }) => <DateTimePicker value={field.value || ''} onChange={field.onChange} />} />
          </div>
          <div>
            <label className="label inline-flex items-center gap-1"><PhoneCall size={12} aria-hidden="true" /> Перезвонить</label>
            <Controller name="repeatCallAt" control={control}
              render={({ field }) => <DateTimePicker value={field.value || ''} onChange={field.onChange} />} />
          </div>
        </div>

        {dups && lastData && (
          <DuplicateNotice
            duplicates={dups}
            onOpen={id => { onClose(); navigate(`/clients?lead=${encodeURIComponent(id)}`) }}
            onForce={() => void send(lastData, true)}
            forcing={pending}
          />
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary min-h-[44px]">Отмена</button>
          {!dups && (
            <button type="submit" disabled={pending} className="btn-primary min-h-[44px]">
              {pending ? 'Сохранение…' : (editing ? 'Сохранить' : 'Создать лид')}
            </button>
          )}
        </div>
      </form>
    </Modal>
  )
}

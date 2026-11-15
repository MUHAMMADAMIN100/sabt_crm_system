import { useState } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { probabilityOf, stageMeta } from '@/lib/salesStages'
import type { SalesLead } from '@/types/sales'
import { useLeadUpdate } from '../salesHooks'
import { SOURCE_OPTIONS, formatMoney, moneyValue } from '../leadUtils'
import Section, { Field, LinkButton } from './Section'

/**
 * «Сделка» (15.11.2026): сумма, вероятность (своя или по этапу),
 * ожидаемое закрытие и источник. Из суммы и вероятности считается прогноз
 * «с учётом вероятности» в шапке Клиентов и в аналитике.
 */
export default function LeadDeal({ lead, canAct }: { lead: SalesLead; canAct: boolean }) {
  const [editing, setEditing] = useState(false)
  const amount = moneyValue(lead.dealPotential)
  const closeAt = lead.expectedCloseAt ? new Date(`${String(lead.expectedCloseAt).slice(0, 10)}T00:00:00`) : null

  return (
    <Section
      title="Сделка"
      action={canAct && !editing ? <LinkButton onClick={() => setEditing(true)}>Изменить</LinkButton> : undefined}
    >
      {editing ? (
        <DealForm lead={lead} onDone={() => setEditing(false)} />
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Сумма">{amount > 0 ? formatMoney(amount) : <Dash />}</Field>
          <Field label="Вероятность">
            {probabilityOf(lead)} %{lead.probability == null && <span className="text-surface-500 dark:text-surface-400"> · по этапу</span>}
          </Field>
          <Field label="Ожидаемое закрытие">
            {closeAt && !isNaN(closeAt.getTime()) ? format(closeAt, 'd MMMM yyyy', { locale: ru }) : <Dash />}
          </Field>
          <Field label="Источник">{lead.leadSource || <Dash />}</Field>
        </dl>
      )}
    </Section>
  )
}

function Dash() {
  return <span className="text-surface-400">—</span>
}

function DealForm({ lead, onDone }: { lead: SalesLead; onDone: () => void }) {
  const [amount, setAmount] = useState(moneyValue(lead.dealPotential) > 0 ? String(moneyValue(lead.dealPotential)) : '')
  const [custom, setCustom] = useState(lead.probability != null)
  const [prob, setProb] = useState(lead.probability != null ? String(lead.probability) : String(stageMeta(lead.status).probability))
  const [closeAt, setCloseAt] = useState(lead.expectedCloseAt ? String(lead.expectedCloseAt).slice(0, 10) : '')
  const [source, setSource] = useState(lead.leadSource || '')
  const update = useLeadUpdate()
  const id = `deal-${lead.id}`
  const probNum = Math.round(Number(prob))
  const probOk = !custom || (prob !== '' && probNum >= 0 && probNum <= 100)

  const save = () => {
    const pot = Number(amount.replace(',', '.'))
    update.mutate({
      id: lead.id,
      data: {
        dealPotential: amount && pot > 0 ? pot : null,
        probability: custom ? probNum : null,
        expectedCloseAt: closeAt || null,
        leadSource: source || null,
      },
    }, { onSuccess: () => { toast.success('Сделка обновлена'); onDone() } })
  }

  return (
    <form onSubmit={e => { e.preventDefault(); if (probOk) save() }} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${id}-amount`} className="label">Сумма, с.</label>
          <input id={`${id}-amount`} type="number" inputMode="decimal" min={0} className="input" value={amount}
            onChange={e => setAmount(e.target.value)} placeholder="10000" />
        </div>
        <div>
          <label htmlFor={`${id}-close`} className="label">Ожидаемое закрытие</label>
          <input id={`${id}-close`} type="date" className="input" value={closeAt} onChange={e => setCloseAt(e.target.value)} />
        </div>
      </div>
      <fieldset>
        <legend className="label">Вероятность</legend>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <input type="radio" name={`${id}-prob`} checked={!custom} onChange={() => setCustom(false)} className="h-4 w-4" />
            По этапу ({stageMeta(lead.status).probability} %)
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <input type="radio" name={`${id}-prob`} checked={custom} onChange={() => setCustom(true)} className="h-4 w-4" />
            Своя
          </label>
          {custom && (
            <input type="number" min={0} max={100} aria-label="Вероятность, %" className="input !w-24" value={prob}
              onChange={e => setProb(e.target.value)} />
          )}
        </div>
        {!probOk && <p className="text-xs text-red-600 dark:text-red-300">От 0 до 100 %</p>}
      </fieldset>
      <div>
        <label htmlFor={`${id}-source`} className="label">Источник</label>
        <select id={`${id}-source`} className="input" value={source} onChange={e => setSource(e.target.value)}>
          <option value="">Не указан</option>
          {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          {source && !SOURCE_OPTIONS.includes(source) && <option value={source}>{source}</option>}
        </select>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={!probOk || update.isPending} className="btn-primary min-h-[44px]">
          {update.isPending ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button type="button" onClick={onDone} className="btn-ghost min-h-[44px]">Отмена</button>
      </div>
    </form>
  )
}

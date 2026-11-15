import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { Modal } from '@/components/ui'
import { smmTariffsApi } from '@/services/api.service'
import { salesApi } from '@/services/sales.api'
import { useAuthStore } from '@/store/auth.store'
import type { LeadDirection, SalesLead } from '@/types/sales'
import { afterLeadChange, useLastValue } from './salesHooks'
import { DEV_PRODUCTS, DIRECTION_LABEL, dateInput, errorText, moneyValue, salesDirectionOf } from './leadUtils'

const OTHER = '__other__'

/**
 * «Передать в работу» (15.11.2026, макет): выигрыш сделки — это передача
 * команде, а не просто смена этапа. Направление, продукт, сумма и дата
 * первой оплаты уходят руководителю направления задачей «Создать проект»
 * (POST /sales/leads/:id/handoff). Повторная передача — 409.
 */
export default function HandoffModal({ lead, onClose, onDone }: {
  lead: SalesLead | null
  onClose: () => void
  onDone?: (lead: SalesLead) => void
}) {
  const shown = useLastValue(lead)
  return (
    <Modal open={!!lead} onClose={onClose} title="Передать в работу" size="lg" closeOnBackdropClick={false} closeOnEscape={false}>
      {shown && <HandoffForm key={shown.id} lead={shown} onClose={onClose} onDone={onDone} />}
    </Modal>
  )
}

function HandoffForm({ lead, onClose, onDone }: {
  lead: SalesLead
  onClose: () => void
  onDone?: (lead: SalesLead) => void
}) {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const [direction, setDirection] = useState<LeadDirection>(lead.direction ?? salesDirectionOf(user) ?? 'smm')
  const [productChoice, setProductChoice] = useState('')
  const [productText, setProductText] = useState('')
  const [amount, setAmount] = useState(moneyValue(lead.dealPotential) > 0 ? String(moneyValue(lead.dealPotential)) : '')
  const [firstPaymentAt, setFirstPaymentAt] = useState(dateInput(new Date()))
  const [sendBrief, setSendBrief] = useState(true)
  const [note, setNote] = useState('')

  // Тарифы SMM — тот же список, что в карточке проекта (цены видит только
  // основатель; у остальных сумму вводят руками).
  const tariffsQ = useQuery({
    queryKey: ['smm-tariffs', 'active'],
    queryFn: () => smmTariffsApi.list({ isActive: true }),
    enabled: direction === 'smm',
    staleTime: 5 * 60_000,
  })
  const tariffs: Array<{ id: string; name: string; monthlyPrice?: number | string | null }> = useMemo(
    () => (Array.isArray(tariffsQ.data) ? tariffsQ.data : []).filter((t: any) => t && t.name),
    [tariffsQ.data],
  )
  const options: Array<{ value: string; label: string; price?: number }> = direction === 'smm'
    ? tariffs.map(t => ({ value: t.name, label: t.name, price: moneyValue(t.monthlyPrice) || undefined }))
    : DEV_PRODUCTS.map(p => ({ value: p, label: p }))
  const freeTextOnly = direction === 'smm' && !tariffsQ.isLoading && options.length === 0
  const product = (freeTextOnly || productChoice === OTHER ? productText : productChoice).trim()
  const amountNum = Number(amount.replace(',', '.'))
  const ready = !!product && amountNum > 0 && !!firstPaymentAt

  const save = useMutation({
    mutationFn: () => salesApi.handoff(lead.id, {
      direction,
      product: product.slice(0, 200),
      amount: amountNum,
      firstPaymentAt,
      ...(note.trim() ? { note: note.trim().slice(0, 2000) } : {}),
      sendBrief,
    }),
    onSuccess: saved => {
      afterLeadChange(qc, saved)
      toast.success('Передано в работу')
      onDone?.(saved)
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.status === 409
      ? 'Этот лид уже передан в работу'
      : errorText(e, 'Не удалось передать в работу')),
  })

  const pickProduct = (v: string) => {
    setProductChoice(v)
    const price = options.find(o => o.value === v)?.price
    // Цена тарифа — подсказка суммы, только если сумму ещё не вводили.
    if (price && !amount) setAmount(String(price))
  }

  return (
    <form onSubmit={e => { e.preventDefault(); if (ready) save.mutate() }} className="space-y-4">
      <p className="text-sm text-surface-600 dark:text-surface-300">
        <span className="font-medium text-surface-800 dark:text-surface-100">{lead.name}</span> — сделка выиграна. Расскажите команде, что продано.
      </p>

      <fieldset>
        <legend className="label">Направление</legend>
        <div className="grid grid-cols-2 gap-2">
          {(['smm', 'development'] as LeadDirection[]).map(d => (
            <button
              key={d}
              type="button"
              aria-pressed={direction === d}
              onClick={() => { setDirection(d); setProductChoice(''); setProductText('') }}
              className={clsx(
                'min-h-[44px] rounded-lg border text-sm font-semibold transition-colors',
                direction === d
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-surface-300 bg-surface-50 text-surface-800 hover:border-surface-400 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-100',
              )}
            >
              {DIRECTION_LABEL[d]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="handoff-product" className="label">{direction === 'smm' ? 'Тариф *' : 'Что делаем *'}</label>
          {freeTextOnly ? (
            <input id="handoff-product" className="input" maxLength={200} value={productText}
              onChange={e => setProductText(e.target.value)} placeholder="Название тарифа" />
          ) : (
            <>
              <select id="handoff-product" className="input" value={productChoice} onChange={e => pickProduct(e.target.value)}>
                <option value="">{tariffsQ.isLoading && direction === 'smm' ? 'Загрузка тарифов…' : '— Выберите —'}</option>
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                <option value={OTHER}>Другое</option>
              </select>
              {productChoice === OTHER && (
                <input className="input mt-2" aria-label="Что продано" maxLength={200} value={productText}
                  onChange={e => setProductText(e.target.value)} placeholder="Опишите продукт" />
              )}
            </>
          )}
        </div>
        <div>
          <label htmlFor="handoff-amount" className="label">Сумма, с. *</label>
          <input id="handoff-amount" type="number" inputMode="decimal" min={0} step="0.01" className="input"
            value={amount} onChange={e => setAmount(e.target.value)} placeholder="10000" />
        </div>
        <div>
          <label htmlFor="handoff-first" className="label">Первая оплата *</label>
          <input id="handoff-first" type="date" className="input" value={firstPaymentAt}
            onChange={e => setFirstPaymentAt(e.target.value)} />
        </div>
      </div>

      <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-surface-800 dark:text-surface-100">
        <input type="checkbox" checked={sendBrief} onChange={e => setSendBrief(e.target.checked)} className="h-4 w-4" />
        Отправить клиенту ссылку на бриф
      </label>

      <div>
        <label htmlFor="handoff-note" className="label">Что важно знать команде</label>
        <textarea id="handoff-note" rows={3} maxLength={2000} className="input resize-none" value={note}
          onChange={e => setNote(e.target.value)} placeholder="Ожидания клиента, сроки, с кем держать связь" />
      </div>

      <div className="rounded-lg border border-surface-200 bg-surface-100/60 p-3 text-sm dark:border-surface-700 dark:bg-surface-900/40">
        <p className="mb-1.5 font-semibold text-surface-800 dark:text-surface-100">После отправки</p>
        <ul className="list-disc space-y-1 pl-5 text-surface-600 dark:text-surface-300">
          <li>Лид перейдёт в этап «Выиграно» — это засчитается в продвижение по воронке.</li>
          <li>Руководитель направления и основатель получат уведомление в CRM и Telegram.</li>
          <li>Руководителю направления придёт задача «Создать проект» на завтра; когда проект создадут, вам придёт уведомление.</li>
        </ul>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-secondary min-h-[44px]">Отмена</button>
        <button type="submit" disabled={!ready || save.isPending} className="btn-primary min-h-[44px]">
          {save.isPending ? 'Отправка…' : 'Передать в работу'}
        </button>
      </div>
    </form>
  )
}

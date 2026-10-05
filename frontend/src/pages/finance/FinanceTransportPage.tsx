// Финансы → «Транспорт сотрудникам» (05.10.2026): заявки SMM-специалистов и
// видеографов на возврат денег за проезд по работе. «Оплатить» спрашивает
// счёт и сам записывает расход «Транспорт» (кому выдано — сотрудник, проект —
// если в Финансах есть проект с тем же названием). «Отклонить» — с причиной,
// сотрудник её увидит. О новой заявке владелец узнаёт из уведомления и Telegram.
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import './finance.css'
import { money, currentYm, apiErr } from './finlib'
import FinIcon from './FinIcon'
import MonthNav from './MonthNav'
import { FinLoading, FinLoadError, invalidateFinance } from './FinKit'
import { financeApi, transportApi } from '@/services/api.service'

const API = import.meta.env.VITE_API_URL || ''
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
/** Момент решения → местная дата: без этого оплата ночью попадала бы на вчера (UTC). */
const isoLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 100, b = n % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  return b === 1 ? one : many
}
const dayText = (iso?: string | null) => (iso ? `${Number(String(iso).slice(8, 10))} ${MON[Number(String(iso).slice(5, 7)) - 1] || ''}` : '')
const ROLE: Record<string, string> = { smm_specialist: 'SMM-специалист', videographer: 'видеограф' }
const initials = (name?: string | null) => {
  const p = String(name || '?').trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'
}

type Req = {
  id: string; employeeName: string; employeeRole: string | null; projectName: string | null
  amount: number; date: string; note: string | null; receiptUrl: string | null
  status: 'pending' | 'paid' | 'rejected'; rejectReason: string | null; decidedAt: string | null
}
type Data = {
  ym: string; pending: Req[]; done: Req[]
  totals: { pendingSum: number; pendingCount: number; paidSum: number; paidCount: number; top: { name: string; count: number; sum: number } | null }
}

export default function FinanceTransportPage() {
  const qc = useQueryClient()
  const [ym, setYm] = useState(currentYm())
  const q = useQuery<Data>({ queryKey: ['transport-list', ym], queryFn: () => transportApi.list(ym) })
  const accountsQ = useQuery<any[]>({ queryKey: ['finref', 'accounts'], queryFn: () => financeApi.accounts() })
  const accounts = (accountsQ.data ?? []).filter((a: any) => !a.archived)
  const [open, setOpen] = useState<{ id: string; mode: 'pay' | 'reject' } | null>(null)
  const [accountId, setAccountId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['transport-list'] })
    invalidateFinance(qc)
  }

  async function pay(r: Req) {
    const acc = accountId || accounts[0]?.id
    if (!acc) { toast.error('Нет счёта для оплаты — добавьте его в настройках Финансов'); return }
    setBusy(true)
    try {
      await transportApi.pay(r.id, acc)
      toast.success(`Оплачено ${money(r.amount)} · расход «Транспорт» записан`)
      setOpen(null)
      refresh()
    } catch (e) {
      toast.error(apiErr(e))
    } finally {
      setBusy(false)
    }
  }

  async function reject(r: Req) {
    if (!reason.trim()) { toast.error('Напишите причину — сотрудник её увидит'); return }
    setBusy(true)
    try {
      await transportApi.reject(r.id, reason.trim())
      toast.success('Заявка отклонена')
      setOpen(null); setReason('')
      refresh()
    } catch (e) {
      toast.error(apiErr(e))
    } finally {
      setBusy(false)
    }
  }

  const data = q.data
  const t = data?.totals

  return (
    <div className="fin-root">
      <div className="page-head">
        <div>
          <h1 className="flex"><FinIcon name="car" size={22} /> Транспорт сотрудникам</h1>
          <p>Заявки SMM-специалистов и видеографов: проверьте и верните деньги за проезд</p>
        </div>
        <MonthNav ym={ym} onChange={setYm} />
      </div>

      {q.isLoading ? <FinLoading cards={3} /> : q.isError ? <FinLoadError onRetry={() => q.refetch()} /> : data && (
        <div className="space-y-4">
          <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(230px,1fr))]">
            <div className={clsx('card', t!.pendingCount ? 'border-amber-500/50' : '')}>
              <span className="muted mini">Ждут оплаты</span>
              <div className="value">{money(t!.pendingSum)}</div>
              <span className="mini muted">{t!.pendingCount ? `${t!.pendingCount} ${plural(t!.pendingCount, 'заявка', 'заявки', 'заявок')}` : 'заявок нет'}</span>
            </div>
            <div className="card">
              <span className="muted mini">Оплачено за месяц</span>
              <div className="value">{money(t!.paidSum)}</div>
              <span className="mini muted">{t!.paidCount} {plural(t!.paidCount, 'поездка', 'поездки', 'поездок')}</span>
            </div>
            <div className="card">
              <span className="muted mini">Больше всего ездит</span>
              <div className="value" style={{ fontSize: 18 }}>{t!.top ? t!.top.name : '—'}</div>
              <span className="mini muted">{t!.top ? `${t!.top.count} ${plural(t!.top.count, 'поездка', 'поездки', 'поездок')} · ${money(t!.top.sum)}` : 'в этом месяце оплат нет'}</span>
            </div>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div className="flex" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', gap: 8 }}>
              <b>Ждут оплаты</b>
              <span className="mini muted">· все, за любой месяц</span>
            </div>
            {data.pending.length === 0 ? (
              <p className="mini muted" style={{ padding: 16, margin: 0 }}>Новых заявок нет. Когда сотрудник подаст заявку, она появится здесь и придёт вам в Telegram.</p>
            ) : data.pending.map(r => (
              <div key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2" style={{ padding: '12px 16px' }}>
                  <span className="flex items-center gap-2.5 min-w-[190px] flex-1">
                    <span className="w-8 h-8 rounded-[10px] bg-surface-200 dark:bg-surface-700 flex items-center justify-center text-[11px] font-bold shrink-0">{initials(r.employeeName)}</span>
                    <span className="min-w-0">
                      <b className="block text-[13.5px] truncate">{r.employeeName}</b>
                      <span className="block mini muted">{ROLE[r.employeeRole || ''] || 'сотрудник'}</span>
                    </span>
                  </span>
                  <span className="min-w-[120px] text-[13.5px]">{r.projectName || '—'}</span>
                  <span className="min-w-[60px] text-[13px] muted">{dayText(r.date)}</span>
                  <span className="flex-[2] min-w-[180px] text-[13px]">
                    {r.note || <span className="muted">без пояснения</span>}
                    {r.receiptUrl && (
                      <a href={`${API}${r.receiptUrl}`} target="_blank" rel="noreferrer"
                        className="ml-2 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-primary-500/15 text-primary-600 dark:text-primary-400">чек</a>
                    )}
                  </span>
                  <b className="min-w-[80px] text-right text-[15px]">{money(r.amount)}</b>
                  <span className="flex gap-1.5 ml-auto">
                    <button type="button" className="btn primary sm" onClick={() => { setOpen({ id: r.id, mode: 'pay' }); setAccountId(accounts[0]?.id || '') }}>Оплатить</button>
                    <button type="button" className="btn sm" onClick={() => { setOpen({ id: r.id, mode: 'reject' }); setReason('') }}>Отклонить</button>
                  </span>
                </div>
                {open?.id === r.id && open.mode === 'pay' && (
                  <div className="flex flex-wrap items-center gap-3" style={{ margin: '0 16px 12px', padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(34,197,94,.4)', background: 'rgba(34,197,94,.06)' }}>
                    <span className="text-[13px]">Оплатить {money(r.amount)} со счёта</span>
                    <select aria-label="Счёт" value={accountId} onChange={e => setAccountId(e.target.value)} style={{ width: 200 }}>
                      {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <span className="mini muted">запишется расход «Транспорт» · {r.employeeName} · {r.projectName || 'проект'}</span>
                    <span className="flex gap-1.5 ml-auto">
                      <button type="button" className="btn primary sm" disabled={busy} onClick={() => pay(r)}>{busy ? 'Оплачиваю…' : 'Подтвердить оплату'}</button>
                      <button type="button" className="btn ghost sm" onClick={() => setOpen(null)}>Отмена</button>
                    </span>
                  </div>
                )}
                {open?.id === r.id && open.mode === 'reject' && (
                  <div className="flex flex-wrap items-center gap-3" style={{ margin: '0 16px 12px', padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(239,68,68,.4)', background: 'rgba(239,68,68,.05)' }}>
                    <input value={reason} onChange={e => setReason(e.target.value)} maxLength={200} autoFocus
                      placeholder="Причина — сотрудник её увидит, например «поездка не по проекту»" style={{ flex: '1 1 280px' }} />
                    <span className="flex gap-1.5">
                      <button type="button" className="btn sm danger" disabled={busy} onClick={() => reject(r)}>{busy ? 'Отклоняю…' : 'Отклонить'}</button>
                      <button type="button" className="btn ghost sm" onClick={() => setOpen(null)}>Отмена</button>
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {data.done.length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}><b>Решённые за месяц</b></div>
              {data.done.map(r => (
                <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                  <b className="min-w-[170px] text-[13.5px]">{r.employeeName}</b>
                  <span className="min-w-[120px] text-[13px]">{r.projectName || '—'}</span>
                  <span className="min-w-[60px] text-[13px] muted">{dayText(r.date)}</span>
                  <span className="flex-1 min-w-[160px] text-[13px] muted">{r.note || ''}</span>
                  <b className="min-w-[80px] text-right text-[14px]">{money(r.amount)}</b>
                  <span className={clsx('px-2.5 py-0.5 rounded-full text-[12px] font-semibold',
                    r.status === 'paid' ? 'bg-green-500/15 text-green-700 dark:text-green-400' : 'bg-red-500/15 text-red-700 dark:text-red-400')}>
                    {r.status === 'paid' ? `оплачено ${r.decidedAt ? dayText(isoLocal(new Date(r.decidedAt))) : ''}` : `отклонено${r.rejectReason ? `: «${r.rejectReason}»` : ''}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

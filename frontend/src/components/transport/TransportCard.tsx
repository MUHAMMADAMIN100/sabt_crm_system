// «Транспорт по работе» — строка в панели SMM-специалиста и видеографа
// (решение владельца 05.10.2026). Съездил на съёмку или к клиенту за свой
// счёт — подаёшь заявку: проект, сумма, когда, куда и зачем, по желанию фото
// чека. Владелец оплачивает в Финансах → «Транспорт сотрудникам».
// Сама панель специалиста не меняется — карточка стоит над ней.
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { Car, ChevronRight, ImagePlus, Loader2, X } from 'lucide-react'
import { transportApi } from '@/services/api.service'
import { Modal } from '@/components/ui'
import { prepareReceipt } from '@/lib/imageCompress'

/** Потолок одной заявки — тот же, что проверяет сервер. */
const MAX_AMOUNT = 5000
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const API = import.meta.env.VITE_API_URL || ''

const isoLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const dayText = (iso?: string | null) => (iso ? `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1] || ''}` : '')
const money = (n: number) => `${Number(n || 0).toLocaleString('ru-RU')}`
const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 100, b = n % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  return b === 1 ? one : many
}
const errText = (e: any, fallback: string) => {
  const m = e?.response?.data?.message
  return Array.isArray(m) ? m.join(', ') : (typeof m === 'string' && m) || fallback
}

type Item = {
  id: string; projectName: string | null; amount: number; date: string; note: string | null
  receiptUrl: string | null; status: 'pending' | 'paid' | 'rejected'; rejectReason: string | null; decidedAt: string | null
}
type Mine = { canRequest: boolean; pendingSum: number; pendingCount: number; paidMonthSum: number; items: Item[] }

export default function TransportCard() {
  const [form, setForm] = useState(false)
  const [list, setList] = useState(false)
  const { data } = useQuery<Mine>({ queryKey: ['transport-my'], queryFn: transportApi.my })
  if (data && !data.canRequest) return null

  return (
    <div className="card p-4 space-y-3 border-primary-500/40">
      <div className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
          <Car size={22} />
        </span>
        <span className="min-w-0">
          <b className="block text-[15px] font-semibold">Транспорт по работе</b>
          <span className="block text-[12.5px] text-surface-500">Ездили на съёмку или к клиенту — верните деньги за проезд</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setForm(true)} className="btn-primary flex-1 min-h-[48px] text-[15px]">
          Подать заявку на транспорт
        </button>
        {!!data?.items?.length && (
          <button type="button" onClick={() => setList(true)} className="btn-secondary min-h-[48px] px-4">Мои заявки</button>
        )}
      </div>
      {!!data?.pendingCount && (
        <button type="button" onClick={() => setList(true)}
          className="w-full min-h-[40px] px-3 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[13px] font-semibold flex items-center justify-between">
          <span>{data.pendingCount} {plural(data.pendingCount, 'заявка ждёт', 'заявки ждут', 'заявок ждут')} оплаты · {money(data.pendingSum)} сомони</span>
          <ChevronRight size={16} />
        </button>
      )}
      {form && <RequestModal onClose={() => setForm(false)} />}
      {list && data && <MineModal data={data} onClose={() => setList(false)} />}
    </div>
  )
}

function RequestModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const today = isoLocal(new Date())
  const yesterday = isoLocal(new Date(Date.now() - 864e5))
  const { data: projects = [], isLoading } = useQuery<{ id: string; name: string; mine: boolean }[]>({
    queryKey: ['transport-projects'], queryFn: transportApi.projects,
  })
  const [projectId, setProjectId] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  // Фото чека держим в браузере (уже сжатым) и отправляем вместе с заявкой.
  const [receipt, setReceipt] = useState<{ file: File; preview: string } | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Превью — локальная ссылка на файл: освобождаем, когда фото меняют или окно закрывают.
  useEffect(() => () => { if (receipt) URL.revokeObjectURL(receipt.preview) }, [receipt])

  const mine = projects.filter(p => p.mine)
  const others = projects.filter(p => !p.mine)
  const chips = showAll || !mine.length ? projects : mine
  const sum = Number(String(amount).replace(',', '.'))
  const tooMuch = sum > MAX_AMOUNT
  const ok = !!projectId && sum > 0 && !tooMuch && !busy && !preparing

  // На компьютере клик по невидимому полю даты календарь сам не открывает — открываем явно.
  function openPicker(e: { currentTarget: HTMLInputElement }) {
    try { (e.currentTarget as any).showPicker?.() } catch { /* старый браузер — откроется сам */ }
  }

  async function pickFile(f?: File | null) {
    if (!f) return
    setPreparing(true)
    try {
      const file = await prepareReceipt(f)
      setReceipt({ file, preview: URL.createObjectURL(file) })
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось прочитать фото')
    } finally {
      setPreparing(false)
      // Тот же файл можно выбрать снова — иначе onChange не сработает.
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function send() {
    if (!ok) return
    setBusy(true)
    try {
      await transportApi.create({ projectId, amount: sum, date, note: note.trim() || undefined }, receipt?.file)
      toast.success('Заявка отправлена')
      qc.invalidateQueries({ queryKey: ['transport-my'] })
      onClose()
    } catch (e) {
      toast.error(errText(e, 'Не удалось отправить заявку'))
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Заявка на транспорт" size="md">
      <div className="space-y-4">
        <div className="space-y-2">
          <span className="text-[12.5px] font-semibold text-surface-500">По какому проекту</span>
          {isLoading ? <Loader2 size={18} className="animate-spin text-surface-400" /> : (
            <div className="flex flex-wrap gap-1.5">
              {chips.map(p => (
                <button key={p.id} type="button" aria-pressed={projectId === p.id} onClick={() => setProjectId(p.id)}
                  className={clsx('min-h-[40px] px-3.5 rounded-full border text-[13.5px] font-semibold',
                    projectId === p.id
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300'
                      : 'border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-300')}>
                  {p.name}
                </button>
              ))}
              {!projects.length && <span className="text-[13px] text-surface-500">Нет активных проектов</span>}
              {!showAll && mine.length > 0 && others.length > 0 && (
                <button type="button" onClick={() => setShowAll(true)}
                  className="min-h-[40px] px-3.5 rounded-full border border-dashed border-surface-300 dark:border-surface-600 text-[13.5px] font-semibold text-surface-500">
                  Другой проект…
                </button>
              )}
            </div>
          )}
        </div>

        <label className="block space-y-2">
          <span className="text-[12.5px] font-semibold text-surface-500">Сколько ушло на проезд</span>
          <span className="flex items-center gap-2 min-h-[60px] px-4 rounded-2xl border-[1.5px] border-primary-500/70 bg-surface-50 dark:bg-surface-900">
            <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
              placeholder="0" aria-label="Сумма в сомони"
              className="flex-1 min-w-0 bg-transparent outline-none text-[28px] font-bold" />
            <span className="text-[16px] text-surface-500">сомони</span>
          </span>
          {tooMuch && (
            <span className="block text-[12.5px] font-semibold text-red-600 dark:text-red-400">
              Не больше {money(MAX_AMOUNT)} сомони за одну заявку
            </span>
          )}
        </label>

        <div className="space-y-2">
          <span className="text-[12.5px] font-semibold text-surface-500">Когда ездили</span>
          <div className="flex gap-1.5">
            {[[today, 'Сегодня'], [yesterday, 'Вчера']].map(([d, l]) => (
              <button key={d} type="button" aria-pressed={date === d} onClick={() => setDate(d)}
                className={clsx('flex-1 min-h-[44px] rounded-xl border text-[14px] font-semibold',
                  date === d ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300'
                    : 'border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-300')}>
                {l}
              </button>
            ))}
            <label className={clsx('flex-1 min-h-[44px] rounded-xl border text-[14px] font-semibold flex items-center justify-center relative',
              date !== today && date !== yesterday ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300'
                : 'border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-300')}>
              {date !== today && date !== yesterday ? dayText(date) : 'Другой день'}
              <input type="date" max={today} value={date} onChange={e => e.target.value && setDate(e.target.value)}
                onClick={openPicker}
                aria-label="Дата поездки" className="absolute inset-0 opacity-0 cursor-pointer" />
            </label>
          </div>
        </div>

        <label className="block space-y-2">
          <span className="text-[12.5px] font-semibold text-surface-500">Куда и зачем</span>
          <input value={note} onChange={e => setNote(e.target.value)} maxLength={300}
            placeholder="Например, офис → клиент, съёмка рилса" className="input min-h-[50px]" />
        </label>

        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => pickFile(e.target.files?.[0])} />
        {receipt ? (
          <div className="flex items-center gap-3 min-h-[52px] px-3 rounded-2xl border border-green-500/40 bg-green-500/5">
            <img src={receipt.preview} alt="Фото чека" className="w-10 h-10 rounded-lg object-cover" />
            <span className="flex-1 text-[13.5px] font-semibold text-green-700 dark:text-green-400">Фото чека прикреплено</span>
            <button type="button" aria-label="Убрать фото" onClick={() => setReceipt(null)}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-surface-500"><X size={18} /></button>
          </div>
        ) : (
          <button type="button" onClick={() => fileRef.current?.click()} disabled={preparing}
            className="w-full flex items-center gap-3 min-h-[52px] px-3.5 rounded-2xl border border-dashed border-surface-300 dark:border-surface-600 text-left text-surface-500">
            {preparing ? <Loader2 size={20} className="animate-spin" /> : <ImagePlus size={20} />}
            <span className="flex flex-col">
              <b className="text-[14px] text-surface-700 dark:text-surface-200">Фото чека или скриншот</b>
              <span className="text-[12px]">необязательно — подтверждение поездки</span>
            </span>
          </button>
        )}

        <button type="button" onClick={send} disabled={!ok} className="btn-primary w-full min-h-[54px] text-[16px] disabled:opacity-50">
          {busy ? 'Отправляю…' : sum > 0 ? `Отправить заявку · ${money(sum)} сомони` : 'Отправить заявку'}
        </button>
        <p className="text-center text-[12px] text-surface-500">Деньги вернёт руководство. Статус — в «Мои заявки».</p>
      </div>
    </Modal>
  )
}

const STATUS: Record<string, { cls: string }> = {
  pending: { cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  paid: { cls: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  rejected: { cls: 'bg-red-500/15 text-red-700 dark:text-red-400' },
}

function MineModal({ data, onClose }: { data: Mine; onClose: () => void }) {
  const qc = useQueryClient()
  async function cancel(id: string) {
    try {
      await transportApi.cancel(id)
      qc.invalidateQueries({ queryKey: ['transport-my'] })
      toast.success('Заявка отозвана')
    } catch (e) {
      toast.error(errText(e, 'Не удалось отозвать заявку'))
    }
  }
  return (
    <Modal open onClose={onClose} title="Мои заявки на транспорт" size="md">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] p-3">
            <div className="text-[12px] text-amber-700 dark:text-amber-400">Ждёт оплаты</div>
            <b className="text-[22px]">{money(data.pendingSum)} <span className="text-[13px] font-medium text-surface-500">сомони</span></b>
          </div>
          <div className="rounded-2xl border border-surface-200 dark:border-surface-700 p-3">
            <div className="text-[12px] text-surface-500">Вернули в этом месяце</div>
            <b className="text-[22px]">{money(data.paidMonthSum)} <span className="text-[13px] font-medium text-surface-500">сомони</span></b>
          </div>
        </div>
        <div className="space-y-2.5 max-h-[55vh] overflow-y-auto">
          {!data.items.length && <p className="py-6 text-center text-[13px] text-surface-500">Заявок пока нет</p>}
          {data.items.map(r => (
            <div key={r.id} className="rounded-2xl border border-surface-200 dark:border-surface-700 p-3 space-y-1.5">
              <div className="flex items-baseline gap-2">
                <b className="text-[15px]">{r.projectName || 'Проект'}</b>
                <span className="text-[12.5px] text-surface-500">{dayText(r.date)}</span>
                <b className="ml-auto text-[16px]">{money(r.amount)} с.</b>
              </div>
              {r.note && <div className="text-[13px] text-surface-600 dark:text-surface-300">{r.note}</div>}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={clsx('px-2.5 py-0.5 rounded-full text-[12px] font-semibold', STATUS[r.status]?.cls)}>
                  {r.status === 'pending' ? 'ждёт оплаты'
                    : r.status === 'paid' ? `оплачено ${r.decidedAt ? dayText(isoLocal(new Date(r.decidedAt))) : ''}`
                      : `отклонено${r.rejectReason ? `: «${r.rejectReason}»` : ''}`}
                </span>
                {r.receiptUrl && (
                  <a href={`${API}${r.receiptUrl}`} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-primary-600 dark:text-primary-400">чек</a>
                )}
                {r.status === 'pending' && (
                  <button type="button" onClick={() => cancel(r.id)} className="ml-auto text-[12.5px] font-semibold text-surface-500 min-h-[36px] px-2">Отозвать</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

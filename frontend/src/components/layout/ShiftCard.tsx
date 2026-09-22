// Карточка рабочей смены — то, что открывается по нажатию на счётчик.
//
// Одной кнопки мало: человек должен видеть, во сколько начал, сколько
// осталось до нормы, куда ушло время внутри дня и чем был перерыв. Здесь же
// живут действия, которые нельзя делать случайным тапом: перерыв с причиной,
// завершение дня и просьба поправить время.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Coffee, Car, User as UserIcon, Square, Play, Clock, X, Check, CalendarClock } from 'lucide-react'
import toast from 'react-hot-toast'
import { workShiftsApi } from '@/services/api.service'

/** «5 ч 46 м» из минут. */
export function fmtMin(min: number): string {
  const v = Math.max(0, Math.round(min || 0))
  const h = Math.floor(v / 60)
  const m = v % 60
  if (!h) return `${m} м`
  return m ? `${h} ч ${m} м` : `${h} ч`
}

type PauseKind = 'lunch' | 'work' | 'personal'

const PAUSE_META: Record<PauseKind, { label: string; hint: string; Icon: any }> = {
  lunch: { label: 'Обед', hint: 'до 60 минут идёт в часы', Icon: Coffee },
  work: { label: 'По работе — выехал', hint: 'съёмка, встреча, банк · идёт в часы', Icon: Car },
  personal: { label: 'Личное', hint: 'в часы не идёт', Icon: UserIcon },
}

export default function ShiftCard({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['work-shift-my'],
    queryFn: () => workShiftsApi.my(),
    refetchInterval: 60_000,
  })
  const month = useQuery({
    queryKey: ['work-shift-my-month'],
    queryFn: () => workShiftsApi.myMonth(),
  })

  const [pausing, setPausing] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [fixField, setFixField] = useState<'start' | 'end'>('start')
  const [fixTime, setFixTime] = useState('09:00')
  const [fixNote, setFixNote] = useState('')
  // «Приду позже» — предупредить заранее, чтобы опоздание не считалось.
  const [asking, setAsking] = useState(false)
  const [askDate, setAskDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1)
    return d.toLocaleDateString('en-CA')
  })
  const [askTime, setAskTime] = useState('11:00')
  const [askReason, setAskReason] = useState('')

  // Счётчик тикает сам, не дожидаясь следующего запроса.
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const act = useMutation({
    mutationFn: (a: { type: 'pause'; kind: PauseKind } | { type: 'stop' } | { type: 'start' }) =>
      a.type === 'pause' ? workShiftsApi.pause(a.kind)
        : a.type === 'stop' ? workShiftsApi.stop()
          : workShiftsApi.start(),
    onSuccess: (fresh: any) => { qc.setQueryData(['work-shift-my'], fresh); setPausing(false) },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['work-shift-my'] }) },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не получилось — попробуйте ещё раз'),
  })

  const notices = useQuery({
    queryKey: ['work-shift-my-notices'],
    queryFn: () => workShiftsApi.myNotices(),
  })
  const askMut = useMutation({
    mutationFn: () => workShiftsApi.createNotice({ date: askDate, time: askTime, reason: askReason || undefined }),
    onSuccess: () => {
      toast.success('Отправлено руководителю')
      setAsking(false); setAskReason('')
      qc.invalidateQueries({ queryKey: ['work-shift-my-notices'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось отправить'),
  })

  const editMut = useMutation({
    mutationFn: () => workShiftsApi.requestEdit({ field: fixField, time: fixTime, note: fixNote || undefined }),
    onSuccess: () => { toast.success('Отправлено руководителю'); setFixing(false); setFixNote('') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось отправить'),
  })

  const state: 'idle' | 'working' | 'paused' = data?.state ?? 'idle'
  const open = data?.open ?? null
  const normMin = data?.norm?.minutes ?? 480
  // Закрытые отрезки с сервера + идущий, который считаем сами.
  const liveMin = (data?.closedMinutes ?? 0) + (state === 'working' && open
    ? Math.max(0, Math.round((Date.now() - new Date(open.startedAt).getTime()) / 60000))
    : 0)
  const total = state === 'working' ? liveMin : (data?.todayMinutes ?? 0)
  const left = Math.max(0, normMin - total)
  const pct = Math.min(100, Math.round((total / normMin) * 100))
  const segments: any[] = data?.segments ?? []

  // Неделя: последние 7 дней текущего месяца из личного табеля.
  const days: Record<string, number> = month.data?.item?.days ?? {}
  const todayNum = Number((month.data?.today ?? '').slice(8, 10)) || new Date().getDate()
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = todayNum - 6 + i
    return { day: d, minutes: d > 0 ? (days[d] ?? 0) : 0, today: d === todayNum }
  })
  const weekTotal = week.reduce((s, d) => s + d.minutes, 0)
  const weekDiff = weekTotal - week.filter(d => d.minutes > 0).length * normMin

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col justify-end sm:items-center sm:justify-center bg-black/50 p-0 sm:p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 border-t sm:border border-gray-200 dark:border-gray-700 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-sm max-h-[92dvh] overflow-y-auto">

        <div className="sm:hidden py-2 flex justify-center">
          <span className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
        </div>

        <div className="px-5 pb-5 pt-1 sm:pt-5 flex flex-col gap-4">

          <div className="flex items-center gap-2">
            <span className="text-lg font-bold flex-1">Моя смена</span>
            <button onClick={onClose} aria-label="Закрыть" className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
              <X size={18} />
            </button>
          </div>

          {/* Состояние и счётчик */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5 text-[13px]">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${state === 'working' ? 'bg-emerald-500' : state === 'paused' ? 'bg-amber-500' : 'bg-gray-400'}`} />
              <span className="text-gray-600 dark:text-gray-300 flex-1 min-w-0 truncate">
                {state === 'working' && `Идёт с ${data?.dayStartedLabel ?? open?.startedLabel ?? '—'}`}
                {state === 'paused' && `${PAUSE_META[(data?.pauseKind as PauseKind) || 'personal'].label} с ${data?.pausedSince ?? '—'}`}
                {state === 'idle' && (total > 0 ? 'День завершён' : 'Смена не начата')}
              </span>
              {data?.isLate && (
                <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400">опоздание</span>
              )}
            </div>

            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-4xl font-bold tabular-nums tracking-tight">{fmtMin(total)}</span>
              <span className="text-[13px] text-gray-500 dark:text-gray-400">
                {left > 0 ? `до нормы ${fmtMin(normMin)} осталось ${fmtMin(left)}` : `норма ${fmtMin(normMin)} закрыта`}
              </span>
            </div>

            <div>
              <div className="h-2.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden flex">
                <span className={left > 0 ? 'bg-emerald-500' : 'bg-emerald-600'} style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-between mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                <span>{data?.norm?.start ?? '09:00'}</span>
                {(data?.paidBreakMinutes ?? 0) > 0 && <span>перерыв {fmtMin(data.paidBreakMinutes)} в зачёт</span>}
                <span>{data?.norm?.end ?? '18:00'}</span>
              </div>
            </div>
          </div>

          {/* Действия */}
          {state === 'idle' ? (
            <button disabled={act.isPending} onClick={() => act.mutate({ type: 'start' })}
              className="h-13 min-h-[52px] rounded-2xl bg-emerald-600 text-white text-[15px] font-bold flex items-center justify-center gap-2 disabled:opacity-60">
              <Play size={16} /> Начать работу
            </button>
          ) : pausing ? (
            <div className="flex flex-col gap-2">
              <span className="text-[13px] text-gray-500 dark:text-gray-400">Чем занят перерыв?</span>
              {(['lunch', 'work', 'personal'] as PauseKind[]).map(k => {
                const M = PAUSE_META[k]
                return (
                  <button key={k} disabled={act.isPending} onClick={() => act.mutate({ type: 'pause', kind: k })}
                    className="flex items-center gap-3 min-h-[58px] px-3.5 rounded-2xl border border-gray-200 dark:border-gray-700 text-left disabled:opacity-60">
                    <M.Icon size={18} className="shrink-0 text-gray-500 dark:text-gray-400" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold">{M.label}</span>
                      <span className="block text-[11.5px] text-gray-500 dark:text-gray-400">{M.hint}</span>
                    </span>
                  </button>
                )
              })}
              <button onClick={() => setPausing(false)} className="h-11 rounded-2xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-600 dark:text-gray-300">
                Отмена
              </button>
            </div>
          ) : (
            <div className="flex gap-2.5">
              {state === 'paused' ? (
                <button disabled={act.isPending} onClick={() => act.mutate({ type: 'start' })}
                  className="flex-1 min-h-[52px] rounded-2xl bg-emerald-600 text-white text-[15px] font-bold flex items-center justify-center gap-2 disabled:opacity-60">
                  <Play size={16} /> Продолжить
                </button>
              ) : (
                <button disabled={act.isPending} onClick={() => setPausing(true)}
                  className="flex-1 min-h-[52px] rounded-2xl border border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[15px] font-bold flex items-center justify-center gap-2 disabled:opacity-60">
                  <Coffee size={16} /> Перерыв
                </button>
              )}
              <button disabled={act.isPending} onClick={() => act.mutate({ type: 'stop' })}
                className="flex-1 min-h-[52px] rounded-2xl border border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400 text-[15px] font-bold flex items-center justify-center gap-2 disabled:opacity-60">
                <Square size={14} /> Завершить
              </button>
            </div>
          )}

          {/* Отрезки дня */}
          {segments.length > 0 && (
            <div className="flex flex-col">
              <span className="text-sm font-semibold mb-1">Сегодня по отрезкам</span>
              {segments.map((s, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${s.type === 'work' ? 'bg-emerald-500' : s.paid ? 'bg-amber-500' : 'bg-gray-400'}`} />
                  <span className="flex-1 min-w-0 text-[13px] text-gray-600 dark:text-gray-300 truncate">
                    {s.from} — {s.to ?? 'сейчас'}
                    {s.type === 'break' && ` · ${PAUSE_META[(s.kind as PauseKind) || 'personal'].label.toLowerCase()}`}
                  </span>
                  <span className={`text-[13px] tabular-nums shrink-0 ${s.type === 'work' || s.paid ? 'font-semibold' : 'text-gray-400 dark:text-gray-500'}`}>
                    {fmtMin(s.minutes)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Неделя */}
          {weekTotal > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">Неделя</span>
              <div className="flex gap-1.5 items-end h-16">
                {week.map(d => (
                  <span key={d.day} className="flex-1 flex flex-col items-center gap-1.5">
                    <span className={`w-full rounded-md ${d.minutes >= normMin ? 'bg-emerald-500' : d.minutes > 0 ? 'bg-emerald-500/50' : 'bg-gray-200 dark:bg-gray-800'}`}
                      style={{ height: `${Math.max(4, Math.min(48, Math.round((d.minutes / normMin) * 48)))}px` }} />
                    <span className={`text-[10px] ${d.today ? 'font-bold text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}`}>{d.day > 0 ? d.day : ''}</span>
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-gray-500 dark:text-gray-400">Отработано за неделю</span>
                <span className="font-bold tabular-nums">
                  {fmtMin(weekTotal)}
                  <span className={`ml-2 text-xs font-semibold ${weekDiff < 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                    {weekDiff < 0 ? `−${fmtMin(-weekDiff)}` : `+${fmtMin(weekDiff)}`}
                  </span>
                </span>
              </div>
            </div>
          )}

          {/* Приду позже — предупреждение заранее */}
          {asking ? (
            <div className="flex flex-col gap-2.5 pt-3 border-t border-gray-100 dark:border-gray-800">
              <span className="text-sm font-semibold">Приду позже</span>
              <span className="text-[12px] text-gray-500 dark:text-gray-400">
                Смена начинается в {data?.norm?.start ?? '09:00'}. Предупредите заранее — тогда опоздание не считается и штрафа не будет.
              </span>
              <div className="flex gap-2">
                <input type="date" value={askDate} onChange={e => setAskDate(e.target.value)}
                  className="flex-1 h-12 rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent px-3 text-[15px]" />
                <input type="time" value={askTime} onChange={e => setAskTime(e.target.value)}
                  className="w-[130px] h-12 rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent px-3 text-[15px]" />
              </div>
              <input value={askReason} onChange={e => setAskReason(e.target.value)} maxLength={300}
                placeholder="Причина — например, съёмка у клиента"
                className="h-12 rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent px-3 text-sm" />
              <div className="flex gap-2">
                <button disabled={askMut.isPending} onClick={() => askMut.mutate()}
                  className="flex-1 min-h-[48px] rounded-xl bg-primary-600 text-white text-sm font-bold disabled:opacity-60">Отправить</button>
                <button onClick={() => setAsking(false)}
                  className="flex-1 min-h-[48px] rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-600 dark:text-gray-300">Отмена</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAsking(true)}
              className="min-h-[46px] rounded-2xl border border-gray-200 dark:border-gray-700 text-[13px] text-gray-500 dark:text-gray-400 flex items-center justify-center gap-2">
              <CalendarClock size={15} /> Приду позже — предупредить заранее
            </button>
          )}

          {(notices.data ?? []).length > 0 && (
            <div className="flex flex-col">
              <span className="text-sm font-semibold mb-1">Мои просьбы</span>
              {(notices.data as any[]).slice(0, 4).map(n => (
                <div key={n.id} className="flex items-center gap-3 py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${n.status === 'approved' ? 'bg-emerald-500' : n.status === 'rejected' ? 'bg-red-500' : 'bg-amber-500'}`} />
                  <span className="flex-1 min-w-0 text-[13px] text-gray-600 dark:text-gray-300 truncate">
                    {n.date.slice(8, 10)}.{n.date.slice(5, 7)} · приду в {n.plannedTime}
                    {n.reason ? ` · ${n.reason}` : ''}
                  </span>
                  <span className={`text-[11px] font-semibold shrink-0 ${n.status === 'approved' ? 'text-emerald-500' : n.status === 'rejected' ? 'text-red-500' : 'text-amber-500'}`}>
                    {n.status === 'approved' ? 'одобрено' : n.status === 'rejected' ? 'отказано' : 'ждёт ответа'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Забыл нажать */}
          {fixing ? (
            <div className="flex flex-col gap-2.5 pt-1 border-t border-gray-100 dark:border-gray-800">
              <span className="text-sm font-semibold mt-3">Поправить время</span>
              <span className="text-[12px] text-gray-500 dark:text-gray-400">
                Правку увидит руководитель. Пока он не подтвердит, в табеле останется прежнее время.
              </span>
              <div className="flex gap-2">
                {(['start', 'end'] as const).map(f => (
                  <button key={f} onClick={() => setFixField(f)}
                    className={`flex-1 h-11 rounded-xl border text-sm font-semibold ${fixField === f
                      ? 'border-primary-500 text-primary-600 dark:text-primary-400 bg-primary-500/10'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}>
                    {f === 'start' ? 'Начало' : 'Конец'}
                  </button>
                ))}
              </div>
              <input type="time" value={fixTime} onChange={e => setFixTime(e.target.value)}
                className="h-12 rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent px-3 text-[15px]" />
              <input value={fixNote} onChange={e => setFixNote(e.target.value)} maxLength={300}
                placeholder="Почему не отметил — необязательно"
                className="h-12 rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent px-3 text-sm" />
              <div className="flex gap-2">
                <button disabled={editMut.isPending} onClick={() => editMut.mutate()}
                  className="flex-1 min-h-[48px] rounded-xl bg-primary-600 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60">
                  <Check size={16} /> Отправить
                </button>
                <button onClick={() => setFixing(false)} className="flex-1 min-h-[48px] rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-600 dark:text-gray-300">
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setFixing(true)}
              className="min-h-[46px] rounded-2xl border border-gray-200 dark:border-gray-700 text-[13px] text-gray-500 dark:text-gray-400 flex items-center justify-center gap-2">
              <Clock size={15} /> Забыл отметить — поправить время
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Вкладка «График работы»: одно правило вместо одиннадцати одинаковых строк.
//
// Сначала здесь была таблица на 7 колонок, где у всех стояло одно и то же:
// 09:00 · 18:00 · 8 ч · 30 мин · пн–сб — пятьдесят пять одинаковых значений
// и ни одного сигнала. Потом — три карточки высотой в 880 px. Теперь всё
// умещается в 560: общий график строкой, ниже один список, где сверху те,
// кто работает иначе, а под чертой остальные именами.
//
// График действует С ДАТЫ: прошлые дни считаются по графику того дня,
// поэтому правка сентябрём не переписывает августовские опоздания.
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, X, Check, ChevronRight, MoreHorizontal } from 'lucide-react'
import toast from 'react-hot-toast'
import { workShiftsApi } from '@/services/api.service'
import { getRoleLabel } from '@/lib/permissions'
import { useAuthStore } from '@/store/auth.store'

const DAYS = [['1', 'пн'], ['2', 'вт'], ['3', 'ср'], ['4', 'чт'], ['5', 'пт'], ['6', 'сб'], ['7', 'вс']] as const
const GRACE = [0, 15, 30, 60]

/** «480» превращаем в «8 ч», «450» — в «7 ч 30 мин». Минуты в поле ввода
 *  человеку показывать незачем: он мыслит часами. */
const hoursLabel = (min: number) => {
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} ч ${m} мин` : `${h} ч`
}
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const addMin = (t: string, add: number) => {
  const x = (toMin(t) + add + 24 * 60) % (24 * 60)
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`
}
/** Норма = смена минус час обеда, но только у полного дня: в смене
 *  13:30–18:30 обеда нет. То же правило, что на сервере. */
const normOf = (start: string, end: string) => {
  const span = (toMin(end) - toMin(start) + 24 * 60) % (24 * 60)
  return Math.max(0, span >= 7 * 60 ? span - 60 : span)
}
const daysLabel = (workdays: string) => {
  const set = String(workdays).split(',').filter(Boolean)
  const names = DAYS.filter(([d]) => set.includes(d)).map(([, l]) => l)
  if (!names.length) return 'нет рабочих дней'
  // Подряд идущие дни пишем диапазоном: «пн — сб» вместо семи пилюль.
  const nums = set.map(Number).sort((a, b) => a - b)
  const solid = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1)
  return solid && names.length > 2 ? `${names[0]} — ${names[names.length - 1]}` : names.join(', ')
}
const dateLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
/** Отчество в списке ни к чему — от него строки расползаются на полэкрана. */
const shortName = (name: string) => String(name).trim().split(/\s+/).slice(0, 2).join(' ')

type Draft = {
  startTime: string
  endTime: string
  graceMinutes: number
  workdays: string[]
  floating: boolean
  normMinutes: number | null
  validFrom: string
  alsoUserIds: string[]
}

export default function ShiftSchedules() {
  const qc = useQueryClient()
  const role = useAuthStore(s => s.user?.role)
  const canSettings = role === 'founder'
  const { data, isLoading } = useQuery({
    queryKey: ['work-shift-schedules'],
    queryFn: () => workShiftsApi.schedules(),
  })

  // Кого правим: конкретный человек, общий график компании или никто.
  const [editing, setEditing] = useState<{ id: string | null; name: string; role?: string } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const done = () => {
    setEditing(null)
    setDraft(null)
    qc.invalidateQueries({ queryKey: ['work-shift-schedules'] })
    qc.invalidateQueries({ queryKey: ['work-shifts-team'] })
    qc.invalidateQueries({ queryKey: ['work-shifts-month'] })
    // Порог опоздания изменился — список штрафов за сегодня уже другой.
    qc.invalidateQueries({ queryKey: ['late-fines'] })
  }
  const fail = (e: any) => toast.error(e?.response?.data?.message || 'Не удалось сохранить')

  const save = useMutation({
    mutationFn: ({ userId, body }: { userId: string | null; body: any }) =>
      userId === null ? workShiftsApi.setCompanySchedule(body) : workShiftsApi.setSchedule(userId, body),
    onSuccess: (r: any) => {
      toast.success(r?.applied > 1 ? `График сохранён · ${r.applied} чел.` : 'График сохранён')
      done()
    },
    onError: fail,
  })
  const reset = useMutation({
    mutationFn: (userId: string) => workShiftsApi.resetSchedule(userId, {}),
    onSuccess: () => { toast.success('Снова по общему графику'); done() },
    onError: fail,
  })
  const saveSettings = useMutation({
    mutationFn: (body: any) => workShiftsApi.setShiftSettings(body),
    onSuccess: () => { toast.success('Настройки сохранены'); qc.invalidateQueries({ queryKey: ['work-shift-schedules'] }) },
    onError: fail,
  })

  const items: any[] = data?.items ?? []
  const company = data?.company
  const st = data?.settings
  const today: string = data?.today ?? new Date().toLocaleDateString('en-CA')
  const own = items.filter(u => u.custom)
  const common = items.filter(u => !u.custom)

  const open = (target: { id: string | null; name: string; role?: string }, src: any) => {
    setEditing(target)
    setDraft({
      startTime: src?.startTime ?? '09:00',
      endTime: src?.endTime ?? '18:00',
      graceMinutes: Number(src?.graceMinutes ?? 30),
      workdays: String(src?.workdays ?? '1,2,3,4,5,6').split(',').filter(Boolean),
      floating: !!src?.floating,
      normMinutes: null,
      validFrom: today,
      alsoUserIds: [],
    })
  }
  const patch = (p: Partial<Draft>) => setDraft(d => (d ? { ...d, ...p } : d))

  if (isLoading) return <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-gray-400" /></div>

  const norm = draft ? (draft.normMinutes ?? normOf(draft.startTime, draft.endTime)) : 0

  return (
    <div className="flex flex-col gap-3">

      {/* ── Авто-штраф: одна строка. Подробности — только когда он работает ── */}
      {canSettings && st && (
        <div className="card !py-3 flex items-center gap-3">
          <button type="button" role="switch" aria-checked={!!st.autoFine}
            onClick={() => saveSettings.mutate({ autoFine: !st.autoFine })}
            className={`w-11 h-6 rounded-full relative shrink-0 transition-colors ${st.autoFine ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-700'}`}>
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${st.autoFine ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold">
              Авто-штраф за опоздание {st.autoFine ? 'включён' : 'выключен'}
            </div>
            <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
              {st.autoFine
                ? `${Number(st.fineAmount)} сомони · итог дня в ${String(st.runHour).padStart(2, '0')}:00${st.noticeDaysBefore > 0 ? ` · не штрафует, если предупредили за ${st.noticeDaysBefore} дн.` : ''}`
                : 'опоздания видно, но деньги не удерживаются'}
            </div>
          </div>
          <button onClick={() => setSettingsOpen(true)} aria-label="Настроить авто-штраф"
            className="h-9 px-3.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-300 shrink-0">
            <span className="hidden sm:inline">Настроить</span>
            <MoreHorizontal className="w-4 h-4 sm:hidden" />
          </button>
        </div>
      )}

      {/* ── Общий график — одна строка ──────────────────────────────────── */}
      {company && (
        <div className="card !py-3.5">
          <div className="flex items-center gap-3 sm:gap-4">
            <span className="hidden md:block w-[116px] shrink-0 text-[11px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500">
              Общий график
            </span>
            <span className="flex items-baseline gap-1.5 shrink-0">
              <span className="text-[17px] font-bold tabular-nums">{company.startTime}</span>
              <span className="text-gray-400 text-xs">→</span>
              <span className="text-[17px] font-bold tabular-nums">{company.endTime}</span>
            </span>
            <span className="hidden sm:block flex-1 min-w-0 text-[12.5px] text-gray-500 dark:text-gray-400 truncate">
              {hoursLabel(company.normMinutes)} · без опоздания до {addMin(company.startTime, company.graceMinutes)} · {daysLabel(company.workdays)}
            </span>
            <span className="sm:hidden flex-1" />
            {canSettings && (
              <button onClick={() => open({ id: null, name: 'Общий график компании' }, company)}
                className="h-8 px-3.5 shrink-0 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold">
                Изменить
              </button>
            )}
          </div>
          {/* На телефоне подробности переносим под время, чтобы не резать. */}
          <div className="sm:hidden mt-1.5 text-[11.5px] text-gray-500 dark:text-gray-400">
            {hoursLabel(company.normMinutes)} · без опоздания до {addMin(company.startTime, company.graceMinutes)} · {daysLabel(company.workdays)}
          </div>
          {!!company.upcoming?.length && (
            <div className="mt-2 text-[11.5px] text-amber-600 dark:text-amber-400">
              с {dateLabel(company.upcoming[0].validFrom)} — {company.upcoming[0].startTime}–{company.upcoming[0].endTime}
            </div>
          )}
        </div>
      )}

      {/* ── Один список: сверху отличия, под чертой остальные ───────────── */}
      <div className="card !pt-0">
        <div className="py-3 text-[11px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-800">
          Работают иначе · {own.length}
        </div>

        {!own.length ? (
          <p className="py-4 text-[12.5px] text-gray-500 dark:text-gray-400">
            У всех одинаковое время. Нажмите на имя ниже, чтобы задать кому-то своё.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-800">
            {own.map(u => (
              <button key={u.id} onClick={() => open({ id: u.id, name: u.name, role: u.role }, u)}
                className="py-3 text-left flex items-center gap-3 sm:gap-4 group">
                <span className="min-w-0 flex-1 sm:flex-none sm:w-[230px]">
                  <span className="block text-[13.5px] font-semibold truncate">{shortName(u.name)}</span>
                  <span className="block text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    <span className="sm:hidden">
                      {u.floating ? 'свободное начало' : `${hoursLabel(u.normMinutes)} · до ${addMin(u.startTime, u.graceMinutes)}`}
                      {' · '}{daysLabel(u.workdays)}
                    </span>
                    <span className="hidden sm:inline">{getRoleLabel(u.role)}</span>
                  </span>
                </span>
                <span className="shrink-0 text-[13.5px] sm:text-[14.5px] font-semibold tabular-nums text-primary-600 dark:text-primary-400 whitespace-nowrap">
                  {u.floating
                    ? <span className="text-amber-600 dark:text-amber-400">свободное начало</span>
                    : <>{u.startTime} <span className="text-gray-400 font-normal">→</span> {u.endTime}</>}
                </span>
                <span className="hidden sm:block flex-1 min-w-0 text-[12px] text-gray-500 dark:text-gray-400 truncate">
                  {hoursLabel(u.normMinutes)}
                  {u.floating ? ' · опоздания не считаются' : ` · без опоздания до ${addMin(u.startTime, u.graceMinutes)}`}
                  {' · '}{daysLabel(u.workdays)}
                  {!!u.upcoming?.length && ` · с ${dateLabel(u.upcoming[0].validFrom)} другой`}
                </span>
                <ChevronRight className="w-4 h-4 shrink-0 text-gray-300 dark:text-gray-600 group-hover:text-gray-500" />
              </button>
            ))}
          </div>
        )}

        {!!common.length && (
          <>
            <div className="pt-4 pb-2.5 text-[11px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-800 mt-1">
              Остальные {common.length} — по общему
              <span className="hidden sm:inline normal-case tracking-normal font-normal text-gray-400 dark:text-gray-500 ml-2.5">
                нажмите на имя, чтобы задать свой
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {common.map(u => (
                <button key={u.id} onClick={() => open({ id: u.id, name: u.name, role: u.role }, u)}
                  className="h-8 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] text-gray-600 dark:text-gray-300 hover:border-primary-400">
                  {shortName(u.name)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Шторка правки ───────────────────────────────────────────────── */}
      {editing && draft && (
        <Sheet title={editing.id === null ? editing.name : shortName(editing.name)}
          subtitle={editing.role ? getRoleLabel(editing.role) : 'по нему живут все, кому личный не задавали'}
          onClose={() => { setEditing(null); setDraft(null) }}>

          <Block title="Смена">
            <div className="flex items-end gap-2.5">
              <label className="flex-1">
                <span className="block text-[11.5px] text-gray-500 dark:text-gray-400 mb-1.5">Начало</span>
                <input type="time" value={draft.startTime} disabled={draft.floating}
                  onChange={e => patch({ startTime: e.target.value })}
                  className="w-full h-12 px-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent text-[17px] font-semibold tabular-nums disabled:opacity-40" />
              </label>
              <span className="pb-3.5 text-gray-400">→</span>
              <label className="flex-1">
                <span className="block text-[11.5px] text-gray-500 dark:text-gray-400 mb-1.5">Конец</span>
                <input type="time" value={draft.endTime}
                  onChange={e => patch({ endTime: e.target.value })}
                  className="w-full h-12 px-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent text-[17px] font-semibold tabular-nums" />
              </label>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className="text-gray-500 dark:text-gray-400">Норма за день</span>
              <span className="font-semibold">{hoursLabel(norm)}</span>
              {draft.normMinutes === null ? (
                <>
                  <button onClick={() => patch({ normMinutes: normOf(draft.startTime, draft.endTime) })}
                    className="text-[11.5px] text-primary-600 dark:text-primary-400">задать вручную</button>
                  <span className="text-[11.5px] text-gray-400 dark:text-gray-500">
                    {normOf(draft.startTime, draft.endTime) === (toMin(draft.endTime) - toMin(draft.startTime) + 1440) % 1440
                      ? 'вся смена, обед не вычитается'
                      : 'смена минус час обеда'}
                  </span>
                </>
              ) : (
                <>
                  <input type="number" min={0} max={16} step={0.5}
                    value={Math.round(draft.normMinutes / 6) / 10}
                    onChange={e => patch({ normMinutes: Math.round(Number(e.target.value) * 60) })}
                    className="w-20 h-8 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent tabular-nums" />
                  <span className="text-gray-500 dark:text-gray-400">ч</span>
                  <button onClick={() => patch({ normMinutes: null })}
                    className="text-[11.5px] text-primary-600 dark:text-primary-400">считать самой</button>
                </>
              )}
            </div>
          </Block>

          <Block title="Опоздание считать после">
            <div className="flex gap-2">
              {GRACE.map(g => (
                <button key={g} onClick={() => patch({ graceMinutes: g })} disabled={draft.floating}
                  aria-pressed={draft.graceMinutes === g}
                  className={`flex-1 h-10 rounded-xl text-[12.5px] font-semibold border disabled:opacity-40 ${draft.graceMinutes === g
                    ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
                    : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'}`}>
                  {g === 0 ? 'сразу' : `+${g} мин`}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-gray-500 dark:text-gray-400">
              {draft.floating
                ? 'У смены без фиксированного начала опозданий не бывает.'
                : <>Опоздавшим считается приход после <b className="text-gray-700 dark:text-gray-200">{addMin(draft.startTime, draft.graceMinutes)}</b>.</>}
            </p>
          </Block>

          <Block title="Рабочие дни">
            <div className="flex gap-1.5">
              {DAYS.map(([d, label]) => {
                const on = draft.workdays.includes(d)
                return (
                  <button key={d} aria-pressed={on}
                    onClick={() => patch({ workdays: on ? draft.workdays.filter(x => x !== d) : [...draft.workdays, d] })}
                    className={`flex-1 h-10 rounded-xl text-[12.5px] font-semibold border ${on
                      ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
                      : 'border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500'}`}>
                    {label}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-[12px] text-gray-500 dark:text-gray-400">
              В нерабочий день человека не ждут и не штрафуют.
            </p>
          </Block>

          <button onClick={() => patch({ floating: !draft.floating })}
            className="w-full text-left flex items-start gap-3 rounded-xl border border-gray-200 dark:border-gray-700 p-3.5">
            <span role="switch" aria-checked={draft.floating}
              className={`w-11 h-6 rounded-full relative shrink-0 mt-0.5 transition-colors ${draft.floating ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-700'}`}>
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${draft.floating ? 'left-[22px]' : 'left-0.5'}`} />
            </span>
            <span>
              <span className="block text-[13px] font-semibold">Свободное начало</span>
              <span className="block text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                Приходит когда удобно: опоздания не считаются и штраф не начисляется. Норма за день остаётся.
              </span>
            </span>
          </button>

          {editing.id !== null && (
            <Block title="Применить ещё к">
              <div className="flex flex-wrap gap-2">
                {draft.alsoUserIds.map(id => {
                  const u = items.find(x => x.id === id)
                  return (
                    <button key={id} onClick={() => patch({ alsoUserIds: draft.alsoUserIds.filter(x => x !== id) })}
                      className="h-8 px-3 rounded-lg border border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400 text-[12px] flex items-center gap-1.5">
                      {shortName(u?.name ?? '—')} <X className="w-3 h-3" />
                    </button>
                  )
                })}
                <select value="" onChange={e => { if (e.target.value) patch({ alsoUserIds: [...draft.alsoUserIds, e.target.value] }) }}
                  className="h-8 px-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-transparent text-sm text-gray-500 dark:text-gray-400">
                  <option value="">+ добавить</option>
                  {items
                    .filter(u => u.id !== editing.id && !draft.alsoUserIds.includes(u.id))
                    .map(u => <option key={u.id} value={u.id}>{shortName(u.name)}</option>)}
                </select>
              </div>
            </Block>
          )}

          <label className="flex flex-wrap items-center gap-2 text-[12px] text-gray-500 dark:text-gray-400">
            Начнёт действовать с
            <input type="date" value={draft.validFrom} min={today}
              onChange={e => patch({ validFrom: e.target.value || today })}
              className="h-9 px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent text-gray-700 dark:text-gray-200" />
            <span className="w-full text-[11.5px]">Прошлые дни в табеле не пересчитываются.</span>
          </label>

          <div className="flex items-center gap-2 pt-1">
            {editing.id !== null && (
              <button onClick={() => reset.mutate(editing.id as string)} disabled={reset.isPending}
                className="h-11 px-3.5 rounded-xl text-[12.5px] text-gray-500 dark:text-gray-400 border border-gray-100 dark:border-gray-800">
                Сбросить к общему
              </button>
            )}
            <div className="flex-1" />
            <button onClick={() => { setEditing(null); setDraft(null) }}
              className="h-11 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-[13px] font-semibold">
              Отмена
            </button>
            <button disabled={save.isPending}
              onClick={() => save.mutate({
                userId: editing.id,
                body: {
                  startTime: draft.startTime,
                  endTime: draft.endTime,
                  graceMinutes: draft.graceMinutes,
                  workdays: draft.workdays.join(','),
                  floating: draft.floating,
                  normMinutes: draft.normMinutes,
                  validFrom: draft.validFrom,
                  alsoUserIds: draft.alsoUserIds,
                },
              })}
              className="h-11 px-6 rounded-xl bg-primary-600 text-white text-[13px] font-semibold disabled:opacity-60 flex items-center gap-1.5">
              {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Сохранить
            </button>
          </div>
        </Sheet>
      )}

      {/* ── Настройки авто-штрафа ───────────────────────────────────────── */}
      {settingsOpen && st && (
        <Sheet title="Авто-штраф за опоздание" subtitle="когда и на сколько" onClose={() => setSettingsOpen(false)}>
          <Field label="Сумма штрафа" suffix="сомони" value={Number(st.fineAmount)} min={0}
            onSave={v => saveSettings.mutate({ fineAmount: v })} />
          <Field label="Подводить итог дня" suffix="часов" value={st.runHour} min={0} max={23}
            onSave={v => saveSettings.mutate({ runHour: v })} />
          <Field label="Предупреждать заранее" suffix="дней" value={st.noticeDaysBefore} min={0} max={7}
            onSave={v => saveSettings.mutate({ noticeDaysBefore: v })} />
          <p className="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed">
            Штраф не ставится, если на день есть одобренная просьба «приду позже», отмечен отгул или у человека смена
            без фиксированного начала. Всё проведённое остаётся отменяемым в «Сменах сегодня».
          </p>
          <button onClick={() => setSettingsOpen(false)}
            className="h-11 rounded-xl bg-primary-600 text-white text-[13px] font-semibold">Готово</button>
        </Sheet>
      )}
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide font-semibold text-gray-400 dark:text-gray-500 mb-2.5">{title}</div>
      {children}
    </div>
  )
}

function Field({ label, suffix, value, min, max, onSave }:
  { label: string; suffix: string; value: number; min?: number; max?: number; onSave: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3">
      <span className="flex-1 text-[13px]">{label}</span>
      <input type="number" min={min} max={max} defaultValue={value}
        onBlur={e => { const v = Number(e.target.value); if (v !== value) onSave(v) }}
        className="w-24 h-10 px-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent tabular-nums text-right" />
      <span className="w-16 text-[12px] text-gray-500 dark:text-gray-400">{suffix}</span>
    </label>
  )
}

/** Снизу на телефоне, по центру на компьютере — как карточка смены. */
function Sheet({ title, subtitle, onClose, children }:
  { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end sm:items-center sm:justify-center bg-black/50 p-0 sm:p-4"
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 border-t sm:border border-gray-200 dark:border-gray-700 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md max-h-[92dvh] overflow-y-auto">
        <div className="sm:hidden py-2 flex justify-center">
          <span className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
        </div>
        <div className="px-5 pb-5 pt-1 sm:pt-5 flex flex-col gap-5">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-bold truncate">{title}</div>
              {subtitle && <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">{subtitle}</div>}
            </div>
            <button onClick={onClose} aria-label="Закрыть"
              className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
              <X className="w-4 h-4" />
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

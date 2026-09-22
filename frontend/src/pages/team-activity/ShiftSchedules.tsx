// Вкладка «График работы»: у каждого своё время смены.
//
// Общий порог 09:30 не годился: монтажёр выходит после обеда и был
// «опоздавшим» каждый день, а у руководителя видеографии выездные съёмки и
// фиксированного начала нет вовсе. Поэтому опоздание считается от начала
// ЕГО смены плюс допуск, а «плавающим» не считается совсем.
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { workShiftsApi } from '@/services/api.service'
import { getRoleLabel } from '@/lib/permissions'
import { useAuthStore } from '@/store/auth.store'

const DAYS = [['1', 'пн'], ['2', 'вт'], ['3', 'ср'], ['4', 'чт'], ['5', 'пт'], ['6', 'сб'], ['7', 'вс']] as const

export default function ShiftSchedules() {
  const qc = useQueryClient()
  const role = useAuthStore(s => s.user?.role)
  const canSettings = role === 'founder' || role === 'co_founder'
  const { data, isLoading } = useQuery({
    queryKey: ['work-shift-schedules'],
    queryFn: () => workShiftsApi.schedules(),
  })
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<any>({})

  const save = useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: any }) => workShiftsApi.setSchedule(userId, body),
    onSuccess: () => {
      toast.success('График сохранён')
      setEditing(null)
      qc.invalidateQueries({ queryKey: ['work-shift-schedules'] })
      qc.invalidateQueries({ queryKey: ['work-shifts-team'] })
      qc.invalidateQueries({ queryKey: ['work-shifts-month'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось сохранить'),
  })
  const saveSettings = useMutation({
    mutationFn: (body: any) => workShiftsApi.setShiftSettings(body),
    onSuccess: () => { toast.success('Настройки сохранены'); qc.invalidateQueries({ queryKey: ['work-shift-schedules'] }) },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось сохранить'),
  })

  const items: any[] = data?.items ?? []
  const st = data?.settings

  const start = (u: any) => {
    setEditing(u.id)
    setDraft({
      startTime: u.startTime, endTime: u.endTime,
      normMinutes: u.normMinutes, graceMinutes: u.graceMinutes,
      workdays: String(u.workdays).split(','), floating: !!u.floating,
    })
  }
  const toggleDay = (d: string) => setDraft((p: any) => ({
    ...p,
    workdays: p.workdays.includes(d) ? p.workdays.filter((x: string) => x !== d) : [...p.workdays, d],
  }))

  if (isLoading) return <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-gray-400" /></div>

  return (
    <div className="flex flex-col gap-4">

      {canSettings && st && (
        <div className="card">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={!!st.autoFine}
                onChange={e => saveSettings.mutate({ autoFine: e.target.checked })}
                className="w-[18px] h-[18px] accent-primary-600" />
              <span className="text-sm font-semibold">Штрафовать за опоздание автоматически</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              Сумма
              <input type="number" min={0} defaultValue={Number(st.fineAmount)} onBlur={e => saveSettings.mutate({ fineAmount: Number(e.target.value) })}
                className="w-24 h-9 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent tabular-nums" />
              с.
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              Подводить итог в
              <input type="number" min={0} max={23} defaultValue={st.runHour} onBlur={e => saveSettings.mutate({ runHour: Number(e.target.value) })}
                className="w-16 h-9 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent tabular-nums" />
              ч.
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              Предупреждать за
              <input type="number" min={0} max={7} defaultValue={st.noticeDaysBefore} onBlur={e => saveSettings.mutate({ noticeDaysBefore: Number(e.target.value) })}
                className="w-16 h-9 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent tabular-nums" />
              дн.
            </label>
          </div>
          <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-2.5">
            Штраф не ставится, если на день есть одобренная просьба «приду позже», отмечен отгул или у человека смена без фиксированного начала. Всё проведённое остаётся отменяемым в «Сменах сегодня».
          </p>
        </div>
      )}

      <div className="card">
        <div className="flex items-baseline gap-3 mb-3">
          <h3 className="section-title">У каждого своё время</h3>
          <span className="text-xs text-gray-500 dark:text-gray-400">опоздание считается от начала смены плюс допуск</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                <th className="text-left font-semibold pb-2">Сотрудник</th>
                <th className="text-left font-semibold pb-2 w-[120px]">Начало</th>
                <th className="text-left font-semibold pb-2 w-[120px]">Конец</th>
                <th className="text-left font-semibold pb-2 w-[110px]">Норма</th>
                <th className="text-left font-semibold pb-2 w-[110px]">Допуск</th>
                <th className="text-left font-semibold pb-2">Рабочие дни</th>
                <th className="pb-2 w-[110px]" />
              </tr>
            </thead>
            <tbody>
              {items.map(u => {
                const edit = editing === u.id
                return (
                  <tr key={u.id} className="border-t border-gray-100 dark:border-gray-800 align-middle">
                    <td className="py-2.5 pr-3">
                      <div className="text-[13.5px] font-semibold truncate">{u.name}</div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                        {getRoleLabel(u.role)}{!u.custom && ' · общий график'}
                      </div>
                    </td>
                    {edit ? (
                      <>
                        <td className="py-2 pr-2">
                          <input type="time" value={draft.startTime} disabled={draft.floating}
                            onChange={e => setDraft((p: any) => ({ ...p, startTime: e.target.value }))}
                            className="w-[104px] h-9 px-2 rounded-lg border border-primary-500 bg-transparent disabled:opacity-40" />
                        </td>
                        <td className="py-2 pr-2">
                          <input type="time" value={draft.endTime}
                            onChange={e => setDraft((p: any) => ({ ...p, endTime: e.target.value }))}
                            className="w-[104px] h-9 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent" />
                        </td>
                        <td className="py-2 pr-2">
                          <input type="number" min={0} max={960} step={30} value={draft.normMinutes}
                            onChange={e => setDraft((p: any) => ({ ...p, normMinutes: Number(e.target.value) }))}
                            className="w-[92px] h-9 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent tabular-nums" />
                        </td>
                        <td className="py-2 pr-2">
                          <input type="number" min={0} max={240} step={5} value={draft.graceMinutes} disabled={draft.floating}
                            onChange={e => setDraft((p: any) => ({ ...p, graceMinutes: Number(e.target.value) }))}
                            className="w-[92px] h-9 px-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent tabular-nums disabled:opacity-40" />
                        </td>
                        <td className="py-2 pr-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {DAYS.map(([d, label]) => (
                              <button key={d} type="button" onClick={() => toggleDay(d)}
                                className={`w-8 h-8 rounded-lg text-[11px] font-semibold ${draft.workdays.includes(d)
                                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'}`}>
                                {label}
                              </button>
                            ))}
                            <label className="flex items-center gap-1.5 ml-2 text-[11.5px] text-gray-600 dark:text-gray-300 cursor-pointer">
                              <input type="checkbox" checked={draft.floating}
                                onChange={e => setDraft((p: any) => ({ ...p, floating: e.target.checked }))}
                                className="w-4 h-4 accent-primary-600" />
                              без фиксированного начала
                            </label>
                          </div>
                        </td>
                        <td className="py-2">
                          <div className="flex gap-1.5 justify-end">
                            <button disabled={save.isPending}
                              onClick={() => save.mutate({ userId: u.id, body: { ...draft, workdays: draft.workdays.join(',') } })}
                              className="h-9 px-3 rounded-lg bg-primary-600 text-white text-xs font-semibold disabled:opacity-60">Сохранить</button>
                            <button onClick={() => setEditing(null)}
                              className="h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-300">Отмена</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-2.5 tabular-nums font-semibold">
                          {u.floating ? <span className="text-gray-400 dark:text-gray-500 font-normal">свободное</span> : u.startTime}
                        </td>
                        <td className="py-2.5 tabular-nums text-gray-600 dark:text-gray-300">{u.endTime}</td>
                        <td className="py-2.5 text-gray-600 dark:text-gray-300">{Math.round(u.normMinutes / 60 * 10) / 10} ч</td>
                        <td className="py-2.5 text-gray-600 dark:text-gray-300">
                          {u.floating ? '—' : `${u.graceMinutes} мин`}
                        </td>
                        <td className="py-2.5">
                          <div className="flex gap-1">
                            {DAYS.map(([d, label]) => (
                              <span key={d}
                                className={`w-7 h-7 rounded-md text-[10px] font-semibold flex items-center justify-center ${String(u.workdays).split(',').includes(d)
                                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                  : 'bg-gray-100 dark:bg-gray-800 text-gray-300 dark:text-gray-600'}`}>
                                {label}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 text-right">
                          <button onClick={() => start(u)}
                            className="h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-300">
                            Изменить
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-3">
          «Без фиксированного начала» — для тех, у кого нет постоянного времени выхода (выездные съёмки): опоздания им не считаются и штрафы не начисляются.
        </p>
      </div>
    </div>
  )
}

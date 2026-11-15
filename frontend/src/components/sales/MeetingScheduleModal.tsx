import { useState } from 'react'
import toast from 'react-hot-toast'
import { Modal } from '@/components/ui'
import type { SalesLead } from '@/types/sales'
import { useLastValue, useLeadUpdate } from './salesHooks'
import { dateInput, daysFromNow, joinLocal, splitLocal } from './leadUtils'

/**
 * Назначить / перенести встречу (15.11.2026): дата и время → nextContactAt.
 * Сервер пишет событие «встреча назначена», сбрасывает итог прошлой
 * встречи и ставит напоминание. В KPI встреча попадёт, только когда её
 * отметят «состоялась».
 */
export default function MeetingScheduleModal({ lead, onClose }: {
  lead: Pick<SalesLead, 'id' | 'name' | 'nextContactAt'> | null
  onClose: () => void
}) {
  const shown = useLastValue(lead)
  return (
    <Modal open={!!lead} onClose={onClose} title={shown?.nextContactAt ? 'Перенести встречу' : 'Назначить встречу'} size="sm">
      {shown && <ScheduleForm key={shown.id} lead={shown} onClose={onClose} />}
    </Modal>
  )
}

function ScheduleForm({ lead, onClose }: {
  lead: Pick<SalesLead, 'id' | 'name' | 'nextContactAt'>
  onClose: () => void
}) {
  const cur = splitLocal(lead.nextContactAt)
  const [date, setDate] = useState(cur.date || dateInput(daysFromNow(1)))
  const [time, setTime] = useState(cur.time || '11:00')
  const update = useLeadUpdate()
  const iso = joinLocal(date, time)

  const save = (value: string | null, text: string) =>
    update.mutate({ id: lead.id, data: { nextContactAt: value } }, {
      onSuccess: () => { onClose(); toast.success(text) },
    })

  return (
    <form onSubmit={e => { e.preventDefault(); if (iso) save(iso, 'Встреча назначена') }} className="space-y-4">
      <p className="text-sm text-surface-600 dark:text-surface-300">{lead.name}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setDate(dateInput(new Date()))} className="btn-secondary min-h-[44px]">Сегодня</button>
        <button type="button" onClick={() => setDate(dateInput(daysFromNow(1)))} className="btn-secondary min-h-[44px]">Завтра</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="meet-date" className="label">Дата</label>
          <input id="meet-date" type="date" required className="input" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor="meet-time" className="label">Время</label>
          <input id="meet-time" type="time" required className="input" value={time} onChange={e => setTime(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        {lead.nextContactAt ? (
          <button type="button" disabled={update.isPending} onClick={() => save(null, 'Встреча отменена')}
            className="btn-ghost min-h-[44px] text-red-600 dark:text-red-300">
            Отменить встречу
          </button>
        ) : <span />}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary min-h-[44px]">Отмена</button>
          <button type="submit" disabled={!iso || update.isPending} className="btn-primary min-h-[44px]">
            {update.isPending ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </form>
  )
}

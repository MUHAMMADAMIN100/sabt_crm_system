// Строка «Оплата клиента» в карточке SMM-проекта (решение владельца
// 12.10.2026, вариант А): когда клиент должен заплатить. Срок приходит из
// «Финансов» — здесь его не вводят. Проект CRM и клиент «Финансов» связаны по
// названию; где названия разные, владелец выбирает клиента вручную.
// Строку видят владелец, админ и ответственный менеджер этого проекта.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Check, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { smmPaymentsApi, type ClientPayItem } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { payStateText } from '@/pages/dashboard/components/ClientPayments'

const longDay = (iso: string) => format(new Date(`${iso}T00:00:00`), 'd MMMM', { locale: ru })
/** Кому сервер отдаёт срок оплаты. Остальным запрос не шлём: он вернул бы
 *  отказ и лишнюю запись в журнале безопасности. */
const PAY_ROLES = ['founder', 'admin', 'sales_manager_smm', 'sales_manager_dev']

const CHIP: Record<ClientPayItem['state'], string> = {
  late: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  today: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400',
  wait: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
}

export default function ClientPaymentRow({ projectId }: { projectId: string }) {
  const qc = useQueryClient()
  const user = useAuthStore(st => st.user)
  const allowed = [user?.role, (user as any)?.secondaryRole].some(r => !!r && PAY_ROLES.includes(r))
  const key = ['smm-payment-project', projectId]
  const { data } = useQuery({
    queryKey: key, queryFn: () => smmPaymentsApi.project(projectId), staleTime: 60_000, enabled: allowed,
  })
  const [open, setOpen] = useState(false)
  const { data: clients } = useQuery({
    queryKey: ['smm-finance-clients'], queryFn: smmPaymentsApi.financeClients,
    enabled: open, staleTime: 5 * 60_000,
  })
  const link = useMutation({
    mutationFn: (financeProjectId: string | null) => smmPaymentsApi.link(projectId, financeProjectId),
    onSuccess: (d) => {
      qc.setQueryData(key, d)
      // Срок у менеджера и колонка «Оплата» в «Контроле» берутся из той же связи.
      qc.invalidateQueries({ queryKey: ['smm-payments-mine'] })
      qc.invalidateQueries({ queryKey: ['smm-control'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось сохранить'),
  })

  if (!data?.visible) return null
  const { client, next, lastPaid, canLink } = data
  const today = data.today || ''
  const shown = next || lastPaid || null

  return (
    <div className="relative flex items-center justify-between gap-3 min-h-[46px] py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-sm text-gray-500 shrink-0">Оплата клиента</span>
      <div className="flex flex-col items-end gap-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {shown ? (
            <>
              {shown.state !== 'paid' && (
                <span className="text-sm font-semibold whitespace-nowrap">
                  {longDay(shown.date)}{shown.partNo === 2 ? ' · 2-я часть' : ''}
                </span>
              )}
              <span className={clsx('text-[11.5px] font-semibold px-2 py-[3px] rounded-md whitespace-nowrap', CHIP[shown.state])}>
                {payStateText(shown, today)}
              </span>
            </>
          ) : client ? (
            <span className="text-sm text-gray-400">{client.active ? 'Срока нет' : 'Клиент на паузе'}</span>
          ) : (
            <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">Не найден в «Финансах»</span>
          )}
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-gray-400 truncate">
            {client
              ? <>из «Финансов» · клиент «{client.name}»{client.by === 'manual' ? ' · выбран вручную' : ''}</>
              : 'клиента с таким названием в «Финансах» нет'}
          </span>
          {canLink && (
            <div className="relative shrink-0">
              <button type="button" onClick={() => setOpen(o => !o)}
                className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
                <Pencil size={11} /> {client ? 'Сменить клиента' : 'Выбрать клиента'}
              </button>
              {open && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                  <div className="absolute right-0 mt-1 z-50 w-72 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl py-1.5 max-h-72 overflow-y-auto">
                    <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Клиенты SMM в «Финансах»</div>
                    {!clients ? (
                      <p className="px-3 py-3 text-sm text-gray-400">Загрузка…</p>
                    ) : !clients.length ? (
                      <p className="px-3 py-3 text-sm text-gray-400">В «Финансах» нет клиентов SMM</p>
                    ) : clients.map(c => {
                      const on = client?.id === c.id
                      return (
                        <button key={c.id} type="button"
                          onClick={() => { setOpen(false); if (!on) link.mutate(c.id) }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800">
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-100 flex-1 truncate">{c.name}</span>
                          {!c.active && <span className="text-[11px] text-gray-400 shrink-0">пауза</span>}
                          <span className={'w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ' + (on ? 'bg-[#3f7a58] border-[#3f7a58]' : 'border-gray-300 dark:border-gray-600')}>
                            {on && <Check size={13} className="text-white" />}
                          </span>
                        </button>
                      )
                    })}
                    {client?.by === 'manual' && (
                      <button type="button" onClick={() => { setOpen(false); link.mutate(null) }}
                        className="w-full px-3 py-2 text-left text-[12.5px] font-semibold text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 border-t border-gray-100 dark:border-gray-800 mt-1">
                        Искать по названию проекта
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

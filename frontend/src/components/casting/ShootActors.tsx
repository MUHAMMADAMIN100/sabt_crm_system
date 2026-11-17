// Блок «Актёры» в карточке съёмки (17.11.2026, docs/CASTING_SPEC.md §5):
// кто приглашён, кто подтвердил, кто отказался; «+ Актёр» — поиск по базе
// кастинга. Ставят и правят: руководство, руководитель SMM, продюсер и
// SMM-специалист проекта (сервер проверяет проект сам); видеограф смотрит.
// Поиск — прямо в блоке, без отдельного окна: блок живёт внутри панелей,
// которые закрываются от клика мимо себя.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus, Search, X } from 'lucide-react'
import clsx from 'clsx'
import { useAuthStore } from '@/store/auth.store'
import { castingApi } from '@/services/casting.api'
import { BOOKING_STATUSES, BOOKING_STATUS_LABEL, ageText, categoriesText } from '@/lib/casting'
import type { BookingStatus, ShootTalentsResponse } from '@/types/casting'
import { TalentThumb, castingKeys, castingRights, errorText, useDebounced } from '@/pages/casting/castingUi'

const STATUS_CLS: Record<BookingStatus, string> = {
  invited: 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300',
  confirmed: 'bg-green-500/15 text-green-700 dark:text-green-400',
  declined: 'bg-red-500/10 text-red-600 dark:text-red-400',
}

export default function ShootActors({ contentItemId, readOnly = false }: {
  /** id карточки съёмки (content_plan_items, этап «съёмка»). */
  contentItemId: string
  /** Окно открыто только для просмотра — без правок. */
  readOnly?: boolean
}) {
  const user = useAuthStore(s => s.user)
  const rights = castingRights(user)
  const qc = useQueryClient()
  const key = castingKeys.shoot(contentItemId)

  const { data, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: () => castingApi.shoot(contentItemId),
    enabled: rights.canSee && !!contentItemId,
    staleTime: 30_000,
    retry: false,
  })
  const items = data?.items || []
  // Последнее слово — за сервером (он знает, чей это проект); до ответа —
  // по роли.
  const canEdit = !readOnly && (data?.canEdit ?? rights.canBook)

  const [picking, setPicking] = useState(false)
  const [q, setQ] = useState('')
  const search = useDebounced(q.trim(), 250)
  const { data: found, isFetching: searching } = useQuery({
    queryKey: [...castingKeys.lists, { search: search || undefined, picker: true }],
    queryFn: () => castingApi.list({ search: search || undefined }),
    enabled: picking && rights.canSee,
    staleTime: 30_000,
  })
  const booked = new Set(items.map(i => i.talent.id))
  const options = (found?.items || []).filter(t => !booked.has(t.id)).slice(0, 30)

  const apply = (res: ShootTalentsResponse) => {
    qc.setQueryData<ShootTalentsResponse>(key, prev => ({ ...res, canEdit: res.canEdit ?? prev?.canEdit }))
    // История съёмок в карточках людей поменялась.
    qc.invalidateQueries({ queryKey: castingKeys.talents })
  }
  const add = useMutation({
    mutationFn: (talentId: string) => castingApi.addToShoot(contentItemId, talentId),
    onSuccess: res => { apply(res); setQ(''); setPicking(false) },
    onError: e => toast.error(errorText(e, 'Не удалось добавить актёра')),
  })
  const setStatus = useMutation({
    mutationFn: (v: { bookingId: string; status: BookingStatus }) => castingApi.updateBooking(v.bookingId, { status: v.status }),
    onSuccess: apply,
    onError: e => toast.error(errorText(e, 'Статус не сохранился')),
  })
  const remove = useMutation({
    mutationFn: (bookingId: string) => castingApi.removeBooking(bookingId),
    onSuccess: apply,
    onError: e => toast.error(errorText(e, 'Не удалось убрать актёра')),
  })

  if (!rights.canSee) return null
  // Смотрящему (видеограф) пустой блок ни к чему; ошибка доступа — тоже.
  if (!canEdit && (isError || (!isLoading && items.length === 0))) return null

  return (
    <section onKeyDown={e => {
      // Escape в поиске закрывает поиск, а не всё окно съёмки.
      if (e.key === 'Escape' && picking) { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setPicking(false) }
    }}>
      <div className="flex items-center justify-between gap-2 mb-1.5 min-h-[28px]">
        <p className="text-[11px] font-extrabold uppercase tracking-wide text-surface-400 dark:text-surface-500">
          Актёры{items.length ? ` · ${items.length}` : ''}
        </p>
        {canEdit && !picking && (
          <button type="button" onClick={() => setPicking(true)}
            className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[30px] -my-2 sm:my-0 px-2 rounded-lg text-[12.5px] font-bold text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20">
            <Plus size={14} /> Актёр
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="h-14 rounded-xl bg-surface-100 dark:bg-surface-800 animate-pulse" />
      ) : isError ? (
        <p className="text-[12.5px] text-surface-400">Список актёров не загрузился.</p>
      ) : items.length === 0 && !picking ? (
        <p className="text-[12.5px] text-surface-400">Пока никого. Нажмите «+ Актёр», чтобы пригласить из кастинга.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map(b => {
            const sub = [categoriesText(b.talent.categories), ageText(b.talent.age)].filter(Boolean).join(' · ')
            const busy = (setStatus.isPending && setStatus.variables?.bookingId === b.bookingId)
              || (remove.isPending && remove.variables === b.bookingId)
            return (
              <li key={b.bookingId}
                className={clsx('flex items-center gap-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/60 pl-2 pr-1 py-1.5',
                  b.status === 'declined' && 'opacity-60', busy && 'opacity-50')}>
                <TalentThumb path={b.talent.photo} name={b.talent.name} size={40} />
                <div className="flex-1 min-w-0">
                  <Link to={`/casting/${b.talent.id}`}
                    className={clsx('block text-[13.5px] font-semibold truncate text-surface-900 dark:text-surface-100 hover:underline', b.status === 'declined' && 'line-through')}>
                    {b.talent.name}
                  </Link>
                  {sub && <span className="block text-[12px] text-surface-500 dark:text-surface-400 truncate">{sub}</span>}
                </div>
                {canEdit ? (
                  <select value={b.status} disabled={busy} aria-label={`Статус: ${b.talent.name}`}
                    onKeyDown={e => e.stopPropagation()}
                    onChange={e => setStatus.mutate({ bookingId: b.bookingId, status: e.target.value as BookingStatus })}
                    className={clsx('shrink-0 h-11 sm:h-8 max-w-[132px] rounded-lg border-0 pl-2 pr-7 text-[13px] font-semibold cursor-pointer', STATUS_CLS[b.status])}>
                    {BOOKING_STATUSES.map(s => <option key={s} value={s}>{BOOKING_STATUS_LABEL[s]}</option>)}
                  </select>
                ) : (
                  <span className={clsx('shrink-0 px-2 py-0.5 rounded-md text-[12px] font-semibold mr-1', STATUS_CLS[b.status])}>
                    {BOOKING_STATUS_LABEL[b.status] || b.status}
                  </span>
                )}
                {canEdit && (
                  <button type="button" disabled={busy} onClick={() => remove.mutate(b.bookingId)}
                    aria-label={`Убрать ${b.talent.name} из съёмки`} title="Убрать из съёмки"
                    className="shrink-0 w-11 h-11 sm:w-8 sm:h-8 grid place-items-center rounded-lg text-surface-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                    <X size={16} />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {picking && (
        <div className="mt-2 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-2">
          <div className="flex items-center gap-1.5">
            <label className="relative flex-1 min-w-0">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Имя из кастинга" aria-label="Поиск актёра"
                className="input pl-8 min-h-[44px] sm:min-h-[36px]" />
            </label>
            <button type="button" onClick={() => { setPicking(false); setQ('') }} aria-label="Закрыть поиск"
              className="shrink-0 w-11 h-11 sm:w-9 sm:h-9 grid place-items-center rounded-lg text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800">
              <X size={16} />
            </button>
          </div>
          <ul className="mt-1.5 max-h-64 overflow-y-auto overscroll-contain">
            {options.map(t => {
              const sub = [categoriesText(t.categories, t.kid), ageText(t.age)].filter(Boolean).join(' · ')
              return (
                <li key={t.id}>
                  <button type="button" disabled={add.isPending} onClick={() => add.mutate(t.id)}
                    className="w-full flex items-center gap-2.5 min-h-[48px] px-1.5 py-1.5 rounded-lg text-left hover:bg-surface-100 dark:hover:bg-surface-800 disabled:opacity-50">
                    <TalentThumb path={t.photo} name={t.name} size={36} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13.5px] font-semibold truncate text-surface-900 dark:text-surface-100">{t.name}</span>
                      {sub && <span className="block text-[12px] text-surface-500 truncate">{sub}</span>}
                    </span>
                    <Plus size={15} className="shrink-0 text-surface-400" />
                  </button>
                </li>
              )
            })}
            {!searching && found && options.length === 0 && (
              <li className="px-2 py-3 text-[13px] text-surface-400">{search ? 'Никого не нашли' : 'Все из кастинга уже в этой съёмке'}</li>
            )}
            {searching && !found && <li className="px-2 py-3 text-[13px] text-surface-400">Ищу…</li>}
          </ul>
        </div>
      )}
    </section>
  )
}

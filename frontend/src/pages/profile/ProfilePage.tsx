import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth.store'
import { usersApi, meApi, workShiftsApi } from '@/services/api.service'
import { Avatar } from '@/components/ui'
import { Camera, ChevronLeft, ChevronRight } from 'lucide-react'
import { getUserPositionLabel } from '@/lib/permissions'
import toast from 'react-hot-toast'
import TaskCelebrationSection from '@/components/profile/TaskCelebrationSection'
import { prepareAvatar } from '@/lib/imageCompress'
import { money, shiftYm, currentSalaryYm, pluralRu, formatDate } from '@/pages/finance/finlib'
import ProfileStatsBody, { useProfileStats, LevelBar, LevelBadge, tenureText } from './ProfileStats'
import SalesPlanCard from './SalesPlanCard'

/** Часы из минут: «68 ч 12 м», «45 м», «—». */
function hoursOf(min: number): string {
  const v = Math.max(0, Math.round(Number(min) || 0))
  if (!v) return '—'
  const h = Math.floor(v / 60)
  const m = v % 60
  if (!h) return `${m} м`
  return m ? `${h} ч ${m} м` : `${h} ч`
}

/** «сентябрь» — месяц без года, для заголовка суммы. */
function monthOnly(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long' })
}

/** Зарплату платим 10-го числа СЛЕДУЮЩЕГО месяца — человек должен видеть,
 *  когда придут деньги, иначе «к выплате» висит без срока. */
function payoutDay(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m, 10).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

/** «5 сентября» — без года: год виден в названии месяца рядом. */
function dayMonth(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''))
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

/** «12.09» — короткая дата начисления. */
const shortDate = (iso?: string | null) => (iso || '').slice(8, 10) + '.' + (iso || '').slice(5, 7)

type Entry = { id: string; date: string; amount: number; note?: string | null; comment?: string | null }

/** Строка разбора: слева подпись, справа сумма. Пустая строка не кричит
 *  цветом и нулём — она просто говорит, что начислений не было. */
function Row({ label, hint, value, empty, tone, open }: {
  label: string; hint?: string | null; value?: string
  empty?: string; tone?: 'plus' | 'minus' | 'paid'
  /** Дальше идёт расшифровка: черту рисует она, иначе строка отделялась
   *  бы от собственных начислений и они липли бы к следующему пункту. */
  open?: boolean
}) {
  const toneClass = tone === 'plus'
    ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'minus'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'paid'
        ? 'text-primary-600 dark:text-primary-400'
        : 'text-surface-900 dark:text-surface-100'
  return (
    <div className={`flex items-center justify-between gap-4 py-3 ${open ? '' : 'border-b border-surface-100 dark:border-surface-700/60'}`}>
      <span className="min-w-0 text-sm">
        <span className={empty ? 'text-surface-400 dark:text-surface-500' : 'text-surface-700 dark:text-surface-200'}>{label}</span>
        {hint && <span className="text-surface-400 dark:text-surface-500"> · {hint}</span>}
      </span>
      {empty
        ? <span className="shrink-0 text-sm text-surface-400 dark:text-surface-500">{empty}</span>
        : <span className={`shrink-0 text-[15px] font-semibold tabular-nums whitespace-nowrap ${toneClass}`}>{value}</span>}
    </div>
  )
}

/** Расшифровка: дата, причина, сумма. Без причин «к выплате» не сходится
 *  и человек идёт спрашивать.
 *
 *  sign: минус у удержаний. У полученного знака НЕТ — сама строка уже
 *  показывает «−500 с.», и «+500 с.» под ней противоречили бы ей. */
function Detail({ entries, sign }: { entries: Entry[]; sign?: '−' }) {
  if (!entries.length) return null
  return (
    <div className="pb-3 border-b border-surface-100 dark:border-surface-700/60">
      <div className="ml-1 pl-3 border-l-2 border-surface-200 dark:border-surface-700 space-y-1.5">
        {entries.map(e => {
          const reason = e.note || e.comment || '—'
          return (
            <div key={e.id} className="flex items-baseline gap-3 text-xs">
              <span className="text-surface-400 dark:text-surface-500 tabular-nums shrink-0">{shortDate(e.date)}</span>
              <span className="text-surface-600 dark:text-surface-300 flex-1 min-w-0 truncate" title={reason}>{reason}</span>
              <span className={`tabular-nums shrink-0 whitespace-nowrap ${sign ? 'text-red-600 dark:text-red-400' : 'text-surface-500 dark:text-surface-400'}`}>
                {sign}{money(Math.abs(Number(e.amount) || 0))}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 1 удержание, 2 удержания, 5 удержаний. */
function countWord(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  if (m100 >= 11 && m100 <= 14) return many
  return m10 === 1 ? one : m10 >= 2 && m10 <= 4 ? few : many
}

/** Моя рассрочка: сколько осталось, когда следующее удержание и история.
 *  Сотрудник только смотрит — менять суммы может руководство. */
function MyInstallment({ item }: { item: any }) {
  const [all, setAll] = useState(false)
  const total = Number(item.total) || 0
  const paid = Number(item.paid) || 0
  const pctPaid = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0
  const history: any[] = item.history || []
  const shown = all ? history : history.slice(0, 4)
  const ymLong = (ym: string) => `${monthOnly(ym)} ${ym.slice(0, 4)}`
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="section-title">Моя рассрочка</h3>
        <span className="text-[13px] text-surface-500 dark:text-surface-400 truncate">{item.name}</span>
      </div>
      {item.done ? (
        <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400 font-medium">Закрыта — вернули {money(total)}</p>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-[30px] leading-none font-bold tabular-nums text-surface-900 dark:text-surface-50">{money(item.remaining)}</span>
            <span className="text-[13px] text-surface-500 dark:text-surface-400">осталось</span>
          </div>
          <div className="h-2 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden mt-3">
            <div className="h-full rounded-full bg-teal-500" style={{ width: `${pctPaid}%` }} />
          </div>
          <div className="flex justify-between text-xs text-surface-500 dark:text-surface-400 mt-1.5 tabular-nums">
            <span>вернули {money(paid)} из {money(total)}</span><span>{pctPaid}%</span>
          </div>
          {item.overdue && (
            <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[13px] leading-snug text-red-700 dark:text-red-300">
              Просрочен платёж — <b className="tabular-nums">{money(item.overdue.amount)}</b>, срок был {dayMonth(item.overdue.since)}.
            </div>
          )}
          {item.next && (
            <div className="mt-3 rounded-xl border border-teal-500/30 bg-teal-500/10 px-3 py-2.5 text-[13px] leading-snug text-surface-700 dark:text-surface-200">
              {item.method === 'separate'
                ? <>Следующий платёж — <b className="tabular-nums">{money(item.next.amount)}</b> до {dayMonth(item.next.date)}. Деньги вносятся отдельно.</>
                : <>Следующее удержание — <b className="tabular-nums">{money(item.next.amount)}</b> из зарплаты за {monthOnly(item.next.ym)}, {dayMonth(item.next.date)}.</>}
              {item.endDate && (
                <span className="block text-surface-500 dark:text-surface-400 mt-0.5">
                  Ещё {item.paymentsLeft} {countWord(item.paymentsLeft, 'платёж', 'платежа', 'платежей')} · последний — {dayMonth(item.endDate)} {String(item.endDate).slice(0, 4)}
                </span>
              )}
            </div>
          )}
        </>
      )}
      {history.length > 0 && (
        <div className="mt-2 divide-y divide-surface-100 dark:divide-surface-700/60">
          {shown.map(h => (
            <div key={h.key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="text-surface-700 dark:text-surface-200 first-letter:uppercase">
                  {h.kind === 'before' ? 'Вернули раньше' : h.kind === 'salary' ? ymLong(h.ym) : dayMonth(h.date)}
                </span>
                <span className="text-surface-400 dark:text-surface-500"> · {h.kind === 'salary' ? 'из зарплаты' : h.kind === 'manual' ? (h.note || 'внесено отдельно') : 'до учёта в CRM'}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{money(h.amount)}</span>
            </div>
          ))}
          {history.length > 4 && (
            <button type="button" onClick={() => setAll(v => !v)} className="w-full text-left py-2.5 text-[13px] font-medium text-primary-600 dark:text-primary-400">
              {all ? 'Свернуть' : `Вся история · ${history.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Переключатель месяца. Вынесен из денежной карточки: на компьютере её
 *  больше нет, а «Мои смены» без выбора месяца остались бы немыми. */
function MonthNav({ ym, setYm }: { ym: string; setYm: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button onClick={() => setYm(shiftYm(ym, -1))} aria-label="Предыдущий месяц"
        className="w-7 h-7 flex items-center justify-center rounded-lg border border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700">
        <ChevronLeft size={15} />
      </button>
      <span className="px-1 min-w-[112px] text-center text-[13px] font-medium text-surface-600 dark:text-surface-300 first-letter:uppercase whitespace-nowrap">
        {monthOnly(ym)} {ym.slice(0, 4)}
      </span>
      <button onClick={() => setYm(shiftYm(ym, 1))} aria-label="Следующий месяц"
        className="w-7 h-7 flex items-center justify-center rounded-lg border border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700">
        <ChevronRight size={15} />
      </button>
    </div>
  )
}

export default function ProfilePage() {
  const user = useAuthStore(s => s.user)
  const fetchMe = useAuthStore(s => s.fetchMe)
  const fileRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  const uploadAvatarMut = useMutation({
    mutationFn: (file: File) => usersApi.uploadMyAvatar(file),
    onSuccess: () => {
      fetchMe()
      qc.invalidateQueries({ queryKey: ['employees'] })
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('Аватар обновлён')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка загрузки'),
  })

  const handleAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    // Тип не проверяем по file.type: у HEIC с айфона он часто пустой,
    // а картинка при этом читается. Решает попытка сжатия ниже.
    if (file.size > 25 * 1024 * 1024) {
      toast.error('Файл слишком большой (макс. 25 МБ)')
      return
    }
    try {
      // Жмём в браузере: фото с телефона весит мегабайты и раньше
      // отвергалось сервером — человек видел только «Ошибка загрузки».
      uploadAvatarMut.mutate(await prepareAvatar(file))
    } catch (err: any) {
      toast.error(err?.message || 'Не удалось прочитать файл как изображение')
    }
  }

  // Роль могли поменять — обновляем профиль при входе на страницу.
  useEffect(() => { fetchMe() }, [fetchMe])

  // Месяц начисления: зарплату платим 10-го за прошлый месяц, поэтому
  // по умолчанию открываем тот месяц, который сейчас зарабатывается.
  const [ym, setYm] = useState(() => currentSalaryYm())
  const isFounder = user?.role === 'founder'

  const { data: sal, isLoading: salLoading } = useQuery({
    queryKey: ['me', 'salary', ym],
    queryFn: () => meApi.salary(ym),
  })
  const { data: shifts } = useQuery({
    queryKey: ['me', 'shifts', ym],
    queryFn: () => workShiftsApi.myMonth(ym),
    enabled: !isFounder,
  })

  const row = sal?.row || null
  const emp = sal?.employee || null
  const history: any[] = sal?.history || []
  const mine = shifts?.item || null

  const bonusEntries: Entry[] = row?.bonusEntries || []
  const fineEntries: Entry[] = row?.fineEntries || []
  const vacationEntries: Entry[] = row?.vacationEntries || []
  const advanceEntries: Entry[] = row?.advanceEntries || []

  const salary = Number(row?.salary) || 0
  const bonus = Number(row?.bonus) || 0
  const fine = Number(row?.fine) || 0
  const vacation = Number(row?.vacation) || 0
  const installment = Number(row?.installment) || 0
  const installmentNames = ((row?.installmentParts || []) as any[]).map(p => p.name).join(', ')
  const myInstallments: any[] = sal?.installments || []
  const paid = Number(row?.paid) || 0
  const toPay = Number(row?.toPay) || 0
  // Полоса делится по фактическим частям, а не по окладу: если месяц
  // переплатили, остаток обнуляется и сумма частей расходится с окладом.
  const barTotal = toPay + paid + fine + vacation + installment
  const pct = (v: number) => (barTotal > 0 ? Math.round((v / barTotal) * 1000) / 10 : 0)
  const accrued = salary + bonus

  // Куда разошлось начисленное. Показываем ТОЛЬКО ненулевые части и рядом
  // с каждой — сумму: без сумм полоса красивая, но ничего не объясняет.
  const parts = [
    { key: 'left', label: row?.frozen ? 'выплачено на руки' : 'остаток к выплате', value: row?.frozen ? paid : toPay, dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
    { key: 'paid', label: 'уже получено', value: row?.frozen ? 0 : paid, dot: 'bg-primary-500', text: 'text-primary-600 dark:text-primary-400' },
    { key: 'fine', label: 'удержано', value: fine + vacation, dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
    { key: 'inst', label: 'рассрочка', value: installment, dot: 'bg-teal-500', text: 'text-teal-600 dark:text-teal-400' },
  ].filter(p => p.value > 0)

  // Чего в этом месяце не было — одной серой припиской вместо пустых строк.
  const absent = [
    bonus > 0 ? null : 'бонусов',
    fine > 0 ? null : 'штрафов',
    vacation > 0 ? null : 'отпускных',
  ].filter(Boolean) as string[]

  const showSalary = !(isFounder && sal && !sal.linked)

  // Аналитика профиля (вариант Б, 17.10.2026). У руководства KPI нет —
  // сервер отвечает visible: false, и профиль остаётся прежним.
  const { data: statsData } = useProfileStats()
  const stats = statsData && statsData.visible ? statsData : null

  return (
    <div className="space-y-4">

      {/* Шапка. Заголовок страницы, почта и бейджи убраны: человек знает,
          чей это профиль и чем он вошёл. Должность и дата прихода — одной
          строкой. Статус показываем, только если доступ закрыт. */}
      <div className="card p-4 sm:px-6 sm:py-[18px]">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={`relative group rounded-full shrink-0 ${stats ? 'ring-2 ring-amber-400 ring-offset-[3px] ring-offset-surface-50 dark:ring-offset-surface-800' : ''}`}
            title="Сменить аватар"
          >
            <Avatar name={user?.name} src={user?.avatar} size={56} zoomable={false} />
            <span className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <Camera size={18} className="text-white" />
            </span>
            {stats && <LevelBadge level={stats.level.level} />}
            {uploadAvatarMut.isPending && (
              <span className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center">
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.heic,.heif"
            onChange={handleAvatarPick}
            className="hidden"
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100 truncate">{user?.name}</h1>
            {/* На телефоне строка не влезает в одну: обрезалось на «в коман…».
                Переносим, а на широком экране оставляем одну строку. */}
            <p className="text-[13px] leading-snug text-surface-500 dark:text-surface-400 mt-1 sm:truncate">
              {getUserPositionLabel(user)}
              {stats?.hireDate
                ? <> · {tenureText(stats.tenureMonths)}<span className="hidden sm:inline"> в WeBrand</span></>
                : emp?.hireDate ? ` · в команде с ${formatDate(emp.hireDate)}` : ''}
            </p>
          </div>
          {!user?.isActive && (
            <span className="badge status-cancelled shrink-0">Доступ закрыт</span>
          )}
          {stats && <LevelBar stats={stats} className="hidden sm:flex w-[300px] shrink-0 ml-auto" />}
        </div>
        {stats && <LevelBar stats={stats} className="sm:hidden mt-3.5" />}
      </div>

      {/* План продаж менеджера — деньги, поэтому только на телефоне, как
          зарплата (решение владельца 19.10.2026). Без плана не показывается. */}
      <SalesPlanCard className="lg:hidden" />

      {stats && <ProfileStatsBody stats={stats} />}

      {/* Деньги — только на телефоне (решение владельца, 23.09.2026): за
          компьютером экран видят соседи по кабинету, зарплата на нём не место.
          На компьютере остаётся одна узкая колонка со сменами. */}
      <div className="grid gap-4 items-start lg:grid-cols-[minmax(0,420px)]">

        <div className="space-y-4 min-w-0 lg:hidden">

          {/* Деньги одной карточкой: сумма, куда она разошлась, и разбор */}
          {showSalary && (
            <div className="card p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-surface-500 dark:text-surface-400">
                  {row?.frozen ? 'Выплачено за месяц' : 'К выплате за месяц'}
                </span>
                <MonthNav ym={ym} setYm={setYm} />
              </div>

              {salLoading ? (
                <p className="text-sm text-surface-400 dark:text-surface-500 py-6">Загружаю…</p>
              ) : !sal?.linked ? (
                <p className="text-sm text-surface-500 dark:text-surface-400 py-6">
                  Зарплата пока не привязана к твоей учётной записи.<br />
                  <span className="text-xs text-surface-400 dark:text-surface-500">Попроси руководство связать профиль с зарплатной ведомостью.</span>
                </p>
              ) : !row ? (
                <p className="text-sm text-surface-400 dark:text-surface-500 py-6">За этот месяц начислений нет</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-2">
                    <span className="text-4xl sm:text-[44px] leading-none font-bold text-surface-900 dark:text-surface-50 tabular-nums tracking-tight">
                      {money(row.frozen ? paid : toPay)}
                    </span>
                    <span className="text-[13px] text-surface-500 dark:text-surface-400">
                      {row.frozen
                        ? (row.paidAt ? `выплачено ${dayMonth(row.paidAt)}` : 'месяц закрыт')
                        : `выплата ${payoutDay(ym)}`}
                    </span>
                  </div>

                  {/* Полоса с суммами: видно, сколько ушло на каждую часть */}
                  {barTotal > 0 && parts.length > 1 && (
                    <div className="mt-5">
                      <p className="text-[11px] text-surface-400 dark:text-surface-500">
                        Из {money(accrued)} {bonus > 0 ? 'начислений' : 'оклада'} разошлись так:
                      </p>
                      <div className="flex gap-[3px] h-2.5 mt-2">
                        {toPay > 0 && !row.frozen && <div className="bg-emerald-500 rounded-full" style={{ width: `${pct(toPay)}%` }} />}
                        {paid > 0 && <div className={`${row.frozen ? 'bg-emerald-500' : 'bg-primary-500'} rounded-full`} style={{ width: `${pct(paid)}%` }} />}
                        {(fine + vacation) > 0 && <div className="bg-red-500 rounded-full" style={{ width: `${pct(fine + vacation)}%` }} />}
                        {installment > 0 && <div className="bg-teal-500 rounded-full" style={{ width: `${pct(installment)}%` }} />}
                      </div>
                      <div className="flex flex-wrap gap-x-7 gap-y-2.5 mt-3">
                        {parts.map(p => (
                          <span key={p.key} className="min-w-0">
                            <span className="flex items-center gap-2 text-[11px] text-surface-500 dark:text-surface-400">
                              <span className={`w-2 h-2 rounded-sm shrink-0 ${p.dot}`} />{p.label}
                            </span>
                            <span className={`block mt-0.5 text-[15px] font-semibold tabular-nums whitespace-nowrap ${p.text}`}>{money(p.value)}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="h-px bg-surface-200 dark:bg-surface-700 mt-5 mb-1" />

                  <Row label="Оклад за месяц" value={money(salary)} />

                  {bonus > 0 && (
                    <>
                      <Row label="Бонусы" hint={bonusEntries.length ? pluralRu(bonusEntries.length, 'начисление', 'начисления', 'начислений') : null} value={`+${money(bonus)}`} tone="plus" open />
                      <Detail entries={bonusEntries} />
                    </>
                  )}

                  {fine > 0 && (
                    <>
                      <Row label="Штрафы" hint={fineEntries.length ? pluralRu(fineEntries.length, 'удержание', 'удержания', 'удержаний') : null} value={`−${money(fine)}`} tone="minus" open />
                      <Detail entries={fineEntries} sign="−" />
                    </>
                  )}

                  {vacation > 0 && (
                    <>
                      <Row label="Отпускные и невыходы" value={`−${money(vacation)}`} tone="minus" open />
                      <Detail entries={vacationEntries} sign="−" />
                    </>
                  )}

                  {installment > 0 && (
                    <Row label="Рассрочка" hint={installmentNames || null} value={`−${money(installment)}`} tone="minus" />
                  )}

                  {paid > 0 && (
                    <>
                      <Row label="Уже получено" hint={row.advance > 0 ? `в том числе аванс ${money(row.advance)}` : null} value={`−${money(paid)}`} tone="paid" open />
                      <Detail entries={advanceEntries} />
                    </>
                  )}

                  {/* Вместо пустых строк «Бонусы — не начислялись» */}
                  {(absent.length > 0 || paid === 0) && (
                    <p className="text-xs text-surface-400 dark:text-surface-500 mt-3">
                      {absent.length > 0 && `В этом месяце не было ${absent.join(', ')}.`}
                      {absent.length > 0 && paid === 0 ? ' ' : ''}
                      {paid === 0 && 'Выплат по этому месяцу пока не было.'}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Рассрочка: только просмотр — суммы меняет руководство (26.10.2026). */}
          {myInstallments.map(i => <MyInstallment key={i.id} item={i} />)}
        </div>

        <div className="space-y-4 min-w-0">

          {/* Смены: три строки вместо четырёх плиток, месяц общий со страницей */}
          {!isFounder && (
            <div className="card p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="section-title">Мои смены</h3>
                {/* На телефоне месяц переключают в денежной карточке выше;
                    на компьютере её нет — ставим переключатель сюда. */}
                <div className="hidden lg:block"><MonthNav ym={ym} setYm={setYm} /></div>
                {/* Месяц подписываем, только когда листают прошлое: для
                    текущего он и так написан в переключателе выше. */}
                {ym !== currentSalaryYm() && (
                  <span className="lg:hidden text-xs text-surface-400 dark:text-surface-500 first-letter:uppercase whitespace-nowrap">{monthOnly(ym)}</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 py-3 mt-1 border-b border-surface-100 dark:border-surface-700/60">
                <span className="text-sm text-surface-600 dark:text-surface-300">Отработано</span>
                <span className="text-[15px] font-semibold tabular-nums whitespace-nowrap text-surface-900 dark:text-surface-100">{hoursOf(mine?.totalMinutes || 0)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 py-3 border-b border-surface-100 dark:border-surface-700/60">
                <span className="text-sm text-surface-600 dark:text-surface-300">Рабочих дней</span>
                <span className="text-[15px] font-semibold tabular-nums text-surface-900 dark:text-surface-100">{mine?.workedDays || 0}</span>
              </div>
              <div className="flex items-center justify-between gap-3 py-3">
                {/* Порог не подписываем: правило человек знает и без напоминания
                    в каждой строке (в табеле у руководства оно осталось). */}
                <span className="text-sm text-surface-600 dark:text-surface-300">Опозданий</span>
                <span className={`text-[15px] font-semibold tabular-nums ${(mine?.lateDays?.length || 0) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-surface-900 dark:text-surface-100'}`}>
                  {mine?.lateDays?.length || 0}
                </span>
              </div>
            </div>
          )}

          {/* История: состав месяца — только когда выплата разошлась с окладом.
              Это тоже деньги, поэтому на компьютере её нет. */}
          {history.length > 0 && (
            <div className="card p-4 sm:p-5 lg:hidden">
              <h3 className="section-title mb-1">История выплат</h3>
              <div className="divide-y divide-surface-100 dark:divide-surface-700/60">
                {history.map(h => {
                  const diff = [
                    h.bonus > 0 ? `бонус ${money(h.bonus)}` : null,
                    h.fine > 0 ? `штраф ${money(h.fine)}` : null,
                    h.vacation > 0 ? `отпускные ${money(h.vacation)}` : null,
                    h.installment > 0 ? `рассрочка ${money(h.installment)}` : null,
                  ].filter(Boolean) as string[]
                  const note = Number(h.paid) === Number(h.salary)
                    ? ''
                    : (diff.length ? diff.join(' · ') : `оклад был ${money(h.salary)}`)
                  return (
                    <button
                      key={h.ym}
                      onClick={() => setYm(h.ym)}
                      className="w-full text-left flex items-start justify-between gap-4 py-3 px-1 -mx-1 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-700/40 transition-colors"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-surface-900 dark:text-surface-100 first-letter:uppercase">{monthOnly(h.ym)} {h.ym.slice(0, 4)}</span>
                        {note && <span className="block text-[11px] leading-snug text-surface-400 dark:text-surface-500 mt-1">{note}</span>}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold text-surface-900 dark:text-surface-100 tabular-nums whitespace-nowrap">{money(h.paid)}</span>
                        {h.paidAt && <span className="block text-[11px] text-surface-400 dark:text-surface-500 mt-1 whitespace-nowrap">{dayMonth(h.paidAt)}</span>}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* «Печать успеха» за выполненную задачу — с ролевой проверкой внутри */}
      <TaskCelebrationSection />
    </div>
  )
}

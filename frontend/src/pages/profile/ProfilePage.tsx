import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth.store'
import { authApi, usersApi, meApi, workShiftsApi } from '@/services/api.service'
import { useTranslation } from '@/i18n'
import { Avatar } from '@/components/ui'
import { Key, Camera, ChevronLeft, ChevronRight } from 'lucide-react'
import { getUserPositionLabel } from '@/lib/permissions'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import TaskCelebrationSection from '@/components/profile/TaskCelebrationSection'
import { prepareAvatar } from '@/lib/imageCompress'
import { money, shiftYm, currentSalaryYm, pluralRu, formatDate } from '@/pages/finance/finlib'

/** Часы из минут: «68 ч 12 м», «45 м», «—». */
function hoursOf(min: number): string {
  const v = Math.max(0, Math.round(Number(min) || 0))
  if (!v) return '—'
  const h = Math.floor(v / 60)
  const m = v % 60
  if (!h) return `${m} м`
  return m ? `${h} ч ${m} м` : `${h} ч`
}

/** Слово без числа: «2» + «опоздания» подписью под цифрой. */
function wordOf(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.trunc(Number(n) || 0)) % 100
  const b = a % 10
  if (a > 11 && a < 15) return many
  if (b === 1) return one
  if (b >= 2 && b <= 4) return few
  return many
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

/** «12.09» — короткая дата начисления. */
const shortDate = (iso?: string | null) => (iso || '').slice(8, 10) + '.' + (iso || '').slice(5, 7)

type Entry = { id: string; date: string; amount: number; note?: string | null; comment?: string | null }

/** Строка разбора: слева подпись, справа сумма. Пустая строка не кричит
 *  цветом и нулём — она просто говорит, что начислений не было. */
function Row({ label, hint, value, empty, tone }: {
  label: string; hint?: string | null; value?: string
  empty?: string; tone?: 'plus' | 'minus' | 'paid'
}) {
  const toneClass = tone === 'plus'
    ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'minus'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'paid'
        ? 'text-primary-600 dark:text-primary-400'
        : 'text-surface-900 dark:text-surface-100'
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-surface-100 dark:border-surface-700/60">
      <span className="min-w-0 text-sm">
        <span className={empty ? 'text-surface-400 dark:text-surface-500' : 'text-surface-700 dark:text-surface-200'}>{label}</span>
        {hint && <span className="text-surface-400 dark:text-surface-500"> · {hint}</span>}
      </span>
      {empty
        ? <span className="shrink-0 text-sm text-surface-400 dark:text-surface-500">{empty}</span>
        : <span className={`shrink-0 text-[15px] font-semibold tabular-nums ${toneClass}`}>{value}</span>}
    </div>
  )
}

/** Расшифровка: дата, причина, сумма. Без причин «к выплате» не сходится
 *  и человек идёт спрашивать. */
function Detail({ entries, sign }: { entries: Entry[]; sign: '+' | '−' }) {
  if (!entries.length) return null
  return (
    <div className="ml-1 pl-3 border-l-2 border-surface-200 dark:border-surface-700 space-y-1.5 pb-3 -mt-1">
      {entries.map(e => (
        <div key={e.id} className="flex items-baseline gap-2.5 text-xs">
          <span className="text-surface-400 dark:text-surface-500 tabular-nums shrink-0">{shortDate(e.date)}</span>
          <span className="text-surface-600 dark:text-surface-300 flex-1 min-w-0 truncate">{e.note || e.comment || '—'}</span>
          <span className={`tabular-nums shrink-0 ${sign === '+' ? 'text-primary-600 dark:text-primary-400' : 'text-red-600 dark:text-red-400'}`}>
            {sign}{money(Math.abs(Number(e.amount) || 0))}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function ProfilePage() {
  const user = useAuthStore(s => s.user)
  const fetchMe = useAuthStore(s => s.fetchMe)
  const [changingPass, setChangingPass] = useState(false)
  const { register, handleSubmit, reset } = useForm()
  const { t } = useTranslation()
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

  const onChangePassword = async (data: any) => {
    if (data.newPassword !== data.confirm) { toast.error(t('auth.passwordsNotMatch')); return }
    try {
      await authApi.changePassword({ oldPassword: data.oldPassword, newPassword: data.newPassword })
      toast.success(t('auth.passwordChanged'))
      reset()
      setChangingPass(false)
    } catch (e: any) {
      toast.error(e?.response?.data?.message || t('common.error'))
    }
  }

  const bonusEntries: Entry[] = row?.bonusEntries || []
  const fineEntries: Entry[] = row?.fineEntries || []
  const vacationEntries: Entry[] = row?.vacationEntries || []
  const advanceEntries: Entry[] = row?.advanceEntries || []

  const salary = Number(row?.salary) || 0
  const bonus = Number(row?.bonus) || 0
  const fine = Number(row?.fine) || 0
  const vacation = Number(row?.vacation) || 0
  const paid = Number(row?.paid) || 0
  const toPay = Number(row?.toPay) || 0
  // Полоса делится по фактическим частям, а не по окладу: если месяц
  // переплатили, остаток обнуляется и сумма частей расходится с окладом.
  const barTotal = toPay + paid + fine + vacation
  const pct = (v: number) => (barTotal > 0 ? Math.round((v / barTotal) * 1000) / 10 : 0)

  const showSalary = !(isFounder && sal && !sal.linked)

  return (
    <div className="space-y-4">
      <h1 className="page-title">{t('profile.title')}</h1>

      {/* Шапка: кто я, с какого числа работаю */}
      <div className="card">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="relative group rounded-full shrink-0"
            title="Сменить аватар"
          >
            <Avatar name={user?.name} src={user?.avatar} size={56} zoomable={false} />
            <span className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <Camera size={18} className="text-white" />
            </span>
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
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100 truncate">{user?.name}</h2>
              <span className="text-[13px] text-surface-500 dark:text-surface-400 truncate">{user?.email}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className="badge bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400">{getUserPositionLabel(user)}</span>
              <span className={`badge ${user?.isActive ? 'status-done' : 'status-cancelled'}`}>
                {user?.isActive ? 'Работает' : 'Доступ закрыт'}
              </span>
              {emp?.hireDate && (
                <span className="badge bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300">
                  В команде с {formatDate(emp.hireDate)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 items-start lg:grid-cols-[minmax(0,1fr)_340px]">

        {/* Главная цифра: сколько причитается и когда придёт */}
        {showSalary && (
          <div className="card lg:col-start-1 lg:row-start-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] text-surface-500 dark:text-surface-400">
                {row?.frozen ? 'Выплачено за' : 'К выплате за'} {monthOnly(ym)}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setYm(shiftYm(ym, -1))} aria-label="Предыдущий месяц"
                  className="w-7 h-7 flex items-center justify-center rounded-lg border border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700">
                  <ChevronLeft size={15} />
                </button>
                <button onClick={() => setYm(shiftYm(ym, 1))} aria-label="Следующий месяц"
                  className="w-7 h-7 flex items-center justify-center rounded-lg border border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700">
                  <ChevronRight size={15} />
                </button>
              </div>
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
                      ? (row.paidAt ? `выплачено ${formatDate(row.paidAt)}` : 'месяц закрыт')
                      : `выплата ${payoutDay(ym)}`}
                  </span>
                </div>

                {barTotal > 0 && (
                  <>
                    <div className="flex gap-[3px] h-2.5 mt-4">
                      {toPay > 0 && <div className="bg-emerald-500 rounded-full" style={{ width: `${pct(toPay)}%` }} />}
                      {paid > 0 && <div className="bg-primary-500 rounded-full" style={{ width: `${pct(paid)}%` }} />}
                      {(fine + vacation) > 0 && <div className="bg-red-500 rounded-full" style={{ width: `${pct(fine + vacation)}%` }} />}
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3">
                      {toPay > 0 && (
                        <span className="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400">
                          <span className="w-2 h-2 rounded-sm bg-emerald-500" />Остаток к выплате {money(toPay)}
                        </span>
                      )}
                      {paid > 0 && (
                        <span className="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400">
                          <span className="w-2 h-2 rounded-sm bg-primary-500" />Уже получено {money(paid)}
                        </span>
                      )}
                      {(fine + vacation) > 0 && (
                        <span className="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400">
                          <span className="w-2 h-2 rounded-sm bg-red-500" />Удержано {money(fine + vacation)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* Разбор: из чего сложилась сумма */}
        {showSalary && sal?.linked && row && (
          <div className="card lg:col-start-1 lg:row-start-2">
            <h3 className="section-title mb-1">Из чего сложилась сумма</h3>

            <Row label="Оклад за месяц" value={money(salary)} />

            {bonus > 0
              ? <>
                  <Row label="Бонусы" hint={bonusEntries.length ? pluralRu(bonusEntries.length, 'начисление', 'начисления', 'начислений') : null} value={`+${money(bonus)}`} tone="plus" />
                  <Detail entries={bonusEntries} sign="+" />
                </>
              : <Row label="Бонусы" empty="не начислялись" />}

            {fine > 0
              ? <>
                  <Row label="Штрафы" hint={fineEntries.length ? pluralRu(fineEntries.length, 'удержание', 'удержания', 'удержаний') : null} value={`−${money(fine)}`} tone="minus" />
                  <Detail entries={fineEntries} sign="−" />
                </>
              : <Row label="Штрафы" empty="нет" />}

            {vacation > 0
              ? <>
                  <Row label="Отпускные и невыходы" value={`−${money(vacation)}`} tone="minus" />
                  <Detail entries={vacationEntries} sign="−" />
                </>
              : <Row label="Отпускные и невыходы" empty="нет" />}

            {paid > 0
              ? <>
                  <Row label="Уже получено" hint={row.advance > 0 ? `в том числе аванс ${money(row.advance)}` : null} value={`−${money(paid)}`} tone="paid" />
                  <Detail entries={advanceEntries} sign="+" />
                </>
              : <Row label="Уже получено" empty="выплат ещё не было" />}

            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl px-4 py-3.5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/25">
              <span className="text-[15px] font-semibold text-surface-900 dark:text-surface-100">
                {row.frozen ? 'Выплачено за месяц' : 'Остаток к выплате'}
              </span>
              <span className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {money(row.frozen ? paid : toPay)}
              </span>
            </div>
          </div>
        )}

        {/* Смены за тот же месяц */}
        {!isFounder && (
          <div className="card lg:col-start-2 lg:row-start-1">
            <div className="flex items-baseline justify-between gap-2 mb-3">
              <h3 className="section-title">Мои смены</h3>
              <span className="text-xs text-surface-400 dark:text-surface-500">{monthOnly(ym)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: hoursOf(mine?.totalMinutes || 0), l: 'всего за месяц', warn: false },
                { v: hoursOf(mine?.avgMinutes || 0), l: 'в среднем за смену', warn: false },
                { v: String(mine?.workedDays || 0), l: wordOf(mine?.workedDays || 0, 'рабочий день', 'рабочих дня', 'рабочих дней'), warn: false },
                { v: String(mine?.lateDays?.length || 0), l: wordOf(mine?.lateDays?.length || 0, 'опоздание', 'опоздания', 'опозданий'), warn: (mine?.lateDays?.length || 0) > 0 },
              ].map(tile => (
                <div key={tile.l} className="bg-surface-50 dark:bg-surface-700/50 rounded-xl p-3">
                  <p className={`text-lg font-bold tabular-nums ${tile.warn ? 'text-amber-600 dark:text-amber-400' : 'text-surface-900 dark:text-surface-100'}`}>{tile.v}</p>
                  <p className="text-[11px] text-surface-400 dark:text-surface-500 mt-0.5">{tile.l}</p>
                </div>
              ))}
            </div>
            {shifts?.lateAfter && (
              <p className="text-[11px] text-surface-400 dark:text-surface-500 mt-2.5">Опоздание — начало смены после {shifts.lateAfter}</p>
            )}
          </div>
        )}

        {/* История выплат */}
        {history.length > 0 && (
          <div className="card lg:col-start-2 lg:row-start-2">
            <h3 className="section-title mb-1">История выплат</h3>
            <div className="divide-y divide-surface-100 dark:divide-surface-700/60">
              {history.map(h => (
                <button
                  key={h.ym}
                  onClick={() => setYm(h.ym)}
                  className="w-full text-left flex items-center justify-between gap-3 py-3 px-1 -mx-1 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-700/40 transition-colors"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-surface-900 dark:text-surface-100 first-letter:uppercase">{monthOnly(h.ym)} {h.ym.slice(0, 4)}</span>
                    <span className="block text-[11px] text-surface-400 dark:text-surface-500 mt-0.5 truncate">
                      оклад {money(h.salary)}
                      {h.bonus > 0 ? ` · бонус ${money(h.bonus)}` : ''}
                      {h.fine > 0 ? ` · штраф ${money(h.fine)}` : ''}
                      {h.vacation > 0 ? ` · отпускные ${money(h.vacation)}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-semibold text-surface-900 dark:text-surface-100 tabular-nums">{money(h.paid)}</span>
                    {h.paidAt && <span className="block text-[11px] text-surface-400 dark:text-surface-500">{formatDate(h.paidAt)}</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Настройки: остался только пароль. Выбор языка и двухфакторная
          аутентификация убраны из профиля (решение владельца, 21.09.2026). */}
      <div className="card">
        <button onClick={() => setChangingPass(p => !p)} className="btn-secondary text-sm">
          <Key size={14} /> {t('auth.changePassword')}
        </button>

        {changingPass && (
          <form onSubmit={handleSubmit(onChangePassword)} className="space-y-3 mt-3 max-w-sm">
            <div>
              <label className="label">{t('auth.oldPassword')}</label>
              <input type="password" {...register('oldPassword', { required: true })} className="input" />
            </div>
            <div>
              <label className="label">{t('auth.newPassword')}</label>
              <input type="password" {...register('newPassword', { required: true, minLength: 8 })} className="input" minLength={8} />
            </div>
            <div>
              <label className="label">{t('auth.confirmPassword')}</label>
              <input type="password" {...register('confirm', { required: true })} className="input" />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary text-sm">{t('common.save')}</button>
              <button type="button" onClick={() => setChangingPass(false)} className="btn-secondary text-sm">{t('common.cancel')}</button>
            </div>
          </form>
        )}
      </div>

      {/* «Печать успеха» за выполненную задачу — с ролевой проверкой внутри */}
      <TaskCelebrationSection />
    </div>
  )
}

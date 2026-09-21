import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth.store'
import { authApi, usersApi, meApi, workShiftsApi } from '@/services/api.service'
import { useTranslation } from '@/i18n'
import { Avatar } from '@/components/ui'
import { Key, Camera, Globe, Wallet, Timer, ChevronLeft, ChevronRight, History } from 'lucide-react'
import { getUserPositionLabel } from '@/lib/permissions'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import TwoFactorSection from '@/components/profile/TwoFactorSection'
import TaskCelebrationSection from '@/components/profile/TaskCelebrationSection'
import { prepareAvatar } from '@/lib/imageCompress'
import { money, monthLabel, shiftYm, currentSalaryYm, pluralRu, formatDate } from '@/pages/finance/finlib'

/** Часы из минут: «68 ч 12 м», «45 м», «—». */
function hoursOf(min: number): string {
  const v = Math.max(0, Math.round(Number(min) || 0))
  if (!v) return '—'
  const h = Math.floor(v / 60)
  const m = v % 60
  if (!h) return `${m} м`
  return m ? `${h} ч ${m} м` : `${h} ч`
}

/** «12.09» — короткая дата начисления. */
const shortDate = (iso?: string | null) => (iso || '').slice(8, 10) + '.' + (iso || '').slice(5, 7)

type Entry = { id: string; date: string; amount: number; note?: string | null; comment?: string | null }

/** Строка денежной таблицы: подпись слева, сумма справа. */
function MoneyRow({ label, hint, value, tone, total }: {
  label: string; hint?: string | null; value: string
  tone?: 'plus' | 'minus'; total?: boolean
}) {
  const valueTone = total
    ? 'text-surface-900 dark:text-surface-50 text-lg font-bold'
    : tone === 'plus'
      ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
      : tone === 'minus'
        ? 'text-red-600 dark:text-red-400 font-semibold'
        : 'text-surface-900 dark:text-surface-100 font-semibold'
  return (
    <div className={`flex items-center justify-between gap-3 py-2.5 ${total ? 'border-t border-surface-200 dark:border-surface-700 mt-1 pt-3' : ''}`}>
      <span className="min-w-0">
        <span className={`block text-sm ${total ? 'font-semibold text-surface-900 dark:text-surface-100' : 'text-surface-600 dark:text-surface-300'}`}>{label}</span>
        {hint && <span className="block text-xs text-surface-400 dark:text-surface-500 mt-0.5">{hint}</span>}
      </span>
      <span className={`shrink-0 tabular-nums ${valueTone}`}>{value}</span>
    </div>
  )
}

/** Расшифровка начислений: дата, причина, сумма. Без неё «к выплате»
 *  не сходится и человек идёт спрашивать. */
function Detail({ entries, sign }: { entries: Entry[]; sign: '+' | '−' }) {
  if (!entries.length) return null
  return (
    <div className="ml-3 pl-3 border-l-2 border-surface-200 dark:border-surface-700 space-y-1 pb-1">
      {entries.map(e => (
        <div key={e.id} className="flex items-baseline gap-2 text-xs">
          <span className="text-surface-400 dark:text-surface-500 tabular-nums shrink-0">{shortDate(e.date)}</span>
          <span className="text-surface-600 dark:text-surface-300 flex-1 min-w-0 truncate">{e.note || e.comment || '—'}</span>
          <span className={`tabular-nums shrink-0 ${sign === '+' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
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
  const [pickingLang, setPickingLang] = useState(false)
  const { register, handleSubmit, reset } = useForm()
  const { t, locale, setLocale } = useTranslation()
  const fileRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  const languages = [
    { code: 'ru', name: 'Русский' },
    { code: 'en', name: 'English' },
    { code: 'tj', name: 'Тоҷикӣ' },
  ]

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

  return (
    <div className="space-y-5 max-w-2xl">
      <h1 className="page-title">{t('profile.title')}</h1>

      {/* Шапка: кто я и с какого числа работаю */}
      <div className="card">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="relative group rounded-full shrink-0"
            title="Сменить аватар"
          >
            <Avatar name={user?.name} src={user?.avatar} size={64} zoomable={false} />
            <span className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <Camera size={20} className="text-white" />
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
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-surface-900 dark:text-surface-100 truncate">{user?.name}</h2>
            <p className="text-sm text-surface-500 dark:text-surface-400 truncate">{user?.email}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className="badge bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400">{getUserPositionLabel(user)}</span>
              <span className={`badge ${user?.isActive ? 'status-done' : 'status-cancelled'}`}>
                {user?.isActive ? t('common.active') : t('common.inactive')}
              </span>
              {emp?.hireDate && (
                <span className="badge bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300">
                  с {formatDate(emp.hireDate)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Зарплата за месяц. Владельцу карточку не показываем, пока его
          строки нет в ведомости: вся финансовая часть у него и так открыта. */}
      {!(isFounder && sal && !sal.linked) && (
      <div className="card">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Wallet size={16} className="text-primary-600 dark:text-primary-400" />
            <h3 className="section-title">Зарплата</h3>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setYm(shiftYm(ym, -1))} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500 dark:text-surface-400" title="Предыдущий месяц">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium text-surface-700 dark:text-surface-200 min-w-[110px] text-center">{monthLabel(ym, true)}</span>
            <button onClick={() => setYm(shiftYm(ym, 1))} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500 dark:text-surface-400" title="Следующий месяц">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {salLoading ? (
          <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-4">Загружаю…</p>
        ) : !sal?.linked ? (
          <p className="text-sm text-surface-500 dark:text-surface-400 text-center py-4">
            Зарплата пока не привязана к твоей учётной записи.<br />
            <span className="text-xs text-surface-400 dark:text-surface-500">Попроси руководство связать профиль с зарплатной ведомостью.</span>
          </p>
        ) : !row ? (
          <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-4">За этот месяц начислений нет</p>
        ) : (
          <>
            {row.frozen && (
              <div className="mb-2 text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2">
                Месяц закрыт и выплачен{row.paidAt ? ` · ${formatDate(row.paidAt)}` : ''}
              </div>
            )}
            <div className="divide-y divide-surface-100 dark:divide-surface-700/60">
              <MoneyRow label="Оклад за месяц" value={money(row.salary)} />
              <div>
                <MoneyRow
                  label="Бонусы"
                  hint={bonusEntries.length ? `${bonusEntries.length} ${pluralRu(bonusEntries.length, 'начисление', 'начисления', 'начислений')}` : null}
                  value={`+${money(row.bonus)}`}
                  tone="plus"
                />
                <Detail entries={bonusEntries} sign="+" />
              </div>
              <div>
                <MoneyRow
                  label="Штрафы"
                  hint={fineEntries.length ? `${fineEntries.length} ${pluralRu(fineEntries.length, 'удержание', 'удержания', 'удержаний')}` : null}
                  value={`−${money(row.fine)}`}
                  tone="minus"
                />
                <Detail entries={fineEntries} sign="−" />
              </div>
              <div>
                <MoneyRow label="Отпускные и невыходы" value={`−${money(row.vacation)}`} tone="minus" />
                <Detail entries={vacationEntries} sign="−" />
              </div>
              <div>
                <MoneyRow
                  label="Уже выплачено"
                  hint={row.advance > 0 ? `в том числе аванс ${money(row.advance)}` : null}
                  value={money(row.paid)}
                />
                <Detail entries={advanceEntries} sign="+" />
              </div>
              <MoneyRow label="К выплате" value={money(row.toPay)} total />
            </div>
          </>
        )}
      </div>
      )}

      {/* Мои смены за месяц */}
      {!isFounder && (
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <Timer size={16} className="text-primary-600 dark:text-primary-400" />
            <h3 className="section-title">Мои смены</h3>
            <span className="text-xs text-surface-400 dark:text-surface-500">{monthLabel(ym, true)}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { v: hoursOf(mine?.totalMinutes || 0), l: 'всего за месяц' },
              { v: hoursOf(mine?.avgMinutes || 0), l: 'в среднем за день' },
              { v: String(mine?.workedDays || 0), l: 'рабочих дней' },
              { v: String(mine?.lateDays?.length || 0), l: 'опозданий' },
            ].map(tile => (
              <div key={tile.l} className="bg-surface-50 dark:bg-surface-700/50 rounded-xl p-3">
                <p className="text-base font-bold text-surface-900 dark:text-surface-100 tabular-nums">{tile.v}</p>
                <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">{tile.l}</p>
              </div>
            ))}
          </div>
          {shifts?.lateAfter && (
            <p className="text-[11px] text-surface-400 dark:text-surface-500 mt-2">Опозданием считается начало смены после {shifts.lateAfter}</p>
          )}
        </div>
      )}

      {/* История выплат — закрытые месяцы */}
      {history.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <History size={16} className="text-primary-600 dark:text-primary-400" />
            <h3 className="section-title">История выплат</h3>
          </div>
          <div className="divide-y divide-surface-100 dark:divide-surface-700/60">
            {history.map(h => (
              <button
                key={h.ym}
                onClick={() => setYm(h.ym)}
                className="w-full text-left flex items-center justify-between gap-3 py-2.5 hover:bg-surface-50 dark:hover:bg-surface-700/40 rounded-lg px-1 -mx-1 transition-colors"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-surface-900 dark:text-surface-100">{monthLabel(h.ym, true)}</span>
                  <span className="block text-xs text-surface-400 dark:text-surface-500 mt-0.5">
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

      {/* Настройки: язык и пароль — одной строкой */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setPickingLang(p => !p)} className="btn-secondary text-sm">
            <Globe size={14} /> Язык: {languages.find(l => l.code === locale)?.name || 'Русский'}
          </button>
          <button onClick={() => setChangingPass(p => !p)} className="btn-secondary text-sm">
            <Key size={14} /> {t('auth.changePassword')}
          </button>
        </div>

        {pickingLang && (
          <div className="grid grid-cols-3 gap-2 mt-3">
            {languages.map(l => (
              <button key={l.code} onClick={() => { setLocale(l.code as any); setPickingLang(false) }}
                className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors ${locale === l.code
                  ? 'bg-primary-600 border-primary-600 text-white'
                  : 'bg-surface-50 dark:bg-surface-700/50 border-surface-200 dark:border-surface-700 text-surface-700 dark:text-surface-300 hover:border-primary-400'}`}>
                {l.name}
              </button>
            ))}
          </div>
        )}

        {changingPass && (
          <form onSubmit={handleSubmit(onChangePassword)} className="space-y-3 mt-3">
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

      {/* 2FA — двухфакторная аутентификация */}
      <TwoFactorSection />
    </div>
  )
}

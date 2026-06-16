import { useState, useMemo, useEffect, lazy, Suspense } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { clientsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { Modal, EmptyState, PageLoader, ConfirmDialog, Pagination } from '@/components/ui'
import { Plus, Search, Edit, Trash2, List, LayoutGrid, Phone, Instagram, Mail, Calendar as CalendarIcon, Flame, Snowflake, Sun, User as UserIcon, AlertCircle, Circle, Check } from 'lucide-react'
import { useForm, Controller } from 'react-hook-form'
import { DatePicker, DateTimePicker } from '@/components/ui/DatePicker'
import { CollapsibleField } from '@/components/ui/CollapsibleField'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'

// Канбан-доска онбординга — отрисовывается прямо здесь при переключении
// view-mode. Lazy, чтобы не тянуть в bundle когда юзер не открывает kanban.
const OnboardingPage = lazy(() => import('@/pages/onboarding/OnboardingPage'))

/** Подписи этапов онбординга — для бейджа в списке клиентов. */
const ONBOARDING_STAGE_LABELS: Record<string, string> = {
  negotiation: 'Переговор',
  meeting: 'Встреча',
  kp_creation: 'Создание КП',
  contract: 'Договор',
  implementation: 'Реализация',
  cancelled: 'Отмена',
}

const STATUS_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: 'new',         label: 'Новый',              color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  { value: 'waiting',     label: 'Ожидание ответа',    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  { value: 'negotiating', label: 'В переговорах',      color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' },
  { value: 'proposal',    label: 'Предложение',        color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400' },
  { value: 'won',         label: 'Клиент ✓',           color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  { value: 'lost',        label: 'Отказ',              color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
  { value: 'on_hold',     label: 'На паузе',           color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
]

type InterestIcon = typeof Circle
const INTEREST_OPTIONS: { value: string; label: string; Icon: InterestIcon; color: string }[] = [
  { value: '',     label: 'Все',      Icon: Circle,    color: '' },
  { value: 'cold', label: 'Холодный', Icon: Snowflake, color: 'text-surface-500' },
  { value: 'warm', label: 'Тёплый',   Icon: Sun,       color: 'text-surface-500' },
  { value: 'hot',  label: 'Горячий',  Icon: Flame,     color: 'text-red-500' },
]

// Chip styles for interest filter — visual states
const INTEREST_CHIPS: { value: string; label: string; Icon: InterestIcon; bg: string; bgActive: string }[] = [
  { value: 'hot',  label: 'Горячие',  Icon: Flame,     bg: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',           bgActive: 'bg-red-500 text-white' },
  { value: 'warm', label: 'Тёплые',   Icon: Sun,       bg: 'bg-surface-100 text-surface-700 dark:bg-surface-900/30 dark:text-surface-400',   bgActive: 'bg-surface-500 text-white' },
  { value: 'cold', label: 'Холодные', Icon: Snowflake, bg: 'bg-surface-100 text-surface-700 dark:bg-surface-900/30 dark:text-surface-400',           bgActive: 'bg-surface-500 text-white' },
]

/** Города для селекта «Адрес». «Другое» открывает поле ручного ввода. */
const ADDRESS_OPTIONS = ['Душанбе']
const CHANNEL_OPTIONS = ['WhatsApp', 'Telegram', 'Instagram', 'Звонок', 'Email', 'Личная встреча']
const SOURCE_OPTIONS = ['Instagram', 'Рекомендация', 'Холодный обзвон', 'Сайт', 'Реклама', 'Другое']
const SPHERE_SUGGESTIONS = ['Ресторан', 'Кафе', 'Клиника', 'Школа', 'Салон красоты', 'Отель', 'Магазин', 'Блогер', 'Модель', 'SMM', 'Разработка', 'Другое']

/** true, если дата (локально) — сегодня. Нужно для оптимистичного
 *  bump KPI «Встречи»: метрика привязана к ДНЮ встречи, поэтому
 *  сегодняшний KPI трогаем только когда встреча назначена на сегодня. */
function isTodayLocal(iso?: string | null): boolean {
  if (!iso) return false
  const d = new Date(iso); const n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}

/** Оптимистично прибавляет delta к value метрики с заданным ключом
 *  в KPI-объекте {items: [{key, value, target, percent, done}, ...]}.
 *  WebSocket потом перетрёт точным значением с сервера. */
function bumpKpiValue(kpi: any, key: string, delta: number) {
  if (!kpi || !Array.isArray(kpi.items)) return kpi
  let touched = false
  const items = kpi.items.map((it: any) => {
    if (it.key !== key) return it
    touched = true
    const value = Math.max(0, (Number(it.value) || 0) + delta)
    const target = Number(it.target) || 0
    const percent = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0
    return { ...it, value, percent, done: value >= target }
  })
  if (!touched) return kpi
  const overall = Math.round(items.reduce((acc: number, i: any) => acc + (i.value / (i.target || 1)) * 100, 0) / items.length)
  return { ...kpi, items, overallPercent: Math.min(100, Math.max(0, overall)) }
}

export default function ClientsPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  // Дебаунсим поисковую строку — иначе при каждом keystroke стартует
  // новый запрос /clients и весь список перерисовывается (мигает).
  // 250 мс — компромисс между «отзывчивостью» и «не дёргать сервер».
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])
  const [status, setStatus] = useState('')
  const [interest, setInterest] = useState('')
  const [sphere, setSphere] = useState('')
  const [editLead, setEditLead] = useState<any>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  // Переключатель вида: list (таблица клиентов) ↔ kanban (доска онбординга).
  // Сохраняем в localStorage чтобы при возврате видеть тот же режим.
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>(() => {
    try { return (localStorage.getItem('clients-view') as 'list' | 'kanban') || 'list' } catch { return 'list' }
  })
  const setViewModePersisted = (v: 'list' | 'kanban') => {
    setViewMode(v)
    try { localStorage.setItem('clients-view', v) } catch {}
  }
  // У МП по продажам и у основателя/сооснователя — по 10 клиентов на странице,
  // у остальных ролей — 5.
  const role = useAuthStore(s => s.user?.role)
  const isSalesManager = role === 'sales_manager_smm' || role === 'sales_manager_dev'
  const isTopExec = role === 'founder' || role === 'co_founder' || role === 'admin'
  // Руководитель (может назначать звонки менеджерам через чекбоксы).
  const isBoss = role === 'admin' || role === 'founder' || role === 'co_founder'
  const PAGE_SIZE = (isSalesManager || isTopExec) ? 10 : 5

  // «Позвонить»: руководитель отмечает лида галочкой — звонок назначается
  // менеджеру-владельцу СРАЗУ (без отдельной кнопки), плюс фильтр
  // «только отмеченные к звонку».
  const [onlyCallRequested, setOnlyCallRequested] = useState(false)

  const { data: leads, isLoading } = useQuery({
    queryKey: ['clients', debouncedSearch, status, interest, sphere],
    queryFn: () => clientsApi.list({ search: debouncedSearch || undefined, status: status || undefined, interest: interest || undefined, sphere: sphere || undefined }),
    // Пока летит новый запрос — оставляем на экране предыдущий список,
    // чтобы страница не «обновлялась» полным экраном PageLoader при каждом
    // обновлении фильтров.
    placeholderData: keepPreviousData,
  })

  // Список под рендер: при фильтре «К звонку» оставляем только отмеченных.
  const displayLeads = onlyCallRequested
    ? (leads || []).filter((l: any) => l.callRequested)
    : (leads || [])
  const callRequestedCount = (leads || []).filter((l: any) => l.callRequested).length

  const { data: stats } = useQuery({
    queryKey: ['clients-stats'],
    queryFn: clientsApi.stats,
  })

  const queryKey = ['clients', debouncedSearch, status, interest, sphere]

  // Глубокий линк из KPI-модалки: /clients?id=<leadId> — открываем форму
  // редактирования этого клиента сразу, а не оставляем юзера искать руками
  // в общем списке. После открытия чистим query, чтобы при перезагрузке
  // F5 не открывалась снова. Если лид не найден (удалили / нет доступа) —
  // показываем toast, query тоже чистим.
  const location = useLocation()
  const navigate = useNavigate()
  // Deep-link из уведомления «📞 Звонки от руководителя» → сразу фильтр.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('callRequested') === '1') {
      setOnlyCallRequested(true)
      navigate(location.pathname, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search])
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const leadId = params.get('id')
    if (!leadId || !leads) return
    const lead = leads.find((l: any) => l.id === leadId)
    if (lead) {
      setEditLead(lead)
    } else {
      toast('Клиент не найден или удалён', { icon: 'ℹ️' })
    }
    // Убираем ?id из URL чтобы при F5 не триггерилось снова.
    navigate(location.pathname, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, location.search])

  const createMut = useMutation({
    mutationFn: clientsApi.create,
    onMutate: async (newLead: any) => {
      setShowCreate(false)
      await qc.cancelQueries({ queryKey: ['clients'] })
      const previous = qc.getQueryData(queryKey)
      const tempLead = {
        id: `temp-${Date.now()}`,
        ...newLead,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      qc.setQueryData(queryKey, (old: any[] = []) => [tempLead, ...old])
      // Оптимистичные бампы KPI — мгновенный отклик до прихода ответа сервера.
      // Создание клиента ВСЕГДА увеличивает new_companies (createdAt сегодня).
      qc.setQueriesData({ queryKey: ['sales-kpi'] }, (old: any) => bumpKpiValue(old, 'new_companies', +1))
      qc.setQueriesData({ queryKey: ['kpi-user'] },  (old: any) => bumpKpiValue(old, 'new_companies', +1))
      // Если сразу проставили callType='cold' — +1 к холодным звонкам.
      if (String(newLead?.callType || '').toLowerCase() === 'cold') {
        qc.setQueriesData({ queryKey: ['sales-kpi'] }, (old: any) => bumpKpiValue(old, 'cold_calls', +1))
        qc.setQueriesData({ queryKey: ['kpi-user'] },  (old: any) => bumpKpiValue(old, 'cold_calls', +1))
      }
      // Если сразу проставили emailStatus='sent' — +1 к персональным письмам.
      if (String(newLead?.emailStatus || '').toLowerCase() === 'sent') {
        qc.setQueriesData({ queryKey: ['sales-kpi'] }, (old: any) => bumpKpiValue(old, 'personal_emails', +1))
        qc.setQueriesData({ queryKey: ['kpi-user'] },  (old: any) => bumpKpiValue(old, 'personal_emails', +1))
      }
      // +1 к встречам ТОЛЬКО если встреча назначена на сегодня — KPI
      // встреч привязан к ДАТЕ встречи, а не к дате создания записи.
      if (isTodayLocal(newLead?.nextContactAt)) {
        qc.setQueriesData({ queryKey: ['sales-kpi'] }, (old: any) => bumpKpiValue(old, 'meetings', +1))
        qc.setQueriesData({ queryKey: ['kpi-user'] },  (old: any) => bumpKpiValue(old, 'meetings', +1))
      }
      // (Старая эвристика lastContactAt+email удалена — теперь
      // KPI personal_emails считается строго по emailStatus='sent',
      // bump для этого случая сделан выше.)
      return { previous, tempLead }
    },
    onError: (e: any, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous)
      toast.error(e?.response?.data?.message || 'Ошибка')
    },
    onSuccess: (server: any, _vars, ctx) => {
      qc.setQueryData(queryKey, (old: any[] = []) =>
        old.map(l => l.id === ctx?.tempLead.id ? server : l),
      )
      qc.invalidateQueries({ queryKey: ['clients-stats'] })
      qc.invalidateQueries({ queryKey: ['clients'] })
      // syncMeetingTask на бэке создал/обновил личную задачу — обновляем
      // календарь и список «Мои задачи», чтобы новый лид сразу был виден.
      qc.invalidateQueries({ queryKey: ['calendar'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      // Создание лида с продвинутым статусом / онбординг-этапом тоже
      // считается прогрессом по воронке (бэк пишет LEAD_PROGRESS).
      qc.invalidateQueries({ queryKey: ['sales-kpi'] })
      qc.invalidateQueries({ queryKey: ['kpi-user'] })
      qc.invalidateQueries({ queryKey: ['kpi-all'] })
      qc.invalidateQueries({ queryKey: ['kpi-details'] })
      toast.success('Клиент добавлен')
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => clientsApi.update(id, data),
    onMutate: async ({ id, data }: any) => {
      setEditLead(null)
      await qc.cancelQueries({ queryKey: ['clients'] })
      const previous = qc.getQueryData(queryKey)
      // Оптимистичные бампы KPI: считаем дельты для всех 3-х метрик,
      // которые могут поменяться через update (без перетаскивания).
      // WebSocket leads:changed потом перетрёт точной серверной цифрой.
      const lead = (previous as any[] | undefined)?.find(l => l.id === id)

      // 1) callType: ПЕРЕХОД в «cold» = +1 холодный звонок (событие).
      // Учёт событийный — уход из «cold» НЕ снимает звонок (он состоялся).
      const beforeCall = String(lead?.callType || '').toLowerCase()
      const afterCall = data?.callType !== undefined
        ? String(data.callType || '').toLowerCase()
        : beforeCall
      if (afterCall === 'cold' && beforeCall !== 'cold') {
        qc.setQueriesData({ queryKey: ['sales-kpi'] }, (old: any) => bumpKpiValue(old, 'cold_calls', +1))
        qc.setQueriesData({ queryKey: ['kpi-user'] },  (old: any) => bumpKpiValue(old, 'cold_calls', +1))
      }

      // 2) nextContactAt: KPI встреч считается на ДЕНЬ встречи. Сегодняшний
      //    KPI трогаем только по признаку «встреча сегодня» (было/стало).
      if (data?.nextContactAt !== undefined) {
        const wasToday = isTodayLocal(lead?.nextContactAt)
        const nowToday = isTodayLocal(data?.nextContactAt)
        if (wasToday !== nowToday) {
          const delta = nowToday ? +1 : -1
          qc.setQueriesData({ queryKey: ['sales-kpi'] }, (old: any) => bumpKpiValue(old, 'meetings', delta))
          qc.setQueriesData({ queryKey: ['kpi-user'] },  (old: any) => bumpKpiValue(old, 'meetings', delta))
        }
      }

      // 3) emailStatus: переход → 'sent' = +1, обратно = -1.
      // По аналогии с callType — точный учёт по полю «Письмо» в форме.
      if (data?.emailStatus !== undefined) {
        const beforeMail = String(lead?.emailStatus || '').toLowerCase()
        const afterMail = String(data?.emailStatus || '').toLowerCase()
        if (beforeMail !== afterMail) {
          const becameSent = afterMail === 'sent' && beforeMail !== 'sent'
          const leftSent = beforeMail === 'sent' && afterMail !== 'sent'
          if (becameSent || leftSent) {
            const delta = becameSent ? +1 : -1
            qc.setQueriesData({ queryKey: ['sales-kpi'] }, (old: any) => bumpKpiValue(old, 'personal_emails', delta))
            qc.setQueriesData({ queryKey: ['kpi-user'] },  (old: any) => bumpKpiValue(old, 'personal_emails', delta))
          }
        }
      }
      qc.setQueryData(queryKey, (old: any[] = []) =>
        old.map(l => l.id === id ? { ...l, ...data, updatedAt: new Date().toISOString() } : l),
      )
      return { previous }
    },
    onError: (e: any, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous)
      // Откат оптимистичного KPI — рефетчем.
      qc.invalidateQueries({ queryKey: ['sales-kpi'] })
      qc.invalidateQueries({ queryKey: ['kpi-user'] })
      toast.error(e?.response?.data?.message || 'Ошибка')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients-stats'] })
      // Любое изменение клиента (статус, стадия, контакты) должно
      // отразиться и в Онбординге — инвалидируем общий префикс.
      qc.invalidateQueries({ queryKey: ['clients'] })
      // И в Календаре + Задачах: следом за update'ом бэк пересинхронит
      // личную follow-up задачу (название/время/статус закрытия сделки).
      qc.invalidateQueries({ queryKey: ['calendar'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      // KPI воронки/менеджера — продвижения по status/onboardingStage
      // считаются из activity_logs бэком; виджеты дашборда должны
      // обновиться сразу, без F5.
      qc.invalidateQueries({ queryKey: ['sales-kpi'] })
      qc.invalidateQueries({ queryKey: ['kpi-user'] })
      qc.invalidateQueries({ queryKey: ['kpi-all'] })
      qc.invalidateQueries({ queryKey: ['kpi-details'] })
      toast.success('Сохранено')
    },
  })

  const deleteMut = useMutation({
    mutationFn: clientsApi.remove,
    onMutate: async (id: string) => {
      setDeleteId(null)
      await qc.cancelQueries({ queryKey: ['clients'] })
      const previous = qc.getQueryData(queryKey)
      qc.setQueryData(queryKey, (old: any[] = []) => old.filter(l => l.id !== id))
      // Оптимистично убираем из ВСЕХ закешированных списков клиентов
      // (с любыми фильтрами + ['clients'] на Онбординге).
      qc.setQueriesData({ queryKey: ['clients'] }, (old: any) =>
        Array.isArray(old) ? old.filter((l: any) => l.id !== id) : old,
      )
      return { previous }
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous)
      toast.error('Ошибка')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients-stats'] })
      // Гарантируем что Онбординг подхватит удаление без F5.
      qc.invalidateQueries({ queryKey: ['clients'] })
      toast.success('Удалено')
    },
  })

  // «Позвонить»: назначить/снять отметку обзвона.
  const callRequestMut = useMutation({
    mutationFn: ({ ids, flag }: { ids: string[]; flag: boolean }) => clientsApi.callRequest(ids, flag),
    onMutate: async ({ ids, flag }) => {
      await qc.cancelQueries({ queryKey: ['clients'] })
      const idSet = new Set(ids)
      qc.setQueriesData({ queryKey: ['clients'] }, (old: any) =>
        Array.isArray(old) ? old.map((l: any) => idSet.has(l.id) ? { ...l, callRequested: flag } : l) : old,
      )
    },
    onError: () => { qc.invalidateQueries({ queryKey: ['clients'] }); toast.error('Не удалось обновить') },
    onSuccess: (server: any, { flag }) => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      if (!flag) { toast.success('Отметка снята'); return }
      const d = server?.byDirection || {}
      const parts: string[] = []
      if (d.smm) parts.push(`СММ: ${d.smm}`)
      if (d.development) parts.push(`Разработка: ${d.development}`)
      if (d.none) parts.push(`без направления: ${d.none}`)
      const breakdown = parts.length ? ` (${parts.join(', ')})` : ''
      toast.success(`Назначено звонков: ${server?.updated ?? 0}${breakdown}`)
    },
  })

  // Reset page when filters change
  const filterKey = `${search}|${status}|${interest}|${sphere}`
  useMemo(() => setPage(1), [filterKey])

  const spheres = useMemo(() => {
    const set = new Set<string>()
    leads?.forEach((l: any) => l.sphere && set.add(l.sphere))
    return Array.from(set).sort()
  }, [leads])

  if (isLoading) return <PageLoader />

  const totalPotentialFmt = Number(stats?.openPotential || 0).toLocaleString('ru-RU')

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">База клиентов</h1>
          <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
            {viewMode === 'kanban' ? (
              <>Канбан-доска онбординга. Перетащите карточку, чтобы сменить этап.</>
            ) : (() => {
              const total = stats?.total ?? leads?.length ?? 0
              const shown = leads?.length ?? 0
              const filtered = !!(search || status || interest || sphere)
              if (filtered && shown !== total) {
                return <>Показано <b className="text-surface-800 dark:text-surface-200">{shown}</b> из {total} лидов · потенциал {totalPotentialFmt} сомони</>
              }
              return <>{total} лидов · потенциал {totalPotentialFmt} сомони</>
            })()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Переключатель: список ↔ канбан онбординга. */}
          <div className="inline-flex rounded-md border border-surface-200 dark:border-surface-700 overflow-hidden">
            <button
              onClick={() => setViewModePersisted('list')}
              title="База клиентов (список)"
              className={clsx(
                'p-2 transition-colors',
                viewMode === 'list'
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-50 dark:bg-surface-800 text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200',
              )}
            >
              <List size={16} />
            </button>
            <button
              onClick={() => setViewModePersisted('kanban')}
              title="Онбординг (канбан)"
              className={clsx(
                'p-2 transition-colors',
                viewMode === 'kanban'
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-50 dark:bg-surface-800 text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200',
              )}
            >
              <LayoutGrid size={16} />
            </button>
          </div>
          {/* Кнопка «Добавить клиента» видна в обоих режимах (список и канбан),
              чтобы header не «прыгал» при переключении view. В канбан-режиме
              новый клиент создаётся сразу с onboardingStage = первый этап. */}
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus size={16} /> Добавить клиента
          </button>
        </div>
      </div>

      {/* Канбан-режим — отрисовываем встроенный OnboardingPage и скрываем
          фильтры/таблицу клиентов. */}
      {viewMode === 'kanban' && (
        <Suspense fallback={<PageLoader />}>
          <OnboardingPage embedded />
        </Suspense>
      )}

      {viewMode === 'list' && (
      <>
      {/* Status chips — always visible, same style as interest row */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-medium text-surface-500 dark:text-surface-400 mr-1">Статус:</span>
        <button
          onClick={() => setStatus('')}
          className={clsx(
            'px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
            !status
              ? 'bg-primary-600 text-white'
              : 'bg-surface-50 dark:bg-surface-800 text-surface-600 dark:text-surface-300 border border-surface-200 dark:border-surface-700',
          )}
        >
          Все
          {stats?.total !== undefined && <> · {stats.total}</>}
        </button>
        {STATUS_OPTIONS.map(s => {
          const n = stats?.byStatus?.[s.value]
          const active = status === s.value
          return (
            <button
              key={s.value}
              onClick={() => setStatus(active ? '' : s.value)}
              className={clsx(
                'px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                active ? 'ring-2 ring-primary-500 ' + s.color : s.color,
              )}
            >
              {s.label}{n !== undefined && <> · {n}</>}
            </button>
          )
        })}
      </div>

      {/* Interest chips — always visible. Counts come from backend stats
          if available (byInterest field), otherwise omitted gracefully. */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-medium text-surface-500 dark:text-surface-400 mr-1">Интерес:</span>
        <button
          onClick={() => setInterest('')}
          className={clsx(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
            !interest
              ? 'bg-primary-600 text-white'
              : 'bg-surface-50 dark:bg-surface-800 text-surface-600 dark:text-surface-300 border border-surface-200 dark:border-surface-700',
          )}
        >
          <Circle size={12} /> Все
          {stats?.byInterest && (
            <> · {(stats.byInterest.cold || 0) + (stats.byInterest.warm || 0) + (stats.byInterest.hot || 0) + (stats.byInterest.none || 0)}</>
          )}
        </button>
        {INTEREST_CHIPS.map(c => {
          const n = stats?.byInterest?.[c.value]
          const active = interest === c.value
          const Ico = c.Icon
          return (
            <button
              key={c.value}
              onClick={() => setInterest(active ? '' : c.value)}
              className={clsx(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                active ? c.bgActive + ' shadow-sm' : c.bg,
              )}
            >
              <Ico size={12} /> {c.label}{n !== undefined && <> · {n}</>}
            </button>
          )
        })}
        {/* «📞 К звонку» — отмеченные руководителем для обзвона. */}
        {callRequestedCount > 0 && (
          <button
            onClick={() => setOnlyCallRequested(v => !v)}
            className={clsx(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
              onlyCallRequested
                ? 'bg-amber-500 text-white shadow-sm'
                : 'bg-amber-200 text-amber-900 dark:bg-amber-800/40 dark:text-amber-200',
            )}
          >
            📞 К звонку · {callRequestedCount}
          </button>
        )}
      </div>

      {/* Search + sphere row */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 min-w-0">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по названию / сфере / контакту / адресу"
            className="input pl-9"
          />
        </div>
        <select value={sphere} onChange={e => setSphere(e.target.value)} className="input sm:w-48">
          <option value="">Все сферы</option>
          {spheres.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      {!leads?.length ? (
        <EmptyState
          title="Нет клиентов"
          description="Добавьте первого лида, чтобы начать ведение базы"
          action={<button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={16} /> Добавить клиента</button>}
        />
      ) : (
        <>
        <div className="card p-0 overflow-x-auto animate-fade-in stagger-rows" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-surface-100 dark:border-surface-700 text-left">
                <th className="px-2 sm:px-3 py-3 text-xs font-semibold text-surface-400 dark:text-surface-500 w-10 text-center">#</th>
                <th className="px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Название / Сфера</th>
                <th className="px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400 hidden md:table-cell">ЛПР / Контакт</th>
                <th className="px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Статус</th>
                <th className="px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400 hidden lg:table-cell">Интерес</th>
                <th className="px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400 text-right hidden lg:table-cell">Потенциал</th>
                <th className="px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400 hidden md:table-cell">Следующий контакт</th>
                <th className="px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {isBoss && (() => {
                      const rows = displayLeads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
                      const allChecked = rows.length > 0 && rows.every((l: any) => l.callRequested)
                      return (
                        <button
                          type="button"
                          title="Назначить звонок всем на странице"
                          disabled={callRequestMut.isPending}
                          onClick={() => {
                            const ids = rows.map((l: any) => l.id)
                            if (ids.length) callRequestMut.mutate({ ids, flag: !allChecked })
                          }}
                          className={clsx(
                            'inline-flex items-center justify-center w-[18px] h-[18px] rounded-md border-2 transition-all duration-150 disabled:opacity-50',
                            allChecked
                              ? 'bg-amber-500 border-amber-500 text-white'
                              : 'border-surface-300 dark:border-surface-600 hover:border-amber-400 text-transparent',
                          )}
                        >
                          <Check size={12} strokeWidth={3.5} />
                        </button>
                      )
                    })()}
                    <span>Действия</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {displayLeads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((l: any, idx: number) => {
                const statusOpt = STATUS_OPTIONS.find(s => s.value === l.status)
                const interestOpt = INTEREST_OPTIONS.find(i => i.value === l.interest)
                const nextIsSoon = l.nextContactAt && new Date(l.nextContactAt) <= new Date(Date.now() + 2 * 86400000)
                const nextIsOverdue = l.nextContactAt && new Date(l.nextContactAt) < new Date()
                return (
                  <tr
                    key={l.id}
                    onClick={() => setEditLead(l)}
                    className={clsx(
                      'border-b border-surface-50 dark:border-surface-700/50 hover:bg-surface-50 dark:hover:bg-surface-700/30 transition-colors cursor-pointer',
                      l.callRequested && 'bg-amber-100/80 dark:bg-amber-900/25 border-l-4 border-l-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/30',
                    )}
                  >
                    <td className="px-2 sm:px-3 py-3 text-center text-xs text-surface-400 dark:text-surface-500 tabular-nums font-medium align-top">
                      {(page - 1) * PAGE_SIZE + idx + 1}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-surface-900 dark:text-surface-100 flex items-center gap-1.5">
                        {l.name}
                        {l.direction && (
                          <span className={clsx(
                            'inline-flex text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                            l.direction === 'smm'
                              ? 'bg-surface-100 text-surface-700 dark:bg-surface-900/30 dark:text-surface-400'
                              : 'bg-surface-100 text-surface-700 dark:bg-surface-900/30 dark:text-surface-400',
                          )}>
                            {l.direction === 'smm' ? 'СММ' : 'Разработка'}
                          </span>
                        )}
                        {l.onboardingStage && (
                          <span className="inline-flex text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                            {ONBOARDING_STAGE_LABELS[l.onboardingStage] || l.onboardingStage}
                          </span>
                        )}
                        {l.callRequested && (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-amber-200 text-amber-900 dark:bg-amber-800/50 dark:text-amber-200"
                            title={l.callRequestedByName ? `Отметил: ${l.callRequestedByName}` : 'Назначен звонок'}
                          >
                            📞 Позвонить
                          </span>
                        )}
                      </div>
                      {l.sphere && <div className="text-[11px] text-surface-400 dark:text-surface-500 mt-0.5">{l.sphere}</div>}
                      {l.problem && <div className="text-[10px] text-surface-400 dark:text-surface-500 mt-0.5 italic truncate max-w-[200px]">{l.problem}</div>}
                      {/* mobile: contact inline */}
                      <div className="md:hidden mt-1 text-[11px] text-surface-500 dark:text-surface-400">
                        {l.contactPerson && <span className="inline-flex items-center gap-1"><UserIcon size={11} /> {l.contactPerson}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell align-top">
                      {l.contactPerson && <div className="text-sm text-surface-800 dark:text-surface-200">{l.contactPerson}</div>}
                      <div className="text-[11px] text-surface-500 dark:text-surface-400 space-y-0.5">
                        {l.contactPhone && <div className="inline-flex items-center gap-1"><Phone size={11} /> {l.contactPhone}</div>}
                        {l.contactInstagram && <div className="inline-flex items-center gap-1"><Instagram size={11} /> {l.contactInstagram}</div>}
                        {l.contactEmail && <div className="inline-flex items-center gap-1"><Mail size={11} /> {l.contactEmail}</div>}
                        {!l.contactPhone && !l.contactInstagram && !l.contactEmail && l.contactInfo && (
                          <div className="whitespace-pre-line">{l.contactInfo}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={clsx('inline-flex text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap', statusOpt?.color)}>
                        {statusOpt?.label || l.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell align-top text-sm">
                      {interestOpt ? (
                        <span className={clsx('inline-flex items-center gap-1', interestOpt.color)}>
                          <interestOpt.Icon size={12} /> {interestOpt.label}
                        </span>
                      ) : <span className="text-surface-400">—</span>}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell align-top text-right tabular-nums">
                      {l.dealPotential ? `${Number(l.dealPotential).toLocaleString('ru-RU')}` : <span className="text-surface-400">—</span>}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell align-top">
                      {l.nextContactAt ? (
                        <span className={clsx(
                          'text-xs inline-flex items-center gap-1',
                          nextIsOverdue ? 'text-red-500 font-semibold' : nextIsSoon ? 'text-surface-600 dark:text-surface-400' : 'text-surface-500 dark:text-surface-400',
                        )}>
                          {nextIsOverdue && <AlertCircle size={12} className="text-red-500" />}
                          {nextIsSoon && !nextIsOverdue && <AlertCircle size={12} className="text-surface-500" />}
                          {format(new Date(l.nextContactAt), 'dd.MM.yy HH:mm')}
                        </span>
                      ) : <span className="text-surface-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1.5 justify-end items-center">
                        {isBoss && (
                          <button
                            type="button"
                            onClick={() => callRequestMut.mutate({ ids: [l.id], flag: !l.callRequested })}
                            disabled={callRequestMut.isPending}
                            aria-pressed={!!l.callRequested}
                            title={l.callRequested ? 'Снять отметку «Позвонить»' : 'Назначить звонок менеджеру'}
                            className={clsx(
                              'inline-flex items-center justify-center w-[18px] h-[18px] rounded-md border-2 transition-all duration-150 mr-1 disabled:opacity-50',
                              l.callRequested
                                ? 'bg-amber-500 border-amber-500 text-white shadow-sm shadow-amber-500/30'
                                : 'border-surface-300 dark:border-surface-600 hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-transparent',
                            )}
                          >
                            <Check size={12} strokeWidth={3.5} />
                          </button>
                        )}
                        {l.callRequested && (
                          <button
                            onClick={() => callRequestMut.mutate({ ids: [l.id], flag: false })}
                            className="px-2 py-1 rounded-lg text-[11px] font-medium text-green-700 bg-green-100 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400"
                            title="Снять отметку «Позвонить»"
                          >
                            ✓ Позвонил
                          </button>
                        )}
                        <button onClick={() => setEditLead(l)} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500"><Edit size={14} /></button>
                        <button onClick={() => setDeleteId(l.id)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={displayLeads.length} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}
      </>
      )}

      {(showCreate || editLead) && (
        <ClientForm
          key={editLead?.id || 'new'}
          initial={editLead}
          onClose={() => { setShowCreate(false); setEditLead(null) }}
          onSubmit={(data: any) => {
            if (editLead) updateMut.mutate({ id: editLead.id, data })
            // МП по СММ — клиент сразу попадает в Онбординг (этап «Встреча»).
            // МП по разработке — без явного клика онбординг не ставим.
            else if (isSalesManager && role === 'sales_manager_dev') {
              createMut.mutate(data)
            } else {
              createMut.mutate({ ...data, onboardingStage: 'meeting' })
            }
          }}
          onSubmitWithOnboarding={
            // Кнопка «+ Добавить в онбординг» в форме создания у МП по разработке.
            !editLead && role === 'sales_manager_dev'
              ? (data: any) => createMut.mutate({ ...data, onboardingStage: 'negotiation' })
              : undefined
          }
          onAddToOnboarding={
            editLead && !editLead.onboardingStage
              ? () => updateMut.mutate({
                  id: editLead.id,
                  data: { onboardingStage: role === 'sales_manager_dev' ? 'negotiation' : 'meeting' },
                })
              : undefined
          }
          loading={createMut.isPending || updateMut.isPending}
        />
      )}

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMut.mutate(deleteId)}
        title="Удалить клиента?"
        message="Все данные лида будут удалены безвозвратно."
        danger
      />
    </div>
  )
}

function ClientForm({ initial, onClose, onSubmit, onSubmitWithOnboarding, loading, onAddToOnboarding }: any) {
  // Старые лиды могли иметь contactInfo одной строкой — раскладываем
  // эвристически: строка с @ — Instagram, с собакой — email, остальное — телефон.
  const parseLegacyContactInfo = (raw: string) => {
    const out = { phone: '', instagram: '', email: '' }
    if (!raw) return out
    for (const part of String(raw).split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)) {
      if (/^https?:\/\/(www\.)?instagram\.com/i.test(part) || /^@/.test(part)) out.instagram ||= part
      else if (/@/.test(part) && /\./.test(part)) out.email ||= part
      else out.phone ||= part
    }
    return out
  }
  const legacy = parseLegacyContactInfo(initial?.contactInfo)

  const { register, handleSubmit, watch, control, setValue } = useForm({ defaultValues: {
    name: initial?.name || '',
    sphere: initial?.sphere || '',
    problem: initial?.problem || '',
    address: initial?.address || '',
    contactPerson: initial?.contactPerson || '',
    contactPhone: initial?.contactPhone || legacy.phone,
    contactInstagram: initial?.contactInstagram || legacy.instagram,
    contactEmail: initial?.contactEmail || legacy.email,
    status: initial?.status || 'new',
    interest: initial?.interest || '',
    dealPotential: initial?.dealPotential || '',
    leadSource: initial?.leadSource || '',
    channel: initial?.channel || '',
    callType: initial?.callType || '',
    emailStatus: initial?.emailStatus || '',
    nextStep: initial?.nextStep || '',
    lastContactAt: initial?.lastContactAt ? String(initial.lastContactAt).slice(0, 10) : '',
    // nextContactAt в БД — UTC (timestamptz). Пикеру нужно ЛОКАЛЬНОЕ
    // настенное время YYYY-MM-DDTHH:mm, поэтому конвертируем UTC→локаль
    // через date-fns (иначе показывало бы время на −5ч от заданного).
    nextContactAt: initial?.nextContactAt ? format(new Date(initial.nextContactAt), "yyyy-MM-dd'T'HH:mm") : '',
    rejectionReason: initial?.rejectionReason || '',
  } })

  const currentStatus = watch('status')

  // Адрес: селект «Душанбе / Другое». «Другое» открывает ручной ввод.
  // Режим вычисляем из исходного значения: известный город → он сам,
  // непустое неизвестное → «Другое» (ручной ввод со старым значением).
  const addressVal = watch('address') || ''
  const [addrOther, setAddrOther] = useState<boolean>(
    !!(initial?.address && !ADDRESS_OPTIONS.includes(initial.address)),
  )

  const normalize = (data: any) => ({
    ...data,
    dealPotential: data.dealPotential ? Number(data.dealPotential) : null,
    interest: data.interest || null,
    callType: data.callType || null,
    emailStatus: data.emailStatus || null,
    lastContactAt: data.lastContactAt || null,
    // datetime-local → ISO. Если время не выбрано, бэкенд получит null.
    nextContactAt: data.nextContactAt ? new Date(data.nextContactAt).toISOString() : null,
    // Старое поле больше не редактируется напрямую, но оставляем его в payload
    // как «собранный текст» — для бэк-совместимости с местами, где оно ещё читается.
    contactInfo: [data.contactPhone, data.contactInstagram, data.contactEmail]
      .filter(Boolean).join('\n') || null,
  })
  const submit = (data: any) => onSubmit(normalize(data))
  const submitWithOnb = (data: any) => onSubmitWithOnboarding(normalize(data))

  // «+ Добавить в онбординг» — выносим в правый верхний угол модалки
  // (через titleAction), чтобы кнопка не плавала рядом с Save/Cancel.
  const onboardingAction = onAddToOnboarding ? (
    <button
      type="button"
      onClick={onAddToOnboarding}
      disabled={loading}
      className="px-3 py-1.5 rounded-md text-xs font-medium text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/30 hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors flex items-center gap-1"
    >
      <Plus size={14} /> В онбординг
    </button>
  ) : (!initial && onSubmitWithOnboarding) ? (
    <button
      type="button"
      onClick={handleSubmit(submitWithOnb)}
      disabled={loading}
      className="px-3 py-1.5 rounded-md text-xs font-medium text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/30 hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors flex items-center gap-1"
    >
      <Plus size={14} /> В онбординг
    </button>
  ) : null

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Редактировать клиента' : 'Новый клиент'}
      size="xl"
      titleAction={onboardingAction}
    >
      <form onSubmit={handleSubmit(submit)} className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="label">Название компании / клиента *</label>
            <input {...register('name', { required: true })} className="input" placeholder="ООО Ромашка, @blogger_name" />
          </div>
          <div>
            <label className="label">Сфера</label>
            <input list="sphere-list" {...register('sphere')} className="input" placeholder="Ресторан, Клиника, Блогер..." />
            <datalist id="sphere-list">
              {SPHERE_SUGGESTIONS.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
          <CollapsibleField
            label="Адрес"
            defaultOpen={!!initial?.address}
            hint={initial?.address || ''}
          >
            <select
              className="input"
              value={addrOther ? 'Другое' : (ADDRESS_OPTIONS.includes(addressVal) ? addressVal : '')}
              onChange={e => {
                const v = e.target.value
                if (v === 'Другое') { setAddrOther(true); setValue('address', '') }
                else { setAddrOther(false); setValue('address', v) }
              }}
            >
              <option value="">— Выберите —</option>
              {ADDRESS_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              <option value="Другое">Другое</option>
            </select>
            {addrOther && (
              <input
                {...register('address')}
                className="input mt-2"
                placeholder="Введите город / адрес"
                autoFocus
              />
            )}
          </CollapsibleField>
          <div className="sm:col-span-2">
            <label className="label">Проблема / что нужно</label>
            <textarea {...register('problem')} rows={2} className="input resize-none" placeholder="Разработка сайта, SMM-продвижение..." />
          </div>
          <div className="sm:col-span-2">
            <label className="label">ЛПР (кто принимает решение)</label>
            <input {...register('contactPerson')} className="input" placeholder="Иван Иванов — директор" />
          </div>
          <div>
            <label className="label inline-flex items-center gap-1"><Phone size={12} /> Телефон ЛПР</label>
            <input type="tel" {...register('contactPhone')} className="input" placeholder="+992 900 00 00 00" />
          </div>
          <div>
            <label className="label inline-flex items-center gap-1"><Instagram size={12} /> Instagram ЛПР</label>
            <input {...register('contactInstagram')} className="input" placeholder="@instagram_handle" />
          </div>
          <div className="sm:col-span-2">
            <label className="label inline-flex items-center gap-1"><Mail size={12} /> Email ЛПР</label>
            <input type="email" {...register('contactEmail')} className="input" placeholder="email@domain.com" />
          </div>
          <div>
            <label className="label">Статус *</label>
            <select {...register('status')} className="input">
              {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Степень интереса</label>
            <select {...register('interest')} className="input">
              <option value="">Не указано</option>
              <option value="cold">Холодный</option>
              <option value="warm">Тёплый</option>
              <option value="hot">Горячий</option>
            </select>
          </div>
          <div>
            <label className="label">Потенциал сделки (сомони)</label>
            <input type="number" min={0} step="0.01" {...register('dealPotential')} className="input" placeholder="10000" />
          </div>
          <CollapsibleField
            label="Источник лида"
            defaultOpen={!!initial?.leadSource}
            hint={initial?.leadSource || ''}
          >
            <input list="source-list" {...register('leadSource')} className="input" placeholder="Instagram, Рекомендация..." />
            <datalist id="source-list">
              {SOURCE_OPTIONS.map(s => <option key={s} value={s} />)}
            </datalist>
          </CollapsibleField>
          <CollapsibleField
            label="Канал общения"
            defaultOpen={!!initial?.channel}
            hint={initial?.channel || ''}
          >
            <input list="channel-list" {...register('channel')} className="input" placeholder="WhatsApp, Telegram..." />
            <datalist id="channel-list">
              {CHANNEL_OPTIONS.map(s => <option key={s} value={s} />)}
            </datalist>
          </CollapsibleField>
          <div>
            <label className="label">Тип звонка</label>
            <select {...register('callType')} className="input">
              <option value="">Не указано</option>
              <option value="cold">Холодный</option>
              <option value="neutral">Нейтральный</option>
              <option value="hot">Горячий</option>
            </select>
            <p className="text-[11px] text-surface-400 mt-1">
              «Холодный» → +1 в KPI «Холодные звонки» за сегодня
            </p>
          </div>
          <div>
            <label className="label">Письмо</label>
            <select {...register('emailStatus')} className="input">
              <option value="">Не указано</option>
              <option value="sent">Написал</option>
              <option value="answered">Ответили</option>
              <option value="no_reply">Не ответили</option>
              <option value="rejected">Отказ</option>
            </select>
            <p className="text-[11px] text-surface-400 mt-1">
              «Написал» → +1 в KPI «Персональные письма» за сегодня
            </p>
          </div>
          <CollapsibleField
            label="Дата последнего контакта"
            defaultOpen={!!initial?.lastContactAt}
            hint={initial?.lastContactAt ? String(initial.lastContactAt).slice(0, 10) : ''}
          >
            <Controller name="lastContactAt" control={control}
              render={({ field }) => <DatePicker value={field.value || ''} onChange={field.onChange} />} />
          </CollapsibleField>
          <div>
            <label className="label inline-flex items-center gap-1"><CalendarIcon size={12} /> Дата + время встречи / след. контакта</label>
            <Controller name="nextContactAt" control={control}
              render={({ field }) => <DateTimePicker value={field.value || ''} onChange={field.onChange} />} />
            <p className="text-[10px] text-surface-400 mt-1">
              Появится в Календаре на выбранный час и придёт напоминание.
            </p>
          </div>
          <CollapsibleField
            className="sm:col-span-2"
            label="Следующий шаг"
            defaultOpen={!!initial?.nextStep}
            hint={initial?.nextStep ? 'заполнено' : ''}
          >
            <textarea {...register('nextStep')} rows={2} className="input resize-none" placeholder="Отправить коммерческое предложение..." />
          </CollapsibleField>
          {currentStatus === 'lost' && (
            <div className="sm:col-span-2">
              <label className="label">Причина отказа</label>
              <textarea {...register('rejectionReason')} rows={2} className="input resize-none" placeholder="Дорого, уже есть подрядчик..." />
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Отмена</button>
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Сохранение...' : (initial ? 'Сохранить' : 'Добавить')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

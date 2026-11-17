// Раздел «Кастинг» (17.11.2026, docs/CASTING_SPEC.md §5): актёры, блогеры и
// модели WeBrand. Вкладки категорий с числами, чипы опыта, поиск по имени,
// сетка карточек; /casting/:id открывает карточку человека поверх списка.
// Фильтры живут в адресе — после карточки и «Назад» всё на месте.
import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Archive, EyeOff, Link2, Plus, Search, Upload, X } from 'lucide-react'
import clsx from 'clsx'
import { useAuthStore } from '@/store/auth.store'
import { castingApi, photoUrl } from '@/services/casting.api'
import { useUrlFlag, useUrlState } from '@/lib/urlState'
import { EmptyState } from '@/components/ui'
import {
  CASTING_TABS, CASTING_TAB_KEYS, TAG_LABEL, TAG_ORDER, categoriesText, metaLine, parseTagsParam,
} from '@/lib/casting'
import type { CastingCategory, CastingTab, CastingTag, TalentDetail, TalentListItem } from '@/types/casting'
import { castingKeys, castingRights, useDebounced } from './castingUi'
import TalentDetailSheet from './TalentDetailSheet'
import TalentForm from './TalentForm'
import ImportDialog from './ImportDialog'

const CATEGORY_TABS: CastingTab[] = ['actor', 'blogger', 'model']

export default function CastingPage() {
  const { id: openId } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const rights = castingRights(user)

  const [tab, setTab] = useUrlState<CastingTab>('cat', 'all', CASTING_TAB_KEYS)
  const [tagsRaw, setTagsRaw] = useUrlState<string>('tags', '')
  const tags = parseTagsParam(tagsRaw)
  const [archived, setArchived] = useUrlFlag('archived')
  const [q, setQ] = useUrlState<string>('q', '')
  const search = useDebounced(q.trim(), 250)

  const params = {
    search: search || undefined,
    category: CATEGORY_TABS.includes(tab) ? (tab as CastingCategory) : undefined,
    kids: tab === 'kids' || undefined,
    tags: tags.length ? tags : undefined,
    archived: archived || undefined,
  }
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: [...castingKeys.lists, params],
    queryFn: () => castingApi.list(params),
    placeholderData: keepPreviousData,
  })
  const items = data?.items || []
  const counts = data?.counts

  // Форма: null — закрыта, 'new' — новый человек, иначе — карточка.
  const [form, setForm] = useState<'new' | TalentDetail | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const toggleTag = (t: CastingTag) => {
    const next = tags.includes(t) ? tags.filter(x => x !== t) : TAG_ORDER.filter(x => x === t || tags.includes(x))
    setTagsRaw(next.join(','))
  }
  const filtered = !!(search || tags.length || tab !== 'all')
  const resetFilters = () => { setQ(''); setTagsRaw(''); setTab('all') }

  // Карточка: из списка — шаг истории (системный «Назад» закрывает её);
  // по прямой ссылке — закрытие ведёт на список.
  const openTalent = (id: string) => navigate({ pathname: `/casting/${id}`, search: location.search }, { state: { fromList: true } })
  const closeTalent = () => {
    if ((location.state as any)?.fromList) navigate(-1)
    else navigate({ pathname: '/casting', search: location.search }, { replace: true })
  }

  const copyLink = async () => {
    const url = `${window.location.origin}/public/casting`
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Ссылка для клиентов скопирована')
    } catch {
      toast(url, { duration: 8000 })
    }
  }

  const headBtn = 'min-h-[44px] lg:min-h-[34px]'
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title">Кастинг</h1>
          <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5">Актёры, блогеры и модели для съёмок</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={copyLink} className={clsx('btn-secondary', headBtn)} title="Скопировать ссылку на каталог для клиентов">
            <Link2 size={15} /><span className="sm:hidden">Ссылка</span><span className="hidden sm:inline">Ссылка для клиентов</span>
          </button>
          {rights.canImport && (
            <button type="button" onClick={() => setImportOpen(true)} className={clsx('btn-secondary', headBtn)}>
              <Upload size={15} /> Импорт
            </button>
          )}
          {rights.canEdit && (
            <button type="button" onClick={() => setForm('new')} className={clsx('btn-primary', headBtn)}>
              <Plus size={15} /> Добавить
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2.5">
        <div role="group" aria-label="Категория" className="flex gap-2 overflow-x-auto hide-scrollbar lg:flex-wrap">
          {CASTING_TABS.map(t => {
            const n = counts ? counts[t.key] : undefined
            const on = tab === t.key
            return (
              <button key={t.key} type="button" aria-pressed={on} onClick={() => setTab(t.key)} className={clsx('chip', on && 'chip-on')}>
                {t.label}
                {n != null && <span className={clsx('tabular-nums', on ? 'opacity-80' : 'text-surface-400')}>{n}</span>}
              </button>
            )
          })}
        </div>
        <div role="group" aria-label="Опыт" className="flex gap-2 overflow-x-auto hide-scrollbar lg:flex-wrap">
          {TAG_ORDER.map(k => {
            const on = tags.includes(k)
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => toggleTag(k)}
                className={clsx('chip', on ? 'chip-on' : 'border-dashed')}>
                {TAG_LABEL[k]}
              </button>
            )
          })}
        </div>
        <div className="flex gap-2 items-center">
          <label className="relative flex-1 min-w-0 sm:max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск по имени" aria-label="Поиск по имени"
              className="input pl-9 pr-9 min-h-[44px] lg:min-h-[36px]" />
            {q && (
              <button type="button" onClick={() => setQ('')} aria-label="Очистить поиск"
                className="absolute right-0 top-0 h-full w-10 grid place-items-center text-surface-400 hover:text-surface-600">
                <X size={15} />
              </button>
            )}
          </label>
          <button type="button" aria-pressed={archived} onClick={() => setArchived(!archived)}
            className={clsx('chip', archived && 'chip-on')} title="Показать тех, кто в архиве">
            <Archive size={14} /> Архив
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
              <div className="aspect-[3/4] bg-surface-200 dark:bg-surface-700 animate-pulse" />
              <div className="p-3 space-y-2">
                <div className="h-3.5 w-3/4 rounded bg-surface-200 dark:bg-surface-700 animate-pulse" />
                <div className="h-3 w-1/2 rounded bg-surface-200 dark:bg-surface-700 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <EmptyState title="Не удалось загрузить кастинг" description="Проверьте интернет и попробуйте ещё раз."
          action={<button type="button" className="btn-secondary" onClick={() => refetch()}>Повторить</button>} />
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState title="Никого не нашли" description="Снимите фильтр опыта или измените поиск."
            action={<button type="button" className="btn-secondary min-h-[44px] lg:min-h-[34px]" onClick={resetFilters}>Сбросить фильтры</button>} />
        ) : archived ? (
          <EmptyState title="В архиве пусто" />
        ) : (
          <EmptyState title="В кастинге пока никого"
            description={rights.canImport ? 'Загрузите базу из артефакта через «Импорт» или добавьте человека вручную.' : rights.canEdit ? 'Добавьте первого человека.' : 'Базу заполняет руководитель SMM.'}
            action={rights.canImport ? (
              <button type="button" className="btn-primary min-h-[44px] lg:min-h-[34px]" onClick={() => setImportOpen(true)}><Upload size={15} /> Импорт</button>
            ) : undefined} />
        )
      ) : (
        <>
          <p className={clsx('text-[12.5px] text-surface-500 dark:text-surface-400 transition-opacity', isFetching && 'opacity-60')}>
            Найдено: {items.length}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {items.map(t => <TalentCard key={t.id} t={t} search={location.search} onOpen={openTalent} />)}
          </div>
        </>
      )}

      {openId && (
        <TalentDetailSheet id={openId} onClose={closeTalent} onEdit={t => setForm(t)} />
      )}
      {form && (
        <TalentForm talent={form === 'new' ? null : form} onClose={() => setForm(null)}
          onCreated={t => { qc.setQueryData(castingKeys.talent(t.id), t); openTalent(t.id) }} />
      )}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </div>
  )
}

function TalentCard({ t, search, onOpen }: { t: TalentListItem; search: string; onOpen: (id: string) => void }) {
  const [broken, setBroken] = useState(false)
  const main = broken ? null : photoUrl(t.photo)
  const second = photoUrl(t.photo2)
  const meta = metaLine(t)
  return (
    <Link to={{ pathname: `/casting/${t.id}`, search }} state={{ fromList: true }}
      onClick={e => {
        // Обычный клик — через navigate (шаг истории с пометкой); с Ctrl/Cmd — новая вкладка как есть.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        onOpen(t.id)
      }}
      className={clsx('group block rounded-xl overflow-hidden border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800',
        'hover:border-surface-400 dark:hover:border-surface-500 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500',
        t.isArchived && 'opacity-60')}>
      <div className="relative aspect-[3/4] bg-surface-200 dark:bg-surface-700 overflow-hidden">
        {main ? (
          <>
            <img src={main} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)}
              className="absolute inset-0 w-full h-full object-cover" />
            {/* Второе фото — при наведении, только на компьютере. */}
            {second && (
              <img src={second} alt="" loading="lazy" decoding="async"
                className="absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity duration-300 hidden lg:block lg:group-hover:opacity-100" />
            )}
          </>
        ) : (
          <span className="absolute inset-0 grid place-items-center text-2xl font-semibold text-surface-400">
            {t.name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')}
          </span>
        )}
        {(!t.isPublic || t.isArchived) && (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/60 text-white text-[11px] font-semibold">
            {t.isArchived ? <><Archive size={11} /> Архив</> : <><EyeOff size={11} /> Скрыт</>}
          </span>
        )}
      </div>
      <div className="px-2.5 py-2 sm:px-3 sm:py-2.5">
        <div className="text-[13.5px] sm:text-sm font-semibold leading-snug text-surface-900 dark:text-surface-100 line-clamp-2 break-words">{t.name}</div>
        <div className="text-[12px] text-surface-500 dark:text-surface-400 mt-0.5 truncate">
          {meta || categoriesText(t.categories, t.kid) || '—'}
        </div>
      </div>
    </Link>
  )
}

// Карточка человека из кастинга (17.11.2026, docs/CASTING_SPEC.md §5):
// галерея, факты, метки, опыт, ссылки; для команды — контакты, гонорар,
// заметки, история съёмок и заявки клиентов. Открывается по /casting/:id.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, ExternalLink, EyeOff, Archive, Pencil } from 'lucide-react'
import clsx from 'clsx'
import { castingApi, photoUrl } from '@/services/casting.api'
import { useAuthStore } from '@/store/auth.store'
import { canAccessRoute } from '@/lib/permissions'
import { Spinner } from '@/components/ui'
import {
  BOOKING_STATUS_LABEL, TAG_LABEL, ageText, categoriesText, heightText, linkItems, orderedTags, phoneHref, telegramHref,
} from '@/lib/casting'
import type { BookingStatus, TalentDetail } from '@/types/casting'
import { CastingSheet, SectionLabel, castingKeys } from './castingUi'

const STATUS_CLS: Record<BookingStatus, string> = {
  invited: 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300',
  confirmed: 'bg-green-500/15 text-green-700 dark:text-green-400',
  declined: 'bg-red-500/10 text-red-600 dark:text-red-400',
}

const dateText = (iso: string | null | undefined, pattern = 'd MMMM yyyy') => {
  if (!iso) return '—'
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso)
  return Number.isNaN(d.getTime()) ? '—' : format(d, pattern, { locale: ru })
}

export default function TalentDetailSheet({ id, onClose, onEdit }: {
  id: string
  onClose: () => void
  onEdit: (t: TalentDetail) => void
}) {
  const { data: t, isLoading, isError } = useQuery({
    queryKey: castingKeys.talent(id),
    queryFn: () => castingApi.get(id),
    retry: false,
  })

  return (
    <CastingSheet size="xl" onClose={onClose} label={t?.name || 'Карточка'}
      title={t ? <span className="text-[13px] font-semibold text-surface-500 dark:text-surface-400">{categoriesText(t.categories, t.kid) || 'Кастинг'}</span> : 'Кастинг'}
      headerExtra={t?.canEdit ? (
        <button type="button" onClick={() => onEdit(t)} className="btn-secondary min-h-[44px] sm:min-h-[34px]">
          <Pencil size={15} /> Изменить
        </button>
      ) : null}>
      {isLoading ? (
        <div className="py-20 grid place-items-center"><Spinner /></div>
      ) : isError || !t ? (
        <div className="py-16 px-6 text-center">
          <p className="font-semibold text-surface-800 dark:text-surface-100">Карточка не открылась</p>
          <p className="text-sm text-surface-500 mt-1">Возможно, её удалили или у вас нет доступа.</p>
        </div>
      ) : (
        <div className="sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <Gallery photos={t.photos.map(p => p.path)} name={t.name} />
          <Info t={t} />
        </div>
      )}
    </CastingSheet>
  )
}

/** Галерея: большое фото, стрелки, свайп на телефоне, миниатюры. */
function Gallery({ photos, name }: { photos: string[]; name: string }) {
  const [cur, setCur] = useState(0)
  const startX = useRef<number | null>(null)
  useEffect(() => { if (cur >= photos.length) setCur(0) }, [photos.length, cur])
  const n = photos.length
  const go = (d: number) => n > 1 && setCur(i => (i + d + n) % n)

  if (!n) {
    return (
      <div className="aspect-[4/5] sm:aspect-[3/4] sm:sticky sm:top-0 sm:self-start bg-surface-100 dark:bg-surface-900 grid place-items-center text-sm text-surface-400">
        Фото пока нет
      </div>
    )
  }
  return (
    // На компьютере фото стоит на месте, пока листают сведения справа.
    <div className="bg-black overflow-hidden sm:sticky sm:top-0 sm:self-start">
      <div className="relative aspect-[4/5] sm:aspect-[3/4] select-none"
        onTouchStart={e => { startX.current = e.touches[0].clientX }}
        onTouchEnd={e => {
          if (startX.current == null) return
          const dx = e.changedTouches[0].clientX - startX.current
          startX.current = null
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1)
        }}>
        <img src={photoUrl(photos[cur]) || ''} alt={`${name}, фото ${cur + 1}`} className="absolute inset-0 w-full h-full object-cover" />
        {n > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Предыдущее фото"
              className="absolute left-2 top-1/2 -translate-y-1/2 w-11 h-11 grid place-items-center rounded-full bg-black/45 text-white hover:bg-black/60">
              <ChevronLeft size={20} />
            </button>
            <button type="button" onClick={() => go(1)} aria-label="Следующее фото"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 grid place-items-center rounded-full bg-black/45 text-white hover:bg-black/60">
              <ChevronRight size={20} />
            </button>
            <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/55 text-white text-[12px] font-semibold tabular-nums">{cur + 1} / {n}</span>
          </>
        )}
      </div>
      {n > 1 && (
        <div className="flex gap-1.5 p-2 overflow-x-auto hide-scrollbar bg-surface-900">
          {photos.map((p, i) => (
            <button key={p + i} type="button" onClick={() => setCur(i)} aria-label={`Фото ${i + 1}`} aria-current={i === cur}
              className={clsx('w-14 h-14 shrink-0 rounded-lg overflow-hidden border-2', i === cur ? 'border-white' : 'border-transparent opacity-70 hover:opacity-100')}>
              <img src={photoUrl(p) || ''} alt="" loading="lazy" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Fact({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={clsx('bg-surface-50 dark:bg-surface-800 px-3 py-2.5', wide && 'col-span-2')}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">{label}</div>
      <div className="text-[15px] font-semibold text-surface-900 dark:text-surface-100 mt-0.5 break-words">{value || '—'}</div>
    </div>
  )
}

function Info({ t }: { t: TalentDetail }) {
  const user = useAuthStore(s => s.user)
  const canOpenLeads = !!user && canAccessRoute(user.role, '/clients', user.secondaryRole, user.extraPermissions, user.deniedPermissions, user.isStoryMaker)
  const tags = orderedTags(t.tags)
  const links = linkItems(t.links)
  const tg = telegramHref(t.telegram)
  const tel = phoneHref(t.phone)
  const hasInternal = !!(t.phone || t.telegram || t.rate || t.notes)
  const age = ageText(t.age)

  return (
    <div className="p-4 sm:p-5 space-y-5 min-w-0">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-surface-900 dark:text-surface-50 break-words">{t.name}</h2>
        {(!t.isPublic || t.isArchived) && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {t.isArchived && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[12px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400">
                <Archive size={12} /> В архиве
              </span>
            )}
            {!t.isPublic && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[12px] font-semibold bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300">
                <EyeOff size={12} /> Не показывается клиентам
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-px rounded-xl overflow-hidden border border-surface-200 dark:border-surface-700 bg-surface-200 dark:bg-surface-700">
        <Fact label="Рост" value={heightText(t.height)} />
        <Fact label="Возраст" value={age ? `${age}${t.birthDate ? ` · ${dateText(t.birthDate, 'dd.MM.yyyy')}` : ''}` : ''} />
        <Fact label="Город" value={t.city || ''} wide />
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map(k => (
            <span key={k} className="px-2.5 py-1 rounded-md text-[12.5px] font-semibold bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-200">{TAG_LABEL[k]}</span>
          ))}
        </div>
      )}

      {t.experience?.trim() && (
        <section>
          <SectionLabel>Опыт</SectionLabel>
          <p className="text-[14.5px] leading-relaxed whitespace-pre-line text-surface-800 dark:text-surface-200 break-words">{t.experience}</p>
        </section>
      )}

      {links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {links.map(l => (
            <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[34px] px-3 rounded-full border border-surface-200 dark:border-surface-700 text-[13px] font-semibold text-surface-700 dark:text-surface-200 hover:border-surface-400 dark:hover:border-surface-500">
              {l.label} <ExternalLink size={13} />
            </a>
          ))}
        </div>
      )}

      {hasInternal && (
        <section className="rounded-xl border border-dashed border-surface-300 dark:border-surface-600 px-3.5 py-3">
          <SectionLabel>Для команды — клиенты этого не видят</SectionLabel>
          <dl className="space-y-1.5 text-[14px]">
            {t.phone && (
              <Row k="Телефон" v={tel ? <a href={tel} className="text-primary-600 dark:text-primary-300 hover:underline">{t.phone}</a> : t.phone} />
            )}
            {t.telegram && (
              <Row k="Telegram" v={tg ? <a href={tg} target="_blank" rel="noopener noreferrer" className="text-primary-600 dark:text-primary-300 hover:underline">{t.telegram}</a> : t.telegram} />
            )}
            {t.rate && <Row k="Гонорар" v={t.rate} />}
            {t.notes && <Row k="Заметки" v={<span className="whitespace-pre-line">{t.notes}</span>} />}
          </dl>
        </section>
      )}

      <section>
        <SectionLabel>Съёмки{t.shoots.length ? ` · ${t.shoots.length}` : ''}</SectionLabel>
        {t.shoots.length === 0 ? (
          <p className="text-[13px] text-surface-400">Пока ни в одной съёмке. Поставить в съёмку можно из её карточки в «СММ».</p>
        ) : (
          <ul className="divide-y divide-surface-100 dark:divide-surface-700 rounded-xl border border-surface-200 dark:border-surface-700">
            {t.shoots.map(s => (
              <li key={s.bookingId} className="flex items-center gap-3 px-3 py-2.5">
                <span className="w-16 shrink-0 text-[12.5px] tabular-nums text-surface-500">{dateText(s.date, 'd MMM yy')}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13.5px] font-semibold text-surface-800 dark:text-surface-100 truncate">{s.projectName || 'Проект'}</span>
                  {s.title && <span className="block text-[12.5px] text-surface-500 truncate">«{s.title}»</span>}
                </span>
                <span className={clsx('shrink-0 px-2 py-0.5 rounded-md text-[11.5px] font-semibold', STATUS_CLS[s.status] || STATUS_CLS.invited)}>
                  {BOOKING_STATUS_LABEL[s.status] || s.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionLabel>Заявки клиентов{t.requests.length ? ` · ${t.requests.length}` : ''}</SectionLabel>
        {t.requests.length === 0 ? (
          <p className="text-[13px] text-surface-400">Заявок с каталога пока не было.</p>
        ) : (
          <ul className="divide-y divide-surface-100 dark:divide-surface-700 rounded-xl border border-surface-200 dark:border-surface-700">
            {t.requests.map((r, i) => (
              <li key={(r.leadId || '') + i} className="flex items-center gap-3 px-3 py-2.5 min-h-[44px]">
                <span className="flex-1 min-w-0 text-[13.5px] font-semibold truncate">
                  {r.leadId && canOpenLeads ? (
                    <Link to={`/clients?lead=${encodeURIComponent(r.leadId)}`} className="text-primary-600 dark:text-primary-300 hover:underline">{r.leadName || 'Лид'}</Link>
                  ) : (
                    <span className="text-surface-800 dark:text-surface-100">{r.leadName || 'Лид удалён'}</span>
                  )}
                </span>
                <span className="shrink-0 text-[12.5px] text-surface-500 tabular-nums">{dateText(r.createdAt, 'd MMM yyyy')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-surface-500">{k}</dt>
      <dd className="flex-1 min-w-0 text-surface-800 dark:text-surface-100 break-words">{v}</dd>
    </div>
  )
}

// Справочники организатора съёмок: Клиенты / Модели / Места.
// Один компонент на три раздела (kind), полный CRUD. Доступ — грант
// organizer.directory (организатор, руководитель SMM, топ).
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { organizerApi } from '@/services/api.service'
import { ConfirmDialog, Modal } from '@/components/ui'
import { Plus, Search, Edit, Trash2, Contact, PersonStanding, MapPin, ExternalLink, ImagePlus, Loader2, X, Video } from 'lucide-react'
import toast from 'react-hot-toast'

type Kind = 'clients' | 'models' | 'places'

// Фронт может быть на другом домене (Vercel), чем backend (Railway) — фото
// строим по полному URL, как аватары (см. components/ui Avatar).
const UPLOADS_BASE = import.meta.env.VITE_API_URL || ''
const modelPhotoUrl = (filename: string) => `${UPLOADS_BASE}/uploads/models/${filename}`

interface Field {
  key: string
  label: string
  required?: boolean
  textarea?: boolean
  money?: boolean
  /** Загрузка фотографии (только для моделей). */
  photo?: boolean
  /** Ограничение длины текстового поля (совпадает с varchar в БД). */
  maxLength?: number
  placeholder?: string
  /** Выпадающий список вместо текстового поля. */
  options?: { value: string; label: string }[]
  /** Поле-ссылка: в таблице рендерится кликабельной (новая вкладка),
   *  при сохранении без схемы дописывается https://. */
  link?: boolean
  /** Список из НЕСКОЛЬКИХ ссылок (jsonb-массив): редактор с «+ Добавить
   *  ссылку», в таблице — «видео 1 · видео 2 · …». */
  links?: boolean
  /** Короткая подпись для шапки таблицы (если label слишком длинный). */
  shortLabel?: string
}

const CONFIGS: Record<Kind, { title: string; subtitle: string; icon: any; addLabel: string; fields: Field[] }> = {
  clients: {
    title: 'Клиенты',
    subtitle: 'Справочник клиентов для организации съёмок',
    icon: Contact,
    addLabel: 'Клиент',
    fields: [
      { key: 'name', label: 'Имя / название', required: true, placeholder: 'Клиника Индотач' },
      { key: 'company', label: 'Компания / бренд' },
      { key: 'phone', label: 'Телефон', placeholder: '+992 …' },
      { key: 'instagram', label: 'Instagram', placeholder: '@…' },
      { key: 'telegram', label: 'Telegram', placeholder: '@…' },
      { key: 'address', label: 'Адрес' },
      { key: 'note', label: 'Заметка', textarea: true },
    ],
  },
  models: {
    title: 'Модели',
    subtitle: 'Модели и актёры для съёмок',
    icon: PersonStanding,
    addLabel: 'Модель',
    fields: [
      { key: 'photo', label: 'Фотография', photo: true },
      { key: 'name', label: 'Имя', required: true },
      { key: 'gender', label: 'Пол', options: [{ value: 'female', label: 'Женский' }, { value: 'male', label: 'Мужской' }] },
      { key: 'phone', label: 'Телефон', placeholder: '+992 …' },
      { key: 'instagram', label: 'Instagram', placeholder: '@…' },
      { key: 'age', label: 'Возраст', placeholder: 'например, 25', maxLength: 60 },
      { key: 'appearance', label: 'Внешность', textarea: true, placeholder: 'рост, телосложение, цвет волос, глаза…' },
      { key: 'experience', label: 'Опыт', textarea: true, placeholder: 'съёмки, показы, портфолио…' },
      // Ссылки на видео с участием модели — показать клиентам её работы.
      { key: 'videoLinks', label: 'Ссылки на видео (работы модели)', shortLabel: 'Видео', links: true, placeholder: 'https://instagram.com/reel/…', maxLength: 500 },
      // Свободный текст, не money: организатору нужны диапазоны и символы
      // («400–600», «договорная») — числовой инпут не давал их ввести.
      { key: 'rate', label: 'Ставка за съёмку, с.', placeholder: '400, 400-600, договорная…', maxLength: 100 },
      // «Заметка» убрана по просьбе организатора — вместо неё знание языков.
      { key: 'languages', label: 'Знание языков', placeholder: 'русский, английский, таджикский…', maxLength: 200 },
    ],
  },
  places: {
    title: 'Места',
    subtitle: 'Локации для съёмок',
    icon: MapPin,
    addLabel: 'Место',
    fields: [
      { key: 'name', label: 'Название', required: true, placeholder: 'Кафе, студия, парк…' },
      { key: 'address', label: 'Адрес' },
      { key: 'contact', label: 'Контакт (администратор, телефон)' },
      { key: 'price', label: 'Стоимость аренды, с.', money: true },
      { key: 'link', label: 'Ссылка (карта / instagram)', link: true, placeholder: 'https://…' },
      { key: 'note', label: 'Заметка', textarea: true },
    ],
  },
}

const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
const showErr = (e: any) => toast.error(e?.response?.data?.message || 'Ошибка')

export default function OrganizerDirectoryPage({ kind }: { kind: Kind }) {
  const cfg = CONFIGS[kind]
  const Icon = cfg.icon
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<any | 'new' | null>(null)
  const [deleteRow, setDeleteRow] = useState<any | null>(null)

  const { data: rows = [], isLoading } = useQuery<any[]>({
    queryKey: ['organizer', kind, search],
    queryFn: () => organizerApi.list(kind, search || undefined),
  })

  // ── Фильтры моделей (клиентские — список небольшой и загружен целиком) ──
  const [fGender, setFGender] = useState('')
  const [fLang, setFLang] = useState('')
  const [fAgeFrom, setFAgeFrom] = useState('')
  const [fAgeTo, setFAgeTo] = useState('')
  const [fRateFrom, setFRateFrom] = useState('')
  const [fRateTo, setFRateTo] = useState('')
  const [fVideo, setFVideo] = useState('')
  const hasFilters = !!(fGender || fLang || fAgeFrom || fAgeTo || fRateFrom || fRateTo || fVideo)
  const resetFilters = () => { setFGender(''); setFLang(''); setFAgeFrom(''); setFAgeTo(''); setFRateFrom(''); setFRateTo(''); setFVideo('') }

  /** Первое число из свободного текста («300-400» → 300, «договорная» → null). */
  const firstNum = (v: any): number | null => {
    const m = String(v ?? '').match(/\d+/)
    return m ? Number(m[0]) : null
  }

  // Языки для селекта — собираем из данных («русский, английский и таджикский
  // с акцентом» → русский / английский / таджикский).
  const langOptions = useMemo(() => {
    if (kind !== 'models') return []
    const set = new Set<string>()
    for (const r of rows) {
      for (const part of String(r.languages || '').split(/[,;]|\sи\s/)) {
        const t = part.trim().toLowerCase().replace(/\s*с акцентом.*$/, '')
        if (t) set.add(t)
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'))
  }, [rows, kind])

  const filtered = useMemo(() => {
    if (kind !== 'models') return rows
    return rows.filter((r: any) => {
      if (fGender && r.gender !== fGender) return false
      if (fLang && !String(r.languages || '').toLowerCase().includes(fLang)) return false
      const age = firstNum(r.age)
      if (fAgeFrom && (age === null || age < Number(fAgeFrom))) return false
      if (fAgeTo && (age === null || age > Number(fAgeTo))) return false
      if (fRateFrom || fRateTo) {
        // Ставка — свободный текст («400», «300-400», «договорная»). Берём все
        // числа и сравниваем ДИАПАЗОНАМИ с перекрытием: «300-400» попадает и в
        // «от 350», и в «до 350». Без чисел («договорная») — скрываем.
        const nums = (String(r.rate ?? '').match(/\d+/g) || []).map(Number)
        if (!nums.length) return false
        const rMin = Math.min(...nums), rMax = Math.max(...nums)
        if (fRateFrom && rMax < Number(fRateFrom)) return false
        if (fRateTo && rMin > Number(fRateTo)) return false
      }
      const vids = Array.isArray(r.videoLinks) && r.videoLinks.length > 0
      if (fVideo === 'yes' && !vids) return false
      if (fVideo === 'no' && vids) return false
      return true
    })
  }, [rows, kind, fGender, fLang, fAgeFrom, fAgeTo, fRateFrom, fRateTo, fVideo])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['organizer', kind] })

  const removeMut = useMutation({
    mutationFn: (id: string) => organizerApi.remove(kind, id),
    onSuccess: () => { invalidate(); toast.success('Удалено') },
    onError: showErr,
  })

  // Колонки таблицы: все поля кроме длинных (textarea) и фото — они только в форме.
  const columns = cfg.fields.filter(f => !f.textarea && !f.photo)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            {kind !== 'places' && <Icon size={20} className="text-primary-600" />}
            <h1 className="page-title">{cfg.title}</h1>
          </div>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">{cfg.subtitle}</p>
        </div>
        <button onClick={() => setModal('new')} className="btn-primary text-sm">
          <Plus size={15} /> {cfg.addLabel}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по имени…"
            className="input pl-9 text-sm"
          />
        </div>
        {kind === 'models' && (
          <>
            <select value={fGender} onChange={e => setFGender(e.target.value)} className="input text-sm w-auto" title="Фильтр по полу">
              <option value="">Пол: все</option>
              <option value="female">Женский</option>
              <option value="male">Мужской</option>
            </select>
            <select value={fLang} onChange={e => setFLang(e.target.value)} className="input text-sm w-auto max-w-[180px]" title="Фильтр по знанию языка">
              <option value="">Язык: любой</option>
              {langOptions.map(l => <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>)}
            </select>
            <input value={fAgeFrom} onChange={e => setFAgeFrom(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
              placeholder="Возраст от" className="input text-sm w-[104px]" title="Минимальный возраст" />
            <input value={fAgeTo} onChange={e => setFAgeTo(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
              placeholder="до" className="input text-sm w-[72px]" title="Максимальный возраст" />
            <input value={fRateFrom} onChange={e => setFRateFrom(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
              placeholder="Ставка от" className="input text-sm w-[104px]" title="Минимальная ставка за съёмку" />
            <input value={fRateTo} onChange={e => setFRateTo(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
              placeholder="до, с." className="input text-sm w-[84px]" title="Максимальная ставка за съёмку (у «договорной» числа нет — при фильтре она скрывается)" />
            <select value={fVideo} onChange={e => setFVideo(e.target.value)} className="input text-sm w-auto" title="Наличие видео с работой">
              <option value="">Видео: все</option>
              <option value="yes">С видео</option>
              <option value="no">Без видео</option>
            </select>
            {hasFilters && (
              <button type="button" onClick={resetFilters}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">
                <X size={13} /> Сбросить
              </button>
            )}
            <span className="text-xs text-surface-400">{filtered.length} из {rows.length}</span>
          </>
        )}
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200 dark:border-surface-700 text-left">
              {columns.map(c => (
                <th key={c.key} className="px-4 py-2.5 text-[11px] uppercase tracking-wide text-surface-400 font-semibold whitespace-nowrap">
                  {c.shortLabel || (c.money ? c.label.replace(', с.', '') : c.label)}
                </th>
              ))}
              <th className="px-4 py-2.5 w-20" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={columns.length + 1} className="px-4 py-8 text-center text-surface-400">Загрузка…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={columns.length + 1} className="px-4 py-10 text-center text-surface-400">
                Пусто — добавьте первую запись кнопкой «＋ {cfg.addLabel}»
              </td></tr>
            )}
            {!isLoading && rows.length > 0 && filtered.length === 0 && (
              <tr><td colSpan={columns.length + 1} className="px-4 py-10 text-center text-surface-400">
                Ничего не найдено по фильтрам
              </td></tr>
            )}
            {filtered.map((r: any) => (
              <tr key={r.id} onDoubleClick={() => setModal(r)}
                className="border-b border-surface-100 dark:border-surface-700/60 last:border-0 hover:bg-surface-50 dark:hover:bg-surface-700/40 cursor-pointer">
                {columns.map((c, i) => (
                  <td key={c.key} className="px-4 py-2.5 align-middle">
                    {i === 0 ? (
                      <div className="flex items-center gap-2.5">
                        {kind === 'models' && <ModelThumb photo={r.photo} name={r.name} />}
                        <div className="min-w-0">
                          <span className="font-semibold text-surface-900 dark:text-surface-100">{r[c.key]}</span>
                          {/* У моделей заметка убрана из формы — старые не показываем. */}
                          {kind !== 'models' && r.note && <p className="text-[11px] text-surface-400 truncate max-w-[220px]" title={r.note}>{r.note}</p>}
                        </div>
                      </div>
                    ) : c.options ? (
                      <span className="text-surface-600 dark:text-surface-300">{c.options.find(o => o.value === r[c.key])?.label ?? '—'}</span>
                    ) : c.money ? (
                      <span className="tabular-nums whitespace-nowrap">{r[c.key] != null ? `${nf.format(r[c.key])} с.` : '—'}</span>
                    ) : c.links ? (
                      Array.isArray(r[c.key]) && r[c.key].length ? (
                        <div className="flex flex-col gap-0.5">
                          {r[c.key].map((u: string, li: number) => (
                            <a key={li} href={u} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                              title={u}
                              className="inline-flex items-center gap-1 text-primary-600 hover:underline whitespace-nowrap">
                              <Video size={12} /> {r[c.key].length > 1 ? `видео ${li + 1}` : 'смотреть видео'}
                            </a>
                          ))}
                        </div>
                      ) : <span className="text-surface-400">—</span>
                    ) : c.link && r[c.key] ? (
                      <a href={r[c.key]} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                        title={r[c.key]}
                        className="inline-flex items-center gap-1 text-primary-600 hover:underline whitespace-nowrap">
                        <ExternalLink size={12} /> открыть
                      </a>
                    ) : (
                      <span className="text-surface-600 dark:text-surface-300">{r[c.key] || '—'}</span>
                    )}
                  </td>
                ))}
                <td className="px-4 py-2.5 whitespace-nowrap text-right">
                  <button onClick={e => { e.stopPropagation(); setModal(r) }} title="Редактировать"
                    className="p-1.5 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500"><Edit size={14} /></button>
                  <button onClick={e => { e.stopPropagation(); setDeleteRow(r) }} title="Удалить"
                    className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <DirectoryModal
          kind={kind}
          cfg={cfg}
          row={modal === 'new' ? undefined : modal}
          onClose={() => setModal(null)}
          onSaved={invalidate}
        />
      )}

      <ConfirmDialog
        open={!!deleteRow}
        title="Удалить запись?"
        message={deleteRow ? `«${deleteRow.name}» будет удалено безвозвратно.` : undefined}
        danger
        onConfirm={() => { if (deleteRow) removeMut.mutate(deleteRow.id) }}
        onClose={() => setDeleteRow(null)}
      />
    </div>
  )
}

function DirectoryModal({ kind, cfg, row, onClose, onSaved }: {
  kind: Kind; cfg: (typeof CONFIGS)[Kind]; row?: any; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(cfg.fields.filter(f => !f.links).map(f => [f.key, row?.[f.key] != null ? String(row[f.key]) : ''])),
  )
  // Поля-списки ссылок (videoLinks) — отдельное состояние-массив.
  // Fallback на legacy videoLink — для записей, сохранённых до миграции.
  const linksField = cfg.fields.find(f => f.links)
  const [links, setLinks] = useState<string[]>(() => {
    if (!linksField) return []
    const arr = Array.isArray(row?.[linksField.key]) ? row[linksField.key].filter(Boolean) : []
    if (arr.length) return arr
    if (row?.videoLink) return [row.videoLink]
    return ['']
  })
  const [busy, setBusy] = useState(false)
  // Загрузка фото идёт асинхронно внутри PhotoPicker; пока имя файла не пришло,
  // сохранять нельзя — иначе запись уйдёт с photo=null и фото потеряется.
  const [photoBusy, setPhotoBusy] = useState(false)
  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  async function save() {
    if (!form.name?.trim() || busy || photoBusy) return
    setBusy(true)
    const payload: Record<string, any> = {}
    // Ссылка без схемы («youtube.com/…») → дописываем https://, чтобы клик
    // вёл точно на видео, а не на относительный путь внутри CRM.
    const normLink = (v: string) => /^https?:\/\//i.test(v) ? v : `https://${v.replace(/^\/+/, '')}`
    for (const f of cfg.fields) {
      if (f.links) {
        payload[f.key] = links.map(v => v.trim()).filter(Boolean).map(normLink)
        continue
      }
      const v = form[f.key]?.trim() ?? ''
      if (f.money) payload[f.key] = v === '' ? null : parseFloat(v.replace(',', '.'))
      else if (f.link && v !== '') payload[f.key] = normLink(v)
      else payload[f.key] = v === '' ? null : v
    }
    try {
      if (row) await organizerApi.update(kind, row.id, payload)
      else await organizerApi.create(kind, payload)
      onSaved()
      onClose()
      toast.success(row ? 'Сохранено' : 'Добавлено')
    } catch (e) { showErr(e) } finally { setBusy(false) }
  }

  // Общий Modal рендерится порталом в body: самодельный fixed-оверлей ловил
  // transform от анимации контейнера страницы и уезжал за верх экрана.
  return (
    <Modal open onClose={onClose} title={row ? `Изменить: ${row.name}` : `Новая запись — ${cfg.title.toLowerCase()}`}>
      <div className="space-y-3">
        {cfg.fields.map(f => (
          <div key={f.key}>
            <label className="label">{f.label}{f.required && ' *'}</label>
            {f.photo ? (
              <PhotoPicker value={form[f.key] || ''} onChange={v => set(f.key, v)} onBusyChange={setPhotoBusy} />
            ) : f.links ? (
              <LinksEditor links={links} onChange={setLinks} placeholder={f.placeholder} maxLength={f.maxLength} />
            ) : f.options ? (
              <select value={form[f.key]} onChange={e => set(f.key, e.target.value)} className="input text-sm">
                <option value="">—</option>
                {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.textarea ? (
              <textarea value={form[f.key]} onChange={e => set(f.key, e.target.value)} rows={2}
                placeholder={f.placeholder} className="input text-sm resize-y" />
            ) : (
              <input value={form[f.key]} onChange={e => set(f.key, e.target.value)}
                placeholder={f.placeholder} inputMode={f.money ? 'decimal' : undefined}
                maxLength={f.maxLength} className="input text-sm" />
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 mt-5">
        {photoBusy && <span className="text-xs text-surface-400 mr-auto">Фото загружается…</span>}
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600">
          Отмена
        </button>
        <button onClick={save} disabled={!form.name?.trim() || busy || photoBusy} className="btn-primary text-sm disabled:opacity-50">
          {row ? 'Сохранить' : 'Добавить'}
        </button>
      </div>
    </Modal>
  )
}

/** Редактор списка ссылок: строка на каждую ссылку + «＋ Добавить ссылку»,
 *  крестик убирает строку. Пустые строки отбрасываются при сохранении. */
function LinksEditor({ links, onChange, placeholder, maxLength }: {
  links: string[]; onChange: (l: string[]) => void; placeholder?: string; maxLength?: number
}) {
  const set = (i: number, v: string) => onChange(links.map((x, idx) => (idx === i ? v : x)))
  const remove = (i: number) => onChange(links.filter((_, idx) => idx !== i))
  return (
    <div className="space-y-2">
      {links.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={v}
            onChange={e => set(i, e.target.value)}
            placeholder={placeholder}
            maxLength={maxLength}
            className="input text-sm flex-1"
          />
          <button type="button" title="Убрать ссылку" onClick={() => remove(i)}
            className="p-1.5 rounded-lg text-surface-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0 transition-colors">
            <X size={14} />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...links, ''])}
        className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">
        <Plus size={13} /> Добавить ссылку
      </button>
    </div>
  )
}

// Типы, которые принимает бэкенд (organizer-directory.controller fileFilter).
// Проверяем на клиенте, чтобы не было «мигнул превью → сервер отверг».
const PHOTO_ACCEPT = ['image/jpeg', 'image/png', 'image/webp']

/** Полноэкранный просмотр фото (лайтбокс): тёмный фон, закрытие по клику
 *  мимо, крестику или Esc. Портал в body — поверх модалки редактирования. */
function ImageLightbox({ src, alt, onClose }: { src: string; alt?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    // capture: перехватываем Esc раньше модалки под лайтбоксом, иначе один
    // Esc закрыл бы и просмотр фото, и форму редактирования разом.
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return createPortal(
    <div
      className="fixed inset-0 z-[400] bg-black/85 flex items-center justify-center p-4 sm:p-8 animate-fade-in"
      onClick={e => { e.stopPropagation(); onClose() }}
      role="dialog" aria-modal="true" aria-label={alt || 'Просмотр фото'}
    >
      <img
        src={src}
        alt={alt || 'Фото'}
        onClick={e => e.stopPropagation()}
        className="max-w-full max-h-[90vh] rounded-xl object-contain shadow-2xl select-none"
      />
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onClose() }}
        title="Закрыть (Esc)"
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors"
      >
        <X size={20} />
      </button>
    </div>,
    document.body,
  )
}

/** Миниатюра модели в списке. Если файл не отдаётся (404 — например, после
 *  редеплоя на эфемерном диске), плавно откатываемся на плейсхолдер, а не на
 *  «сломанную картинку» браузера (тот же приём, что в общем Avatar). */
function ModelThumb({ photo, name }: { photo?: string | null; name?: string }) {
  const [failed, setFailed] = useState(false)
  const [zoom, setZoom] = useState(false)
  useEffect(() => { setFailed(false) }, [photo])

  if (photo && !failed) {
    return (
      <>
        {/* Клик по миниатюре — фото в полном размере (stopPropagation, чтобы
            не сработал dblclick-редактор строки). */}
        <button
          type="button"
          title="Показать фото"
          onClick={e => { e.stopPropagation(); setZoom(true) }}
          onDoubleClick={e => e.stopPropagation()}
          className="shrink-0 rounded-full cursor-zoom-in focus-visible:ring-2 focus-visible:ring-primary-500 outline-none"
        >
          <img
            src={modelPhotoUrl(photo)}
            alt={name}
            loading="lazy"
            onError={() => setFailed(true)}
            className="w-9 h-9 rounded-full object-cover bg-surface-100 dark:bg-surface-700"
          />
        </button>
        {zoom && <ImageLightbox src={modelPhotoUrl(photo)} alt={name} onClose={() => setZoom(false)} />}
      </>
    )
  }
  return (
    <span className="w-9 h-9 rounded-full bg-surface-100 dark:bg-surface-700 flex items-center justify-center shrink-0">
      <PersonStanding size={16} className="text-surface-400" />
    </span>
  )
}

/** Загрузка фото модели: превью-плейсхолдер, мгновенный локальный предпросмотр
 *  при выборе, фоновая загрузка на сервер. В value хранится имя файла.
 *  onBusyChange поднимает статус загрузки в модалку — пока фото грузится,
 *  кнопка «Сохранить» заблокирована, иначе запись ушла бы с photo=null. */
function PhotoPicker({ value, onChange, onBusyChange }: {
  value: string; onChange: (filename: string) => void; onBusyChange?: (busy: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  // Локальный предпросмотр (objectURL) до/во время загрузки — картинка видна сразу.
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Клик по фото — просмотр в полном размере (замена — по ссылке «Заменить»).
  const [zoom, setZoom] = useState(false)
  // Сервер вернул 404 на сохранённое фото → показываем плейсхолдер, не «битую» картинку.
  const [imgFailed, setImgFailed] = useState(false)
  // objectURL надо явно освобождать — иначе каждый выбор файла течёт в памяти.
  const objectUrlRef = useRef<string | null>(null)

  const revokeLocal = () => {
    if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null }
  }
  // Освобождаем последний objectURL при размонтировании (закрытии модалки).
  useEffect(() => revokeLocal, [])
  // Сбрасываем флаг «битой картинки», когда меняется сохранённое имя файла.
  useEffect(() => { setImgFailed(false) }, [value])

  const setUploading = (b: boolean) => { setBusy(b); onBusyChange?.(b) }
  const shownUrl = preview || (value && !imgFailed ? modelPhotoUrl(value) : null)

  async function pick(file?: File) {
    if (!file) return
    if (!PHOTO_ACCEPT.includes(file.type)) { toast.error('Только JPG, PNG или WEBP'); return }
    if (file.size > 5 * 1024 * 1024) { toast.error('Файл слишком большой (макс. 5 МБ)'); return }
    revokeLocal()
    const localUrl = URL.createObjectURL(file)
    objectUrlRef.current = localUrl
    setPreview(localUrl)
    setImgFailed(false)
    setUploading(true)
    try {
      const { filename } = await organizerApi.uploadPhoto(file)
      onChange(filename)
    } catch (e) {
      revokeLocal()
      setPreview(null)
      showErr(e)
    } finally {
      setUploading(false)
      // Сбрасываем value инпута, иначе повторный выбор того же файла (ретрай
      // после ошибки сети) не вызовет onChange.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function clear(e: MouseEvent) {
    e.stopPropagation()
    revokeLocal()
    setPreview(null)
    setImgFailed(false)
    onChange('')
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="flex items-center gap-4">
      {/* Клик по загруженному фото — просмотр в полном размере (лайтбокс);
          замена — по ссылке «Заменить» справа. Без фото клик открывает выбор файла. */}
      <button
        type="button"
        onClick={() => (shownUrl ? setZoom(true) : inputRef.current?.click())}
        className={`relative w-24 h-32 rounded-lg overflow-hidden border-2 border-dashed border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 hover:border-primary-400 dark:hover:border-primary-500 flex items-center justify-center shrink-0 transition-colors ${shownUrl ? 'cursor-zoom-in' : ''}`}
        title={shownUrl ? 'Показать в полном размере' : 'Загрузить фото'}
      >
        {shownUrl ? (
          <img src={shownUrl} alt="Фото модели" onError={() => setImgFailed(true)} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1 text-surface-400">
            <ImagePlus size={22} />
            <span className="text-[10px]">Фото</span>
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin text-white" />
          </div>
        )}
      </button>
      {zoom && shownUrl && <ImageLightbox src={shownUrl} alt="Фото модели" onClose={() => setZoom(false)} />}
      <div className="text-xs space-y-1.5">
        <button type="button" onClick={() => inputRef.current?.click()} className="block text-primary-600 dark:text-primary-400 hover:underline">
          {shownUrl ? 'Заменить' : 'Загрузить фото'}
        </button>
        {shownUrl && (
          <button type="button" onClick={clear} className="block text-red-500 hover:underline">Удалить</button>
        )}
        <p className="text-[11px] text-surface-400">JPG / PNG / WEBP, до 5 МБ</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={e => pick(e.target.files?.[0])}
      />
    </div>
  )
}

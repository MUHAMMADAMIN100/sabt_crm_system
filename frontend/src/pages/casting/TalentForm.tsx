// Форма «Добавить / Изменить» человека в кастинге (17.11.2026): все поля,
// фото (добавить, удалить, порядок), «показывать клиентам», архив.
// Фото у существующей карточки меняются сразу; у новой — уходят после
// создания карточки.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowLeft, ArrowRight, Archive, ArchiveRestore, ImagePlus, Star, Trash2, X } from 'lucide-react'
import clsx from 'clsx'
import { castingApi, photoUrl } from '@/services/casting.api'
import {
  CATEGORY_LABEL, CATEGORY_ORDER, TAG_LABEL, TAG_ORDER, moveItem, orderedTags, parseLinks,
} from '@/lib/casting'
import type { CastingCategory, CastingTag, TalentDetail, TalentInput, TalentPhoto } from '@/types/casting'
import { CastingSheet, SectionLabel, castingKeys, errorText, preparePhoto } from './castingUi'

interface Draft {
  name: string
  categories: CastingCategory[]
  city: string
  height: string
  birthDate: string
  age: string
  tags: CastingTag[]
  experience: string
  links: string
  phone: string
  telegram: string
  rate: string
  notes: string
  isPublic: boolean
}

const draftOf = (t?: TalentDetail | null): Draft => ({
  name: t?.name || '',
  categories: CATEGORY_ORDER.filter(c => (t?.categories || []).includes(c)),
  city: t?.city || '',
  height: t?.height || '',
  birthDate: t?.birthDate ? t.birthDate.slice(0, 10) : '',
  age: !t?.birthDate && t?.age != null ? String(t.age) : '',
  tags: orderedTags(t?.tags),
  experience: t?.experience || '',
  links: (t?.links || []).join('\n'),
  phone: t?.phone || '',
  telegram: t?.telegram || '',
  rate: t?.rate || '',
  notes: t?.notes || '',
  isPublic: t ? !!t.isPublic : true,
})

const orNull = (s: string) => (s.trim() ? s.trim() : null)
const MAX_PHOTOS_PER_UPLOAD = 10

export default function TalentForm({ talent, onClose, onCreated }: {
  /** null — новый человек. */
  talent: TalentDetail | null
  onClose: () => void
  onCreated?: (t: TalentDetail) => void
}) {
  const qc = useQueryClient()
  const isNew = !talent
  const [d, setD] = useState<Draft>(() => draftOf(talent))
  const initial = useMemo(() => draftOf(talent), [talent?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Фото новой карточки — до сохранения живут только в браузере.
  const [pending, setPending] = useState<Array<{ file: File; url: string }>>([])
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  useEffect(() => () => pendingRef.current.forEach(p => URL.revokeObjectURL(p.url)), [])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(prev => ({ ...prev, [k]: v }))
  const toggle = <T extends string>(list: T[], v: T, order: T[]): T[] =>
    list.includes(v) ? list.filter(x => x !== v) : order.filter(x => x === v || list.includes(x))

  const applyDetail = (t: TalentDetail) => {
    qc.setQueryData(castingKeys.talent(t.id), t)
    qc.invalidateQueries({ queryKey: castingKeys.lists })
  }

  // Ошибку видно и вверху формы, и всплывающим сообщением: на телефоне
  // кнопка «Сохранить» внизу, а начало формы может быть за краем экрана.
  const fail = (msg: string) => { setError(msg); toast.error(msg); return null }

  const buildInput = (): TalentInput | null => {
    const name = d.name.trim()
    if (name.length < 2) return fail('Укажите имя')
    if (!d.categories.length) return fail('Выберите хотя бы одну категорию')
    const ageNum = d.age.trim() ? Number(d.age) : null
    if (!d.birthDate && ageNum != null && (!Number.isInteger(ageNum) || ageNum < 0 || ageNum > 120)) {
      return fail('Возраст — целое число лет')
    }
    const input: TalentInput = {
      name,
      categories: d.categories,
      city: orNull(d.city),
      height: orNull(d.height),
      birthDate: d.birthDate || null,
      tags: d.tags,
      experience: orNull(d.experience),
      links: parseLinks(d.links),
      phone: orNull(d.phone),
      telegram: orNull(d.telegram),
      rate: orNull(d.rate),
      notes: orNull(d.notes),
      isPublic: d.isPublic,
    }
    // Возраст «на сегодня» отправляем, только если его ввели или поменяли:
    // иначе сервер зря сдвинул бы дату, от которой он считается.
    if (d.birthDate) { if (initial.age) input.ageBase = null }
    else if (isNew || d.age.trim() !== initial.age) input.ageBase = ageNum
    return input
  }

  const save = async () => {
    setError(null)
    const input = buildInput()
    if (!input) return
    setBusy(true)
    try {
      if (isNew) {
        let created = await castingApi.create(input)
        if (pending.length) {
          try {
            for (let i = 0; i < pending.length; i += MAX_PHOTOS_PER_UPLOAD) {
              const files = await Promise.all(pending.slice(i, i + MAX_PHOTOS_PER_UPLOAD).map(p => preparePhoto(p.file)))
              created = await castingApi.addPhotos(created.id, files)
            }
          } catch (e) {
            toast.error(errorText(e, 'Карточка создана, но фото не загрузились — добавьте их в «Изменить»'))
          }
        }
        applyDetail(created)
        toast.success('Добавлено в кастинг')
        onCreated?.(created)
        onClose()
      } else {
        const saved = await castingApi.update(talent!.id, input)
        applyDetail(saved)
        toast.success('Сохранено')
        onClose()
      }
    } catch (e) {
      fail(errorText(e, 'Не удалось сохранить'))
    } finally {
      setBusy(false)
    }
  }

  const archive = useMutation({
    mutationFn: (isArchived: boolean) => castingApi.update(talent!.id, { isArchived }),
    onSuccess: (t, isArchived) => {
      applyDetail(t)
      toast.success(isArchived ? 'Убрано в архив' : 'Возвращено из архива')
      onClose()
    },
    onError: e => toast.error(errorText(e, 'Не удалось')),
  })

  const field = 'input min-h-[44px] sm:min-h-[36px]'
  return (
    <CastingSheet size="lg" onClose={onClose} title={isNew ? 'Новый человек' : `Изменить: ${talent!.name}`}
      footer={(
        <div className="flex flex-wrap items-center gap-2">
          {!isNew && (
            <button type="button" disabled={archive.isPending || busy} onClick={() => archive.mutate(!talent!.isArchived)}
              className="btn-ghost min-h-[44px] sm:min-h-[34px]">
              {talent!.isArchived ? <><ArchiveRestore size={15} /> Вернуть из архива</> : <><Archive size={15} /> В архив</>}
            </button>
          )}
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="btn-secondary min-h-[44px] sm:min-h-[34px]">Отмена</button>
          <button type="button" disabled={busy} onClick={save} className="btn-primary min-h-[44px] sm:min-h-[34px]">
            {busy ? 'Сохраняю…' : isNew ? 'Добавить' : 'Сохранить'}
          </button>
        </div>
      )}>
      <form className="p-4 sm:p-5 space-y-5" onSubmit={e => { e.preventDefault(); save() }}>
        {error && (
          <p role="alert" className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p>
        )}

        <Field label="Имя и фамилия" required>
          <input className={field} value={d.name} onChange={e => set('name', e.target.value)} maxLength={200} autoFocus={isNew} />
        </Field>

        <Field label="Категории" required group>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_ORDER.map(c => (
              <button key={c} type="button" aria-pressed={d.categories.includes(c)}
                onClick={() => set('categories', toggle(d.categories, c, CATEGORY_ORDER))}
                className={clsx('chip', d.categories.includes(c) && 'chip-on')}>{CATEGORY_LABEL[c]}</button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Город">
            <input className={field} value={d.city} onChange={e => set('city', e.target.value)} maxLength={200} />
          </Field>
          <Field label="Рост, см">
            <input className={field} value={d.height} onChange={e => set('height', e.target.value)} maxLength={20} placeholder="175" inputMode="text" />
          </Field>
          <Field label="Дата рождения">
            <input type="date" className={field} value={d.birthDate} onChange={e => set('birthDate', e.target.value)} />
          </Field>
          <Field label="Возраст, лет" hint={d.birthDate ? 'Считается по дате рождения' : 'Если даты рождения нет'}>
            <input type="number" min={0} max={120} className={clsx(field, 'no-spin')} value={d.birthDate ? '' : d.age}
              disabled={!!d.birthDate} onChange={e => set('age', e.target.value)} inputMode="numeric" />
          </Field>
        </div>

        <Field label="Опыт" group>
          <div className="flex flex-wrap gap-2">
            {TAG_ORDER.map(k => (
              <button key={k} type="button" aria-pressed={d.tags.includes(k)}
                onClick={() => set('tags', toggle(d.tags, k, TAG_ORDER))}
                className={clsx('chip', d.tags.includes(k) && 'chip-on')}>{TAG_LABEL[k]}</button>
            ))}
          </div>
        </Field>

        <Field label="Описание опыта">
          <textarea className={clsx(field, 'resize-y leading-relaxed')} rows={3} value={d.experience}
            onChange={e => set('experience', e.target.value)} placeholder="Где снимался, какие роли, что умеет" />
        </Field>

        <Field label="Ссылки" hint="По одной в строке: Instagram, YouTube">
          <textarea className={clsx(field, 'resize-y')} rows={2} value={d.links} onChange={e => set('links', e.target.value)}
            placeholder="https://instagram.com/…" inputMode="url" />
        </Field>

        <PhotosBlock talent={talent} pending={pending} setPending={setPending} onDetail={applyDetail} />

        <label className="flex items-center gap-3 min-h-[44px] cursor-pointer select-none">
          <input type="checkbox" className="w-5 h-5 accent-primary-600" checked={d.isPublic} onChange={e => set('isPublic', e.target.checked)} />
          <span>
            <span className="block text-sm font-semibold text-surface-800 dark:text-surface-100">Показывать клиентам</span>
            <span className="block text-[12.5px] text-surface-500">В каталоге по ссылке /public/casting</span>
          </span>
        </label>

        <div className="rounded-xl border border-dashed border-surface-300 dark:border-surface-600 p-3.5 space-y-3">
          <SectionLabel>Для команды — клиенты этого не видят</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Телефон">
              <input type="tel" className={field} value={d.phone} onChange={e => set('phone', e.target.value)} maxLength={40} inputMode="tel" />
            </Field>
            <Field label="Telegram">
              <input className={field} value={d.telegram} onChange={e => set('telegram', e.target.value)} maxLength={64} placeholder="@ник" />
            </Field>
          </div>
          <Field label="Гонорар">
            <input className={field} value={d.rate} onChange={e => set('rate', e.target.value)} maxLength={120} placeholder="Например: 500 сомони за смену" />
          </Field>
          <Field label="Заметки">
            <textarea className={clsx(field, 'resize-y')} rows={2} value={d.notes} onChange={e => set('notes', e.target.value)} />
          </Field>
        </div>
        {/* Enter в поле отправляет форму. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </CastingSheet>
  )
}

/** Поле формы. Обычное поле оборачиваем в <label> — подпись привязана к
 *  нему; группу кнопок-чипов — в role="group" (label переслал бы нажатие
 *  на подпись первой кнопке). */
function Field({ label, hint, required, group, children }: {
  label: string; hint?: string; required?: boolean; group?: boolean; children: ReactNode
}) {
  const caption = <span className="label">{label}{required && <span className="text-red-500"> *</span>}</span>
  const tail = hint ? <span className="block text-[12px] text-surface-400 mt-1">{hint}</span> : null
  if (group) {
    return (
      <div role="group" aria-label={label} className="min-w-0">{caption}{children}{tail}</div>
    )
  }
  return <label className="block min-w-0">{caption}{children}{tail}</label>
}

/** Фото: выбрать карточку → «Раньше / Позже / Главным / Удалить». Кнопки
 *  под сеткой, а не на миниатюре — пальцем по ним легко попасть. */
function PhotosBlock({ talent, pending, setPending, onDetail }: {
  talent: TalentDetail | null
  pending: Array<{ file: File; url: string }>
  setPending: (fn: (p: Array<{ file: File; url: string }>) => Array<{ file: File; url: string }>) => void
  onDetail: (t: TalentDetail) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [photos, setPhotos] = useState<TalentPhoto[]>(talent?.photos || [])
  useEffect(() => { setPhotos(talent?.photos || []) }, [talent?.photos])
  const [sel, setSel] = useState<number | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => { setConfirmDel(false) }, [sel])

  const isNew = !talent
  const items: Array<{ key: string; url: string }> = isNew
    ? pending.map((p, i) => ({ key: `p${i}-${p.file.name}`, url: p.url }))
    : photos.map(p => ({ key: p.id, url: photoUrl(p.path) || '' }))

  const addFiles = async (list: FileList | null) => {
    const files = Array.from(list || []).filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name))
    if (inputRef.current) inputRef.current.value = ''
    if (!files.length) return
    if (isNew) {
      setPending(prev => [...prev, ...files.map(file => ({ file, url: URL.createObjectURL(file) }))])
      return
    }
    setBusy('Загружаю фото…')
    try {
      let last: TalentDetail | null = null
      for (let i = 0; i < files.length; i += MAX_PHOTOS_PER_UPLOAD) {
        const ready = await Promise.all(files.slice(i, i + MAX_PHOTOS_PER_UPLOAD).map(preparePhoto))
        last = await castingApi.addPhotos(talent!.id, ready)
      }
      if (last) { onDetail(last); setPhotos(last.photos) }
    } catch (e) {
      toast.error(errorText(e, 'Фото не загрузились'))
    } finally {
      setBusy(null)
    }
  }

  const move = async (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return
    setSel(to)
    if (isNew) { setPending(prev => moveItem(prev, from, to)); return }
    const next = moveItem(photos, from, to)
    const before = photos
    setPhotos(next)
    try {
      const t = await castingApi.reorderPhotos(talent!.id, next.map(p => p.id))
      onDetail(t)
    } catch (e) {
      setPhotos(before)
      toast.error(errorText(e, 'Порядок не сохранился'))
    }
  }

  const remove = async (i: number) => {
    setSel(null)
    if (isNew) {
      setPending(prev => {
        const p = prev[i]
        if (p) URL.revokeObjectURL(p.url)
        return prev.filter((_, j) => j !== i)
      })
      return
    }
    const photo = photos[i]
    if (!photo) return
    setBusy('Удаляю…')
    try {
      const t = await castingApi.removePhoto(photo.id)
      onDetail(t)
      setPhotos(t.photos)
    } catch (e) {
      toast.error(errorText(e, 'Не удалось удалить фото'))
    } finally {
      setBusy(null)
    }
  }

  const actionBtn = 'inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[34px] px-3 rounded-lg border border-surface-200 dark:border-surface-600 text-[13px] font-semibold text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-40'

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="label mb-0">Фото{items.length ? ` · ${items.length}` : ''}</span>
        {busy && <span className="text-[12.5px] text-surface-500">{busy}</span>}
      </div>
      <p className="text-[12px] text-surface-400 mb-2">Первое фото — главное на карточке. Нажмите на фото, чтобы переставить или удалить.</p>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {items.map((it, i) => (
          <button key={it.key} type="button" onClick={() => setSel(sel === i ? null : i)} aria-pressed={sel === i}
            aria-label={`Фото ${i + 1}${i === 0 ? ', главное' : ''}`}
            className={clsx('relative aspect-[3/4] rounded-lg overflow-hidden bg-surface-200 dark:bg-surface-700 outline-none',
              sel === i ? 'ring-2 ring-primary-600 dark:ring-primary-300 ring-offset-2 ring-offset-surface-50 dark:ring-offset-surface-800' : 'hover:opacity-90')}>
            <img src={it.url} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
            {i === 0 && (
              <span className="absolute top-1 left-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10.5px] font-semibold">
                <Star size={10} /> Главное
              </span>
            )}
          </button>
        ))}
        <button type="button" onClick={() => inputRef.current?.click()} disabled={!!busy}
          className="aspect-[3/4] rounded-lg border-2 border-dashed border-surface-300 dark:border-surface-600 grid place-items-center text-surface-500 hover:border-surface-400 hover:text-surface-700 dark:hover:text-surface-200 disabled:opacity-50">
          <span className="flex flex-col items-center gap-1 text-[12.5px] font-semibold"><ImagePlus size={20} /> Добавить</span>
        </button>
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple className="hidden"
        onChange={e => addFiles(e.target.files)} />

      {sel != null && sel < items.length && (
        <div className="mt-2 flex flex-wrap gap-2 rounded-xl bg-surface-100 dark:bg-surface-900/60 p-2">
          <button type="button" className={actionBtn} disabled={sel === 0 || !!busy} onClick={() => move(sel, sel - 1)}>
            <ArrowLeft size={15} /> Раньше
          </button>
          <button type="button" className={actionBtn} disabled={sel >= items.length - 1 || !!busy} onClick={() => move(sel, sel + 1)}>
            Позже <ArrowRight size={15} />
          </button>
          <button type="button" className={actionBtn} disabled={sel === 0 || !!busy} onClick={() => move(sel, 0)}>
            <Star size={15} /> Главным
          </button>
          <div className="flex-1" />
          {confirmDel ? (
            <>
              <button type="button" className={clsx(actionBtn, 'border-red-300 dark:border-red-800 text-red-600 dark:text-red-400')} disabled={!!busy} onClick={() => remove(sel)}>
                <Trash2 size={15} /> Удалить фото
              </button>
              <button type="button" className={actionBtn} onClick={() => setConfirmDel(false)} aria-label="Не удалять"><X size={15} /></button>
            </>
          ) : (
            <button type="button" className={clsx(actionBtn, 'text-red-600 dark:text-red-400')} disabled={!!busy} onClick={() => setConfirmDel(true)}>
              <Trash2 size={15} /> Удалить
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * «Кастинг» (17.11.2026, docs/CASTING_SPEC.md) — чистые помощники: подписи,
 * возраст словами, фильтр каталога, ссылки, проверка заявки и раскладка
 * импорта по пачкам. Без React и без сети — их проверяют тесты
 * (casting.test.ts).
 */
import type {
  BookingStatus, CastingCategory, CastingTab, CastingTag, PublicTalent,
} from '@/types/casting'

// ─── Подписи ─────────────────────────────────────────────────────────

export const CATEGORY_ORDER: CastingCategory[] = ['actor', 'blogger', 'model']

export const CATEGORY_LABEL: Record<CastingCategory, string> = {
  actor: 'Актёр',
  blogger: 'Блогер',
  model: 'Модель',
}

/** Вкладки списка — порядок как в артефакте. */
export const CASTING_TABS: Array<{ key: CastingTab; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'actor', label: 'Актёры' },
  { key: 'blogger', label: 'Блогеры' },
  { key: 'model', label: 'Модели' },
  { key: 'kids', label: 'Дети' },
]
export const CASTING_TAB_KEYS: CastingTab[] = CASTING_TABS.map(t => t.key)

export const TAG_ORDER: CastingTag[] = ['ads', 'film', 'theatre', 'clips', 'social', 'model']

export const TAG_LABEL: Record<CastingTag, string> = {
  ads: 'Реклама',
  film: 'Кино и сериалы',
  theatre: 'Театр',
  clips: 'Клипы',
  social: 'Ролики для соцсетей',
  model: 'Модельный опыт',
}

export const BOOKING_STATUSES: BookingStatus[] = ['invited', 'confirmed', 'declined']

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  invited: 'Приглашён',
  confirmed: 'Подтвердил',
  declined: 'Отказался',
}

/** Метки по порядку справочника; чужие ключи (старые данные) отбрасываем. */
export function orderedTags(tags: readonly string[] | null | undefined): CastingTag[] {
  const set = new Set(tags || [])
  return TAG_ORDER.filter(t => set.has(t))
}

/** «tags=ads,film» из адреса → ключи меток (неизвестные выбрасываем). */
export function parseTagsParam(raw: string | null | undefined): CastingTag[] {
  return orderedTags(String(raw || '').split(',').map(s => s.trim()).filter(Boolean))
}

// ─── Возраст и рост ──────────────────────────────────────────────────

/** 1 год, 2 года, 5 лет, 11 лет, 21 год, 112 лет. */
export function ageWord(n: number): 'год' | 'года' | 'лет' {
  const a = Math.abs(Math.trunc(n))
  const d = a % 10, h = a % 100
  if (d === 1 && h !== 11) return 'год'
  if (d >= 2 && d <= 4 && (h < 10 || h >= 20)) return 'года'
  return 'лет'
}

/** «24 года»; без возраста — пустая строка. */
export function ageText(age: number | null | undefined): string {
  if (age == null || !Number.isFinite(age)) return ''
  return `${age} ${ageWord(age)}`
}

/** «175 см». Рост — свободный текст ('180+', '154-155'); «см» не дублируем. */
export function heightText(height: string | null | undefined): string {
  const h = String(height || '').trim()
  if (!h) return ''
  return /см\.?$/i.test(h) ? h : `${h} см`
}

/** Строка под именем на карточке: «24 года · 175 см». */
export function metaLine(t: { age: number | null; height: string | null }): string {
  return [ageText(t.age), heightText(t.height)].filter(Boolean).join(' · ')
}

/** «Актёр · Модель», у детей — «Дети · Актёр». */
export function categoriesText(categories: readonly CastingCategory[] | null | undefined, kid = false): string {
  const set = new Set(categories || [])
  const parts = CATEGORY_ORDER.filter(c => set.has(c)).map(c => CATEGORY_LABEL[c])
  return (kid ? ['Дети', ...parts] : parts).join(' · ')
}

/** Имя на карточке каталога: первые два слова крупно, остальное — строкой ниже. */
export function splitName(name: string): [string, string] {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean)
  return [w.slice(0, 2).join(' '), w.slice(2).join(' ')]
}

// ─── Фильтр каталога для клиентов (на клиенте, без сервера) ───────────

export function inTab(t: { categories: readonly string[]; kid: boolean }, tab: CastingTab): boolean {
  if (tab === 'all') return true
  if (tab === 'kids') return !!t.kid
  return (t.categories || []).includes(tab)
}

export interface CatalogFilter {
  tab: CastingTab
  tags: readonly CastingTag[]
  q: string
}

/** Вкладка + ВСЕ выбранные метки опыта + имя содержит строку поиска. */
export function filterCatalog<T extends Pick<PublicTalent, 'name' | 'categories' | 'kid' | 'tags'>>(list: readonly T[], f: CatalogFilter): T[] {
  const q = f.q.trim().toLowerCase()
  return list.filter(t => inTab(t, f.tab)
    && f.tags.every(tag => (t.tags || []).includes(tag))
    && (!q || t.name.toLowerCase().includes(q)))
}

/** Числа на вкладках каталога. */
export function tabCounts(list: readonly Pick<PublicTalent, 'categories' | 'kid'>[]): Record<CastingTab, number> {
  const out = { all: 0, actor: 0, blogger: 0, model: 0, kids: 0 } as Record<CastingTab, number>
  for (const t of list) for (const k of CASTING_TAB_KEYS) if (inTab(t, k)) out[k]++
  return out
}

// ─── Ссылки ──────────────────────────────────────────────────────────

export function isHttpUrl(s: string | null | undefined): boolean {
  return /^https?:\/\/[^\s]+$/i.test(String(s || '').trim())
}

/** Ссылки актёра для показа: только http(s); YouTube — «Видео N»
 *  (нумерация среди видео), Instagram и TikTok — по названию. */
export function linkItems(links: readonly string[] | null | undefined): Array<{ href: string; label: string }> {
  let video = 0
  const out: Array<{ href: string; label: string }> = []
  for (const raw of links || []) {
    const href = String(raw || '').trim()
    if (!isHttpUrl(href)) continue
    if (/youtu\.?be/i.test(href)) out.push({ href, label: `Видео ${++video}` })
    else if (/instagram\.com/i.test(href)) out.push({ href, label: 'Instagram' })
    else if (/tiktok\.com/i.test(href)) out.push({ href, label: 'TikTok' })
    else out.push({ href, label: 'Ссылка' })
  }
  return out
}

/** Поле «Ссылки» формы: по одной в строке. Адрес без схемы получает https://,
 *  всё остальное (javascript:, пробелы внутри) отбрасываем. Дубли — один раз. */
export function parseLinks(text: string): string[] {
  const out: string[] = []
  for (const line of String(text || '').split(/[\n,]+/)) {
    let s = line.trim()
    if (!s) continue
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && /^[^\s/]+\.[^\s]+$/.test(s)) s = `https://${s}`
    if (isHttpUrl(s) && !out.includes(s)) out.push(s)
  }
  return out
}

/** Telegram: '@name', 'name' или 't.me/name' → https://t.me/name. */
export function telegramHref(v: string | null | undefined): string | null {
  const s = String(v || '').trim()
  if (!s) return null
  const m = /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{3,})/i.exec(s) || /^@?([A-Za-z0-9_]{3,})$/.exec(s)
  return m ? `https://t.me/${m[1]}` : null
}

/** tel:-ссылка — только цифры и ведущий плюс. */
export function phoneHref(v: string | null | undefined): string | null {
  const s = String(v || '').trim()
  const digits = s.replace(/\D/g, '')
  if (digits.length < 5) return null
  return `tel:${s.startsWith('+') ? '+' : ''}${digits}`
}

// ─── Заявка с публичного каталога ────────────────────────────────────

export function phoneDigits(v: string): number {
  return String(v || '').replace(/\D/g, '').length
}

/** Те же правила, что на сервере: имя 2–100 символов, в телефоне ≥ 7 цифр.
 *  Возвращает текст ошибки или null. */
export function bookingError(v: { name: string; phone: string }): string | null {
  const name = String(v.name || '').trim()
  if (name.length < 2) return 'Укажите имя'
  if (name.length > 100) return 'Имя слишком длинное'
  if (phoneDigits(v.phone) < 7) return 'Укажите телефон — хотя бы 7 цифр'
  return null
}

// ─── Порядок фото ────────────────────────────────────────────────────

/** Переставить элемент; индексы вне массива — без изменений. */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const out = arr.slice()
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out
  const [x] = out.splice(from, 1)
  out.splice(to, 0, x)
  return out
}

// ─── Импорт data.json + фото ─────────────────────────────────────────

export const IMPORT_MAX_BYTES = 8 * 1024 * 1024
/** Фото в одном запросе. Сервер принимает до 150, но мелкие пачки
 *  надёжнее на мобильном интернете и дают честный прогресс. */
export const IMPORT_BATCH_PHOTOS = 30

export function basename(p: string): string {
  const s = String(p || '')
  return s.slice(Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')) + 1)
}

export function isImportImage(name: string): boolean {
  return /\.(jpe?g|png|webp)$/i.test(name)
}

export interface ImportEntry {
  /** Запись как есть — уходит на сервер без изменений. */
  raw: Record<string, unknown>
  name: string
  /** Имена файлов фото (basename) в порядке data.json. */
  photos: string[]
}

/** Разбор data.json из артефакта. Бросает Error с понятным текстом. */
export function parseCastingData(text: string): ImportEntry[] {
  let data: unknown
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')) } catch {
    throw new Error('data.json не читается — это не JSON')
  }
  if (!Array.isArray(data)) throw new Error('В data.json ожидается список людей')
  const out: ImportEntry[] = []
  for (const row of data) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const name = typeof r.name === 'string' ? r.name.trim() : ''
    if (!name || r.id == null) continue
    const photos = Array.isArray(r.photos)
      ? r.photos.filter((p): p is string => typeof p === 'string' && !!p.trim()).map(basename)
      : []
    out.push({ raw: r, name, photos })
  }
  if (!out.length) throw new Error('В data.json нет ни одного человека')
  return out
}

export interface ImportBatch<F> {
  entries: Record<string, unknown>[]
  files: F[]
}

export interface ImportPlan<F> {
  batches: ImportBatch<F>[]
  /** Фото из data.json, которых нет среди выбранных файлов. */
  missing: string[]
  /** Фото тяжелее лимита сервера — не отправляем. */
  tooBig: string[]
  /** Сколько фото уйдёт на сервер. */
  photoCount: number
}

/** Раскладка импорта по запросам: человек целиком (запись + все его фото)
 *  в одной пачке, поэтому каждая пачка самодостаточна — повторный импорт
 *  и обрыв посередине ничего не путают. */
export function planImport<F extends { name: string; size: number }>(
  entries: readonly ImportEntry[], files: readonly F[],
  opts: { maxPhotos?: number; maxBytes?: number } = {},
): ImportPlan<F> {
  const maxPhotos = Math.max(1, opts.maxPhotos ?? IMPORT_BATCH_PHOTOS)
  const maxBytes = opts.maxBytes ?? IMPORT_MAX_BYTES
  const byName = new Map<string, F>()
  for (const f of files) {
    const key = basename(f.name).toLowerCase()
    if (isImportImage(key) && !byName.has(key)) byName.set(key, f)
  }
  const batches: ImportBatch<F>[] = []
  const missing: string[] = []
  const tooBig: string[] = []
  let cur: ImportBatch<F> = { entries: [], files: [] }
  let photoCount = 0
  for (const e of entries) {
    const mine: F[] = []
    for (const p of e.photos) {
      const f = byName.get(p.toLowerCase())
      if (!f) { missing.push(p); continue }
      if (f.size > maxBytes) { tooBig.push(p); continue }
      if (!mine.includes(f)) mine.push(f)
    }
    if (cur.entries.length && cur.files.length + mine.length > maxPhotos) {
      batches.push(cur)
      cur = { entries: [], files: [] }
    }
    cur.entries.push(e.raw)
    cur.files.push(...mine)
    photoCount += mine.length
  }
  if (cur.entries.length) batches.push(cur)
  return { batches, missing, tooBig, photoCount }
}

/** Итог нескольких пачек импорта. */
export function sumImportResults(list: ReadonlyArray<{ created: number; skipped: number; photos: number; missingPhotos: string[] }>) {
  const missing: string[] = []
  let created = 0, skipped = 0, photos = 0
  for (const r of list) {
    created += Number(r.created) || 0
    skipped += Number(r.skipped) || 0
    photos += Number(r.photos) || 0
    for (const m of r.missingPhotos || []) if (!missing.includes(m)) missing.push(m)
  }
  return { created, skipped, photos, missingPhotos: missing }
}

// ─── Слова ───────────────────────────────────────────────────────────

export function plural(n: number, one: string, few: string, many: string): string {
  const d = Math.abs(n) % 10, h = Math.abs(n) % 100
  if (d === 1 && h !== 11) return one
  if (d >= 2 && d <= 4 && (h < 10 || h >= 20)) return few
  return many
}

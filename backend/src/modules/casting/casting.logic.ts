/**
 * Кастинг (17.11.2026, docs/CASTING_SPEC.md): то, что не зависит от базы —
 * метки ↔ ключи, возраст, ссылки, разбор data.json импорта, проверка заявки
 * с публичного каталога и правки карточки, фильтры и счётчики списка.
 */
import type { PublicTalent, TalentCounts, TalentListItem } from './casting.types';

export const CATEGORY_KEYS = ['actor', 'blogger', 'model'] as const;
export type CategoryKey = typeof CATEGORY_KEYS[number];

export const TAG_KEYS = ['ads', 'film', 'theatre', 'clips', 'social', 'model'] as const;
export type TagKey = typeof TAG_KEYS[number];

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  actor: 'Актёр',
  blogger: 'Блогер',
  model: 'Модель',
};

export const TAG_LABELS: Record<TagKey, string> = {
  ads: 'Реклама',
  film: 'Кино и сериалы',
  theatre: 'Театр',
  clips: 'Клипы',
  social: 'Ролики для соцсетей',
  model: 'Модельный опыт',
};

export const BOOKING_STATUSES = ['invited', 'confirmed', 'declined'] as const;

/** «Дети» — младше 16 лет. */
export const KID_AGE = 16;
/** Префикс ключа импорта: повторный импорт того же человека не дублирует. */
export const SOURCE_PREFIX = 'webrand-casting:';
/** Сколько ссылок храним у человека. */
export const MAX_LINKS = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** Для сравнения подписей и поиска: регистр, «ё», лишние пробелы. */
export function norm(v: unknown): string {
  return String(v ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

function aliasesOf<K extends string>(labels: Record<K, string>, extra: Record<string, K>): Record<string, K> {
  const out: Record<string, K> = {};
  for (const key of Object.keys(labels) as K[]) out[norm(labels[key])] = key;
  for (const [label, key] of Object.entries(extra)) out[norm(label)] = key as K;
  return out;
}

const CATEGORY_ALIASES = aliasesOf<CategoryKey>(CATEGORY_LABELS, {
  'Актёры': 'actor', 'Актриса': 'actor', 'Блогеры': 'blogger', 'Модели': 'model',
});
const TAG_ALIASES = aliasesOf<TagKey>(TAG_LABELS, {
  'Кино': 'film', 'Сериалы': 'film', 'Соцсети': 'social',
});

/** Подписи или ключи → ключи по порядку, без повторов; неизвестное — мимо.
 *  Строку режем по запятым («ads,film» из запроса). */
function toKeys<K extends string>(input: unknown, keys: readonly K[], aliases: Record<string, K>): K[] {
  const list: unknown[] = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : [];
  const out: K[] = [];
  for (const raw of list) {
    const n = norm(raw);
    if (!n) continue;
    const key = (keys as readonly string[]).includes(n) ? (n as K) : aliases[n];
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

export const categoriesOf = (input: unknown): CategoryKey[] => toKeys(input, CATEGORY_KEYS, CATEGORY_ALIASES);
export const tagsOf = (input: unknown): TagKey[] => toKeys(input, TAG_KEYS, TAG_ALIASES);

// ── Даты и возраст ────────────────────────────────────────────────────

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Настоящий день 'YYYY-MM-DD' (не 2026-02-30). */
export function isIsoDay(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DAY_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Сегодня по Душанбе: 'YYYY-MM-DD'. */
export function dushanbeToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dushanbe' }).format(now);
}

/** Полных лет между днями (to ≥ from — иначе отрицательное число). */
export function fullYears(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let years = ty - fy;
  if (tm < fm || (tm === fm && td < fd)) years -= 1;
  return years;
}

export interface AgeSource {
  birthDate?: string | null;
  ageBase?: number | null;
  ageBaseAt?: string | null;
}

/** Возраст для показа: по дате рождения; иначе возраст из импорта плюс
 *  прошедшие с тех пор полные годы; иначе null. */
export function ageOf(t: AgeSource | null | undefined, today: string): number | null {
  if (!t) return null;
  if (isIsoDay(t.birthDate)) {
    const years = fullYears(t.birthDate, today);
    return years >= 0 ? years : null;
  }
  if (t.ageBase !== null && t.ageBase !== undefined && Number.isFinite(Number(t.ageBase))) {
    const since = isIsoDay(t.ageBaseAt) ? Math.max(0, fullYears(t.ageBaseAt, today)) : 0;
    return Number(t.ageBase) + since;
  }
  return null;
}

export const isKid = (age: number | null | undefined): boolean =>
  typeof age === 'number' && Number.isFinite(age) && age < KID_AGE;

/** Возраст из данных: целое 0–120, иначе null. */
export function ageNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) return null;
  const age = Math.floor(n);
  return age >= 0 && age <= 120 ? age : null;
}

// ── Текст и ссылки ────────────────────────────────────────────────────

/** Строка (или число) → обрезанный текст; пустое → null. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/** Ссылка: только http(s). «instagram.com/имя» без схемы — достраиваем https. */
export function cleanLink(v: unknown): string | null {
  let s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > 500) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s)) return null;
    s = `https://${s}`;
  }
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password || !u.hostname) return null;
    return s;
  } catch {
    return null;
  }
}

export function cleanLinks(v: unknown): string[] {
  const list = Array.isArray(v) ? v : [];
  const out: string[] = [];
  for (const raw of list) {
    const link = cleanLink(raw);
    if (link && !out.includes(link)) out.push(link);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

export const phoneDigits = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

// ── Импорт data.json ──────────────────────────────────────────────────

export interface ImportItem {
  sourceKey: string;
  name: string;
  categories: CategoryKey[];
  city: string | null;
  height: string | null;
  age: number | null;
  tags: TagKey[];
  experience: string | null;
  links: string[];
  /** Имена файлов фото по порядку: 't00_0.jpg'. */
  photos: string[];
}

/** 'photos/t00_0.jpg' → 't00_0.jpg'. Пустое, «.», «..» — null. */
export function photoBasename(p: unknown): string | null {
  if (typeof p !== 'string') return null;
  const base = (p.trim().split(/[\\/]/).pop() || '').trim();
  if (!base || base === '.' || base === '..' || base.length > 200) return null;
  return base;
}

/** Ключ для сопоставления фото с файлом: имя без регистра. */
export const photoKey = (p: unknown): string | null => {
  const base = photoBasename(p);
  return base ? base.toLowerCase() : null;
};

/** data.json из артефакта: [{ id, name, cats, city, height, age, tags, exp,
 *  links, photos }]. Записи без id или имени и повторы id пропускаем. */
export function parseImportData(json: unknown): ImportItem[] {
  const obj = json as any;
  const list: unknown[] | null = Array.isArray(json) ? json
    : Array.isArray(obj?.talents) ? obj.talents
      : Array.isArray(obj?.items) ? obj.items
        : null;
  if (!list) return [];
  const out: ImportItem[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === 'number' || typeof r.id === 'string' ? String(r.id).trim() : '';
    const name = cleanText(r.name, 200);
    if (!id || !name) continue;
    const sourceKey = `${SOURCE_PREFIX}${id}`;
    if (sourceKey.length > 80 || seen.has(sourceKey)) continue;
    seen.add(sourceKey);
    const photos: string[] = [];
    const photoKeys = new Set<string>();
    for (const p of Array.isArray(r.photos) ? r.photos : []) {
      const base = photoBasename(p);
      if (!base || photoKeys.has(base.toLowerCase())) continue;
      photoKeys.add(base.toLowerCase());
      photos.push(base);
    }
    out.push({
      sourceKey,
      name,
      categories: categoriesOf(r.cats ?? r.categories),
      city: cleanText(r.city, 200),
      height: cleanText(r.height, 20),
      age: ageNumber(r.age),
      tags: tagsOf(r.tags),
      experience: cleanText(r.exp ?? r.experience, 5000),
      links: cleanLinks(r.links),
      photos,
    });
  }
  return out;
}

// ── Правка карточки ───────────────────────────────────────────────────

/** Колонки casting_talents, которые меняет форма. */
export interface TalentPatch {
  name?: string;
  categories?: string[];
  city?: string | null;
  height?: string | null;
  birthDate?: string | null;
  ageBase?: number | null;
  ageBaseAt?: string | null;
  tags?: string[];
  experience?: string | null;
  links?: string[];
  phone?: string | null;
  telegram?: string | null;
  rate?: string | null;
  notes?: string | null;
  isPublic?: boolean;
  isArchived?: boolean;
  sortOrder?: number;
}

const has = (o: any, key: string) => !!o && Object.prototype.hasOwnProperty.call(o, key) && o[key] !== undefined;

/**
 * Тело формы (TalentInput) → колонки. creating — нужно имя. Возраст
 * ставим, только если нет даты рождения и он отличается от того, что уже
 * показываем (форма шлёт его обратно при каждом сохранении — иначе отсчёт
 * лет сдвигался бы на день сохранения).
 */
export function talentPatch(
  input: Record<string, any> | null | undefined,
  ctx: { today: string; creating: boolean; current?: AgeSource | null },
): { patch: TalentPatch; error: string | null } {
  const body = input || {};
  const patch: TalentPatch = {};
  const fail = (error: string) => ({ patch: {}, error });

  if (has(body, 'name') || ctx.creating) {
    const name = cleanText(body.name, 1000);
    if (!name) return fail('Укажите имя');
    if (name.length > 200) return fail('Имя — не длиннее 200 символов');
    patch.name = name.replace(/\s+/g, ' ');
  }
  if (has(body, 'categories')) patch.categories = categoriesOf(body.categories);
  if (has(body, 'tags')) patch.tags = tagsOf(body.tags);
  if (has(body, 'links')) patch.links = cleanLinks(body.links);

  const texts: Array<[keyof TalentPatch, number, string]> = [
    ['city', 200, 'Город'], ['height', 20, 'Рост'], ['experience', 5000, 'Опыт'], ['phone', 40, 'Телефон'],
    ['telegram', 64, 'Telegram'], ['rate', 120, 'Гонорар'], ['notes', 5000, 'Заметки'],
  ];
  for (const [key, max, label] of texts) {
    if (!has(body, key)) continue;
    const v = body[key];
    if (v === null || v === '') { (patch as any)[key] = null; continue; }
    const s = cleanText(v, 100000);
    if (s && s.length > max) return fail(`${label} — не длиннее ${max} символов`);
    (patch as any)[key] = s;
  }

  if (has(body, 'birthDate')) {
    const v = body.birthDate;
    if (v === null || v === '') patch.birthDate = null;
    else if (!isIsoDay(v) || v > ctx.today || v < '1900-01-01') return fail('Дата рождения — в формате ГГГГ-ММ-ДД, не в будущем');
    else patch.birthDate = v;
  }

  // Возраст: поле age или ageBase (так его зовёт форма CRM) — смысл один.
  const ageKey = has(body, 'age') ? 'age' : has(body, 'ageBase') ? 'ageBase' : null;
  if (ageKey) {
    const raw = body[ageKey];
    const birth = has(patch, 'birthDate') ? patch.birthDate : ctx.current?.birthDate ?? null;
    if (raw === null || raw === '') {
      if (!birth) { patch.ageBase = null; patch.ageBaseAt = null; }
    } else {
      const age = ageNumber(raw);
      if (age === null) return fail('Возраст — целое число от 0 до 120');
      const shown = ageOf({ ageBase: ctx.current?.ageBase ?? null, ageBaseAt: ctx.current?.ageBaseAt ?? null }, ctx.today);
      if (!birth && age !== shown) { patch.ageBase = age; patch.ageBaseAt = ctx.today; }
    }
  }

  if (has(body, 'isPublic')) {
    if (typeof body.isPublic !== 'boolean') return fail('isPublic — да или нет');
    patch.isPublic = body.isPublic;
  }
  if (has(body, 'isArchived')) {
    if (typeof body.isArchived !== 'boolean') return fail('isArchived — да или нет');
    patch.isArchived = body.isArchived;
  }
  if (has(body, 'sortOrder')) {
    const n = Number(body.sortOrder);
    if (!Number.isInteger(n) || Math.abs(n) > 1_000_000) return fail('sortOrder — целое число');
    patch.sortOrder = n;
  }
  return { patch, error: null };
}

// ── Список ────────────────────────────────────────────────────────────

/** Строка выборки (TALENT_SELECT в сервисе). */
export interface TalentRow {
  id: string;
  name: string;
  categories: string[] | null;
  city: string | null;
  height: string | null;
  birthDate: string | null;
  ageBase: number | null;
  ageBaseAt: string | null;
  tags: string[] | null;
  experience?: string | null;
  links?: string[] | null;
  isPublic: boolean;
  isArchived: boolean;
  /** Пути фото по порядку. */
  photos: string[] | null;
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function toListItem(r: TalentRow, today: string): TalentListItem {
  const photos = arr(r.photos);
  const age = ageOf(r, today);
  return {
    id: r.id,
    name: r.name,
    categories: arr(r.categories),
    city: r.city ?? null,
    height: r.height ?? null,
    age,
    kid: isKid(age),
    tags: arr(r.tags),
    photo: photos[0] ?? null,
    photo2: photos[1] ?? null,
    photosCount: photos.length,
    isPublic: !!r.isPublic,
    isArchived: !!r.isArchived,
  };
}

export function toPublicTalent(r: TalentRow, today: string): PublicTalent {
  const age = ageOf(r, today);
  return {
    id: r.id,
    name: r.name,
    categories: arr(r.categories),
    city: r.city ?? null,
    height: r.height ?? null,
    age,
    kid: isKid(age),
    tags: arr(r.tags),
    experience: r.experience ?? null,
    links: arr(r.links),
    photos: arr(r.photos),
  };
}

export interface ListFilters {
  search: string;
  category: CategoryKey | null;
  tags: TagKey[];
  kids: boolean;
  archived: boolean;
}

const truthy = (v: unknown) => ['1', 'true', 'yes'].includes(String(v ?? '').trim().toLowerCase());

/** ?search=&category=&tags=ads,film&kids=1&archived=1 (category=kids — то же, что kids=1). */
export function parseListQuery(q: Record<string, unknown> | null | undefined): ListFilters {
  const raw = q || {};
  const cat = norm(raw.category);
  const category = categoriesOf([cat])[0] ?? null;
  return {
    search: norm(raw.search).slice(0, 100),
    category,
    tags: tagsOf(raw.tags),
    kids: truthy(raw.kids) || cat === 'kids',
    archived: truthy(raw.archived),
  };
}

/** Поиск по имени и чипы опыта (любой из выбранных) — до вкладок. */
export function matchesSearch(item: Pick<TalentListItem, 'name' | 'tags'>, f: Pick<ListFilters, 'search' | 'tags'>): boolean {
  if (f.search && !norm(item.name).includes(f.search)) return false;
  if (f.tags.length && !item.tags.some(t => (f.tags as string[]).includes(t))) return false;
  return true;
}

/** Вкладка: категория и/или «Дети». */
export function matchesTab(item: Pick<TalentListItem, 'categories' | 'kid'>, f: Pick<ListFilters, 'category' | 'kids'>): boolean {
  if (f.category && !item.categories.includes(f.category)) return false;
  if (f.kids && !item.kid) return false;
  return true;
}

export function countTalents(items: Array<Pick<TalentListItem, 'categories' | 'kid'>>): TalentCounts {
  const c: TalentCounts = { all: items.length, actor: 0, blogger: 0, model: 0, kids: 0 };
  for (const it of items) {
    if (it.categories.includes('actor')) c.actor += 1;
    if (it.categories.includes('blogger')) c.blogger += 1;
    if (it.categories.includes('model')) c.model += 1;
    if (it.kid) c.kids += 1;
  }
  return c;
}

// ── Заявка с публичного каталога ──────────────────────────────────────

export interface BookingInput {
  talentIds: string[];
  name: string;
  phone: string;
  comment: string | null;
}

/** Итог проверки заявки. spam — сработала ловушка website: отвечаем «ok»,
 *  ничего не создаём; error — текст для человека; иначе value. */
export interface BookingCheck {
  spam: boolean;
  error: string | null;
  value: BookingInput | null;
}

export function cleanBooking(body: Record<string, any> | null | undefined): BookingCheck {
  const b = body || {};
  const fail = (error: string): BookingCheck => ({ spam: false, error, value: null });
  const trap = b.website;
  if (trap !== undefined && trap !== null && (typeof trap !== 'string' || trap.trim() !== '')) {
    return { spam: true, error: null, value: null };
  }

  const ids: string[] = [];
  for (const id of Array.isArray(b.talentIds) ? b.talentIds : []) {
    if (isUuid(id) && !ids.includes(id.toLowerCase())) ids.push(id.toLowerCase());
  }
  if (!ids.length) return fail('Выберите хотя бы одного человека');
  if (ids.length > 10) return fail('За один раз — не больше 10 человек');

  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > 100) return fail('Укажите имя — от 2 до 100 символов');

  const phone = typeof b.phone === 'string' ? b.phone.trim() : '';
  const digits = phoneDigits(phone).length;
  if (phone.length > 40 || digits < 7 || digits > 15) return fail('Укажите телефон — не меньше 7 цифр');

  const comment = cleanText(b.comment, 1000);
  return { spam: false, error: null, value: { talentIds: ids, name, phone, comment } };
}

/** Текст лида: «Кастинг: Имя (ссылка), …» и комментарий клиента. */
export function bookingProblem(
  talents: Array<{ id: string; name: string }>, comment: string | null, appUrl: string,
): string {
  const base = String(appUrl || '').replace(/\/+$/, '');
  const list = talents.map(t => `${t.name} (${base}/casting/${t.id})`).join(', ');
  return [`Кастинг: ${list}`, comment ? `Комментарий: ${comment}` : null].filter(Boolean).join('\n');
}

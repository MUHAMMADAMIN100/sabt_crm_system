import { create } from 'zustand'

/**
 * Персональные обои интерфейса.
 *
 * Устроено как персональная тема (lib/theme.ts): вместо перекраски React-ом
 * подменяем один <style> в <head> и вешаем класс на <html>. Поэтому фон
 * появляется мгновенно и целиком — включая страницы, которые в этот момент
 * даже не смонтированы.
 *
 * Картинка приходит с сервера как data URI и хранится в БД, а не на диске:
 * диск на Railway эфемерный, файлы стираются при каждом редеплое.
 */

/** Кому доступны обои. Должен совпадать с BACKGROUND_ROLES на бэкенде
 *  (users.controller.ts): разъедутся — сотрудник увидит настройку, которую
 *  сервер ему сохранить не даст. */
export const WALLPAPER_ROLES = ['pm_dev', 'sales_manager_dev', 'founder', 'co_founder']

/** RolesGuard на бэкенде пускает и по второй роли сотрудника, поэтому здесь
 *  проверяем обе — иначе у совместителя настройка была бы не видна, хотя
 *  сервер её сохранить готов. */
export const canUseWallpaper = (user?: { role?: string | null; secondaryRole?: string | null } | null): boolean =>
  !!user && (WALLPAPER_ROLES.includes(user.role || '') || WALLPAPER_ROLES.includes(user.secondaryRole || ''))

/** Как показывать картинку. Отделено от самой картинки: ползунки двигают
 *  только эти три числа, а data URI при этом не пересохраняется. */
export interface WallpaperView {
  /** Затемнение поверх картинки, 0..90 %. */
  dim: number
  /** Масштаб, 30..200 % от «заполнить экран». 100 — как было раньше. */
  scale: number
  /** Пропорции картинки (ширина/высота). Без них масштаб не выразить: сам
   *  «заполнить экран» зависит и от картинки, и от размера окна. */
  ratio: number | null
}

export const DEFAULT_VIEW: WallpaperView = { dim: 40, scale: 100, ratio: null }

export interface WallpaperState {
  /** data URI картинки или null, если обоев нет. */
  image: string | null
  view: WallpaperView
  /** Применить мгновенно: DOM + localStorage + стор. */
  set: (image: string | null, view: Partial<WallpaperView>) => void
  /** Показать другие настройки, НЕ трогая localStorage. Нужно для ползунков:
   *  иначе каждый их пиксель писал бы в хранилище картинку целиком. */
  preview: (patch: Partial<WallpaperView>) => void
  /** Зафиксировать настройки (с записью в кэш) — когда ползунок отпустили. */
  commit: (patch: Partial<WallpaperView>) => void
  /** Убрать обои совсем. */
  clear: () => void
}

const STORAGE_KEY = 'wallpaper'
const STYLE_ID = 'wallpaper-vars'
const ROOT_CLASS = 'has-wallpaper'

/** Пускаем в CSS только настоящий data URI картинки. Строка попадает внутрь
 *  url("…"), поэтому кавычка или скобка в ней означала бы инъекцию стилей —
 *  сервер это тоже проверяет, но полагаться на один барьер нельзя. */
const DATA_URI_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/

export function isValidWallpaper(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && DATA_URI_RE.test(v)
}

const clampDim = (v: unknown): number => {
  const n = Number(v)
  if (!Number.isFinite(n)) return DEFAULT_VIEW.dim
  return Math.min(90, Math.max(0, Math.round(n)))
}

const clampScale = (v: unknown): number => {
  const n = Number(v)
  if (!Number.isFinite(n)) return DEFAULT_VIEW.scale
  return Math.min(200, Math.max(30, Math.round(n)))
}

const clampRatio = (v: unknown): number | null => {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(10, Math.max(0.1, Math.round(n * 1000) / 1000))
}

const normalizeView = (v?: Partial<WallpaperView> | null): WallpaperView => ({
  dim: clampDim(v?.dim),
  scale: clampScale(v?.scale),
  ratio: clampRatio(v?.ratio),
})

/** Рабочая область — то, что реально видно за интерфейсом. Сайдбар и шапка
 *  непрозрачные, поэтому считать размер и центр по всему экрану нельзя:
 *  уменьшенная картинка уезжала бы левым краем под сайдбар, и логотип всё
 *  равно оказывался обрезанным — ровно то, ради чего затевался «Размер».
 *  Ниже 1024px сайдбар лежит поверх контента, поэтому отступа нет. */
const AREA_VARS = `
  --wp-l: 0px;
  --wp-t: 56px;
  --wp-w: calc(100vw - var(--wp-l));
  --wp-h: calc(100vh - var(--wp-t));`

/** Размер картинки в CSS.
 *
 *  100 % — картинка заполняет рабочую область без пустот, меньше — вокруг
 *  остаётся фон темы. Масштаб считаем от «заполнить», а не от ширины окна:
 *  иначе «120 %» значило бы разное на широком мониторе и на ноутбуке.
 *  Ширина при заполнении = max(ширина области, высота области × пропорции),
 *  высоту доводит auto — картинка не растягивается.
 *
 *  Пропорции неизвестны (обои поставлены до появления этой настройки) —
 *  честно откатываемся на cover, а не рисуем наугад. */
const sizeOf = (view: WallpaperView): string =>
  !view.ratio
    ? 'cover'
    : `calc(max(var(--wp-w), var(--wp-h) * ${view.ratio}) * ${(view.scale / 100).toFixed(2)}) auto`

/** Центр картинки — центр рабочей области, а не экрана. Процент выравнивает
 *  по области позиционирования (при fixed это весь экран), поэтому добавляем
 *  половину скрытых полос. */
const positionOf = (view: WallpaperView): string =>
  !view.ratio
    ? 'center center'
    : 'calc(50% + var(--wp-l) / 2) calc(50% + var(--wp-t) / 2)'

/** Плёнка затемнения. Цвет — фон текущей темы (--wp-veil из index.css), а не
 *  чёрный: на светлой теме чёрная плёнка превратила бы интерфейс в тёмный.
 *  Токен один на экран и на превью в профиле — раньше они разъезжались, и в
 *  тёмной теме превью осветляло картинку, пока экран её затемнял. */
export const veilOf = (alpha: number | string): string =>
  `linear-gradient(rgb(var(--wp-veil) / ${alpha}), rgb(var(--wp-veil) / ${alpha}))`

function applyWallpaper(image: string | null, view: WallpaperView) {
  const html = document.documentElement
  const tag = ensureStyleTag()
  if (!isValidWallpaper(image)) {
    tag.textContent = ''
    html.classList.remove(ROOT_CLASS)
    return
  }
  const a = (view.dim / 100).toFixed(2)
  // Размеры задаём послойно: вуаль обязана накрывать весь экран, включая
  // пустое поле вокруг уменьшенной картинки, иначе край получился бы ярче
  // середины.
  const size = `100% 100%, ${sizeOf(view)}`
  // Карточки делаем чуть прозрачными: иначе обои видно только в зазорах
  // между блоками и смысл фона теряется. Без backdrop-filter — на доске
  // проектов карточек сотни, размытие каждой заметно било бы по скорости.
  tag.textContent = `
html.${ROOT_CLASS} .app-shell {${AREA_VARS}
  background-image: ${veilOf(a)}, url("${image}");
  background-size: ${size};
  background-position: ${positionOf(view)};
  background-repeat: no-repeat;
  background-attachment: fixed;
}
@media (min-width: 1024px) {
  html.${ROOT_CLASS} .app-shell { --wp-l: var(--app-sidebar-w, 260px); }
}
html.${ROOT_CLASS} .card { background-color: rgb(var(--surf-50) / 0.88); }
html.${ROOT_CLASS}.dark .card { background-color: rgb(var(--surf-800) / 0.86); }
`
  html.classList.add(ROOT_CLASS)
}

function ensureStyleTag(): HTMLStyleElement {
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!tag) {
    tag = document.createElement('style')
    tag.id = STYLE_ID
    document.head.appendChild(tag)
  }
  return tag
}

function persist(image: string | null, view: WallpaperView) {
  try {
    if (!image) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify({ image, view }))
  } catch {
    // Картинка может не влезть в квоту localStorage — не беда, фон всё равно
    // применён, а при следующем входе приедет с сервера.
  }
}

export const useWallpaperStore = create<WallpaperState>((set, get) => ({
  image: null,
  view: DEFAULT_VIEW,
  set: (image, view) => {
    const v = normalizeView(view)
    const img = isValidWallpaper(image) ? image : null
    applyWallpaper(img, v)
    persist(img, v)
    set({ image: img, view: v })
  },
  preview: (patch) => {
    const v = normalizeView({ ...get().view, ...patch })
    applyWallpaper(get().image, v)
    set({ view: v })
  },
  commit: (patch) => {
    const v = normalizeView({ ...get().view, ...patch })
    const img = get().image
    applyWallpaper(img, v)
    persist(img, v)
    set({ view: v })
  },
  clear: () => {
    applyWallpaper(null, DEFAULT_VIEW)
    persist(null, DEFAULT_VIEW)
    set({ image: null, view: DEFAULT_VIEW })
  },
}))

/** Бутстрап до первого рендера — из кэша, чтобы интерфейс не мигал белым,
 *  пока с сервера едет картинка. */
export function initWallpaperFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!isValidWallpaper(parsed?.image)) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    // parsed.dim — формат кэша до появления «Размера»: у тех, кто уже
    // поставил обои, в хранилище лежит плоское поле. Читаем оба варианта,
    // иначе при обновлении фронта фон разъехался бы до перезахода.
    const view = normalizeView(parsed.view ?? { dim: parsed.dim })
    applyWallpaper(parsed.image, view)
    useWallpaperStore.setState({ image: parsed.image, view })
  } catch {
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  }
}

/** Есть ли уже применённая картинка (например, поднятая из кэша). */
export const hasWallpaperLoaded = (): boolean => !!useWallpaperStore.getState().image

/** Сервер — источник истины. Вызывается после входа. */
export function syncWallpaperFromServer(image?: string | null, view?: Partial<WallpaperView> | null) {
  useWallpaperStore.getState().set(image ?? null, view || {})
}

/** Сброс при выходе: следующий вошедший на этом компьютере не должен
 *  увидеть чужие обои. */
export function resetWallpaper() {
  useWallpaperStore.getState().clear()
}

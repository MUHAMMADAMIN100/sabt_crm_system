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

export interface WallpaperState {
  /** data URI картинки или null, если обоев нет. */
  image: string | null
  /** Затемнение поверх картинки, 0..90 %. */
  dim: number
  /** Применить мгновенно: DOM + localStorage + стор. */
  set: (image: string | null, dim: number) => void
  /** Показать другое затемнение, НЕ трогая localStorage. Нужно для ползунка:
   *  иначе каждый его пиксель писал бы в хранилище картинку целиком. */
  previewDim: (dim: number) => void
  /** Зафиксировать затемнение (с записью в кэш) — когда ползунок отпустили. */
  commitDim: (dim: number) => void
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
  if (!Number.isFinite(n)) return 40
  return Math.min(90, Math.max(0, Math.round(n)))
}

/** Рисует обои. Вуаль поверх картинки берём цветом фона темы, а не чёрным:
 *  на светлой теме чёрная плёнка превратила бы интерфейс в тёмный.
 *
 *  Светлая и тёмная тема разведены намеренно. Масштаб --surf-* в проекте НЕ
 *  инвертируется в тёмной теме (блок .dark в index.css трогает только
 *  --prim-*), поэтому один и тот же --surf-100 в тёмной теме давал бы
 *  светлую плёнку — ползунок «Затемнение» осветлял бы картинку вместо того,
 *  чтобы её приглушать. */
function applyWallpaper(image: string | null, dim: number) {
  const html = document.documentElement
  const tag = ensureStyleTag()
  if (!isValidWallpaper(image)) {
    tag.textContent = ''
    html.classList.remove(ROOT_CLASS)
    return
  }
  const a = (clampDim(dim) / 100).toFixed(2)
  // Карточки делаем чуть прозрачными: иначе обои видно только в зазорах
  // между блоками и смысл фона теряется. Без backdrop-filter — на доске
  // проектов карточек сотни, размытие каждой заметно било бы по скорости.
  const veil = (surf: string) => `linear-gradient(rgb(var(${surf}) / ${a}), rgb(var(${surf}) / ${a}))`
  tag.textContent = `
html.${ROOT_CLASS} .app-shell {
  background-image: ${veil('--surf-100')}, url("${image}");
  background-size: cover;
  background-position: center center;
  background-repeat: no-repeat;
  background-attachment: fixed;
}
html.${ROOT_CLASS}.dark .app-shell {
  background-image: ${veil('--surf-900')}, url("${image}");
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

function persist(image: string | null, dim: number) {
  try {
    if (!image) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify({ image, dim }))
  } catch {
    // Картинка может не влезть в квоту localStorage — не беда, фон всё равно
    // применён, а при следующем входе приедет с сервера.
  }
}

export const useWallpaperStore = create<WallpaperState>((set, get) => ({
  image: null,
  dim: 40,
  set: (image, dim) => {
    const d = clampDim(dim)
    const img = isValidWallpaper(image) ? image : null
    applyWallpaper(img, d)
    persist(img, d)
    set({ image: img, dim: d })
  },
  previewDim: (dim) => {
    const d = clampDim(dim)
    applyWallpaper(get().image, d)
    set({ dim: d })
  },
  commitDim: (dim) => {
    const d = clampDim(dim)
    const img = get().image
    applyWallpaper(img, d)
    persist(img, d)
    set({ dim: d })
  },
  clear: () => {
    applyWallpaper(null, 40)
    persist(null, 40)
    set({ image: null, dim: 40 })
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
    applyWallpaper(parsed.image, clampDim(parsed.dim))
    useWallpaperStore.setState({ image: parsed.image, dim: clampDim(parsed.dim) })
  } catch {
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  }
}

/** Есть ли уже применённая картинка (например, поднятая из кэша). */
export const hasWallpaperLoaded = (): boolean => !!useWallpaperStore.getState().image

/** Сервер — источник истины. Вызывается после входа. */
export function syncWallpaperFromServer(image?: string | null, dim?: number) {
  useWallpaperStore.getState().set(image ?? null, clampDim(dim))
}

/** Сброс при выходе: следующий вошедший на этом компьютере не должен
 *  увидеть чужие обои. */
export function resetWallpaper() {
  useWallpaperStore.getState().clear()
}

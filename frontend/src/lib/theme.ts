import { create } from 'zustand'

/**
 * Персональная тема интерфейса в модели realtimecolors — 5 ролей цвета:
 *   text · background · primary · secondary · accent
 *
 * Из этих 5 цветов генерируется ВЕСЬ набор CSS-переменных:
 *   --surf-50..950  — нейтральный масштаб, интерполяция Background↔Text
 *                     (фоны, границы, текст, ховеры, сайдбар, карточки);
 *   --prim-50..900  — масштаб из Primary (кнопки, ссылки, активные пункты,
 *                     фокусы, прогресс-бары);
 *   --secondary, --accent — доп. цвета (графики, вторичные кнопки).
 *
 * Переменные ставятся инлайном на <html> → перебивают и :root, и .dark,
 * поэтому интерфейс перекрашивается МГНОВЕННО и ЦЕЛИКОМ в обеих темах.
 * Хранится в users.themeColor (формат "text-bg-primary-secondary-accent"
 * из hex без #), ездит за сотрудником между устройствами, персонально.
 */

export interface ThemeColors {
  text: string
  background: string
  primary: string
  secondary: string
  accent: string
}

/** Дефолт = текущий ч/б монохром. */
export const DEFAULT_THEME: ThemeColors = {
  text: '#18181b',
  background: '#fafafa',
  primary: '#18181b',
  secondary: '#71717a',
  accent: '#3f3f46',
}

/** Быстрые пресеты-старты (можно потом докрутить пикером). */
export const THEME_PRESETS: { name: string; colors: ThemeColors }[] = [
  { name: 'Монохром',   colors: DEFAULT_THEME },
  { name: 'Фиолетовый', colors: { text: '#1e1b2e', background: '#faf9ff', primary: '#6d4fcf', secondary: '#8b7fb8', accent: '#a855f7' } },
  { name: 'Синий',      colors: { text: '#0f172a', background: '#f8fafc', primary: '#2563eb', secondary: '#64748b', accent: '#0ea5e9' } },
  { name: 'Зелёный',    colors: { text: '#0f1f17', background: '#f6fdf9', primary: '#059669', secondary: '#5f897a', accent: '#10b981' } },
  { name: 'Красный',    colors: { text: '#1f1414', background: '#fef7f7', primary: '#dc2626', secondary: '#9b6b6b', accent: '#f97316' } },
  { name: 'Оранжевый',  colors: { text: '#1f1710', background: '#fffbf5', primary: '#ea580c', secondary: '#9c7a5c', accent: '#f59e0b' } },
  { name: 'Бирюзовый',  colors: { text: '#0d1f1d', background: '#f3fdfb', primary: '#0d9488', secondary: '#5f8a85', accent: '#06b6d4' } },
  { name: 'Розовый',    colors: { text: '#23131c', background: '#fff7fb', primary: '#db2777', secondary: '#a06b86', accent: '#ec4899' } },
  { name: 'Тёмный',     colors: { text: '#e7e7ea', background: '#18181b', primary: '#818cf8', secondary: '#9ca3af', accent: '#34d399' } },
]

// ─── Цветовая математика ──────────────────────────────────────────────
type RGB = [number, number, number]

function hexToRgb(hex: string): RGB {
  let h = (hex || '').replace('#', '').trim()
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const int = parseInt(h || '000000', 16)
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}
const clamp = (x: number) => Math.max(0, Math.min(255, Math.round(x)))
function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(clamp) as RGB
}
const rgbStr = (c: RGB) => `${c[0]} ${c[1]} ${c[2]}`
const WHITE: RGB = [255, 255, 255]
const BLACK: RGB = [0, 0, 0]

// Шаги primary: <500 светлее (к белому), >600 темнее (к чёрному).
const PRIM_LIGHT: [number, number][] = [[50, 0.90], [100, 0.82], [300, 0.52], [400, 0.30], [500, 0.12]]
const PRIM_DARK: [number, number][]  = [[700, 0.15], [900, 0.45]]

/** primary/secondary/accent — одинаковы в обоих режимах (роль выбрана
 *  пользователем явно). */
function accentVars(theme: ThemeColors): Record<string, string> {
  const primary = hexToRgb(theme.primary)
  const vars: Record<string, string> = {}
  for (const [step, t] of PRIM_LIGHT) vars[`--prim-${step}`] = rgbStr(mix(primary, WHITE, t))
  vars['--prim-600'] = rgbStr(primary)
  for (const [step, t] of PRIM_DARK) vars[`--prim-${step}`] = rgbStr(mix(primary, BLACK, t))
  vars['--secondary'] = rgbStr(hexToRgb(theme.secondary))
  vars['--accent'] = rgbStr(hexToRgb(theme.accent))
  return vars
}

/**
 * СВЕТЛЫЙ режим. surface-масштаб разбит на 3 непересекающихся диапазона,
 * у каждого свой источник — роли изолированы:
 *   surf-50..300  ← Background (фоны/карточки/границы — светлые);
 *   surf-400..600 ← Secondary  (приглушённый текст, иконки);
 *   surf-700..950 ← Text       (основной текст, заголовки, сайдбар — тёмные).
 */
function buildLight(theme: ThemeColors): Record<string, string> {
  const T = hexToRgb(theme.text)
  const B = hexToRgb(theme.background)
  const S = hexToRgb(theme.secondary)
  return {
    '--surf-50':  rgbStr(B),
    '--surf-100': rgbStr(mix(B, BLACK, 0.04)),
    '--surf-200': rgbStr(mix(B, BLACK, 0.10)),
    '--surf-300': rgbStr(mix(B, BLACK, 0.18)),
    '--surf-400': rgbStr(mix(S, WHITE, 0.18)),
    '--surf-500': rgbStr(S),
    '--surf-600': rgbStr(mix(S, BLACK, 0.16)),
    '--surf-700': rgbStr(mix(T, WHITE, 0.22)),
    '--surf-800': rgbStr(mix(T, WHITE, 0.10)),
    '--surf-900': rgbStr(T),
    '--surf-950': rgbStr(mix(T, BLACK, 0.12)),
    // Сайдбар — тёмная панель из Фона (НЕ из Текста), чтобы смена
    // Текста его не трогала. Всегда тёмный, того же оттенка что Фон.
    '--sidebar-bg': rgbStr(mix(B, BLACK, 0.90)),
    ...accentVars(theme),
  }
}

/**
 * ТЁМНЫЙ режим. Компоненты берут фон из ВЕРХНИХ шагов (800/900), а текст
 * из НИЖНИХ (100/200) — поэтому здесь масштаб инвертирован, НО роли те же:
 *   surf-700..950 ← Background (тёмные фоны — затемнённый Фон, тот же оттенок);
 *   surf-400..600 ← Secondary  (приглушённый текст);
 *   surf-50..300  ← Text       (светлый текст — осветлённый Текст).
 * Так «Фон» всегда красит фоны, «Текст» всегда текст — в обеих темах.
 */
function buildDark(theme: ThemeColors): Record<string, string> {
  const T = hexToRgb(theme.text)
  const B = hexToRgb(theme.background)
  const S = hexToRgb(theme.secondary)
  return {
    '--surf-50':  rgbStr(mix(T, WHITE, 0.92)),
    '--surf-100': rgbStr(mix(T, WHITE, 0.84)),
    '--surf-200': rgbStr(mix(T, WHITE, 0.70)),
    '--surf-300': rgbStr(mix(T, WHITE, 0.52)),
    '--surf-400': rgbStr(mix(S, WHITE, 0.24)),
    '--surf-500': rgbStr(S),
    '--surf-600': rgbStr(mix(S, BLACK, 0.18)),
    '--surf-700': rgbStr(mix(B, BLACK, 0.58)),
    '--surf-800': rgbStr(mix(B, BLACK, 0.72)),
    '--surf-900': rgbStr(mix(B, BLACK, 0.82)),
    '--surf-950': rgbStr(mix(B, BLACK, 0.90)),
    // Сайдбар — из Фона (НЕ из Текста), всегда тёмная панель.
    '--sidebar-bg': rgbStr(mix(B, BLACK, 0.92)),
    ...accentVars(theme),
  }
}

const STYLE_ID = 'theme-vars'
const block = (sel: string, vars: Record<string, string>) =>
  `${sel}{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}}`

/** Вставляем/обновляем <style> с двумя блоками (светлый+тёмный) и
 *  включаем класс theme-on на <html>. Селекторы html.theme-on /
 *  html.dark.theme-on перебивают дефолтные :root / .dark. */
function applyVars(theme: ThemeColors) {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!el) { el = document.createElement('style'); el.id = STYLE_ID; document.head.appendChild(el) }
  el.textContent =
    block('html.theme-on', buildLight(theme)) +
    block('html.dark.theme-on', buildDark(theme))
  document.documentElement.classList.add('theme-on')
}
function clearVars() {
  const el = document.getElementById(STYLE_ID)
  if (el) el.textContent = ''
  document.documentElement.classList.remove('theme-on')
}

// ─── Сериализация (формат realtimecolors: 5 hex через дефис) ──────────
export function serializeTheme(t: ThemeColors): string {
  const h = (s: string) => s.replace('#', '').toLowerCase()
  return [t.text, t.background, t.primary, t.secondary, t.accent].map(h).join('-')
}
export function parseTheme(str?: string | null): ThemeColors | null {
  if (!str || !/^[0-9a-f]{6}(-[0-9a-f]{6}){4}$/i.test(str.trim())) return null
  const [text, background, primary, secondary, accent] = str.trim().split('-').map(h => `#${h}`)
  return { text, background, primary, secondary, accent }
}

// ─── Zustand-стор ─────────────────────────────────────────────────────
interface ThemeState {
  theme: ThemeColors
  /** true если применена кастомная тема (не дефолт). Когда false —
   *  цвета берёт из CSS (включая .dark серый primary). */
  isCustom: boolean
  /** Применяет кастомную тему мгновенно (DOM + localStorage + стор). */
  setTheme: (theme: ThemeColors) => void
  /** Сброс к дефолтному ч/б монохрому. */
  reset: () => void
}

const STORAGE_KEY = 'theme-colors'

export const useThemeStore = create<ThemeState>(set => ({
  theme: DEFAULT_THEME,
  isCustom: false,
  setTheme: (theme) => {
    applyVars(theme)
    try { localStorage.setItem(STORAGE_KEY, serializeTheme(theme)) } catch {}
    set({ theme, isCustom: true })
  },
  reset: () => {
    clearVars()
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
    set({ theme: DEFAULT_THEME, isCustom: false })
  },
}))

/** Бутстрап до первого рендера — применяем закэшированную тему,
 *  чтобы интерфейс не мигал дефолтным. */
export function initThemeFromStorage() {
  let cached: ThemeColors | null = null
  try { cached = parseTheme(localStorage.getItem(STORAGE_KEY)) } catch {}
  if (cached) {
    applyVars(cached)
    useThemeStore.setState({ theme: cached, isCustom: true })
  }
}

/** Синхронизация с сервером после /auth/me — сервер источник истины. */
export function syncThemeFromServer(themeColor?: string | null) {
  const parsed = parseTheme(themeColor)
  if (parsed) {
    const cur = useThemeStore.getState()
    if (!cur.isCustom || serializeTheme(cur.theme) !== serializeTheme(parsed)) {
      useThemeStore.getState().setTheme(parsed)
    }
  } else {
    // На сервере темы нет → сброс (если локально была кастомная).
    if (useThemeStore.getState().isCustom) useThemeStore.getState().reset()
  }
}

/** Сброс при выходе — следующий вошедший не наследует чужую тему. */
export function resetTheme() {
  useThemeStore.getState().reset()
}

// ─── Палитра графиков из темы ─────────────────────────────────────────
function buildChartColors(t: ThemeColors): string[] {
  const primary = hexToRgb(t.primary)
  const accent = hexToRgb(t.accent)
  const secondary = hexToRgb(t.secondary)
  const text = hexToRgb(t.text)
  const toHex = (c: RGB) => '#' + c.map(x => clamp(x).toString(16).padStart(2, '0')).join('')
  // База: primary, accent, secondary + их осветлённые варианты — даёт
  // 6 различимых серий в гамме выбранной темы.
  return [
    toHex(primary),
    toHex(accent),
    toHex(secondary),
    toHex(mix(primary, WHITE, 0.4)),
    toHex(mix(accent, WHITE, 0.4)),
    toHex(mix(text, WHITE, 0.45)),
  ]
}

/** Реактивная палитра графиков — перерисовываются при смене темы. */
export function useChartColors(): string[] {
  const theme = useThemeStore(s => s.theme)
  const isCustom = useThemeStore(s => s.isCustom)
  // Дефолт (не кастом) — прежняя серая рампа (нейтральна к ч/б).
  if (!isCustom) return ['#18181b', '#52525b', '#8a8a93', '#a1a1aa', '#b4b4bb', '#d4d4d8']
  return buildChartColors(theme)
}

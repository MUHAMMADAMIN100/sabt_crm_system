import { create } from 'zustand'
// Стор режима отображения (light/dark) — отдельный от стора цветов.
import { useThemeStore as useColorModeStore } from '@/store/theme.store'

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

/** Дефолт — деловой графит: холодный нейтральный фон и сине-стальной
 *  акцент. Совпадает с базовыми токенами в index.css. */
export const DEFAULT_THEME: ThemeColors = {
  text: '#161e28',
  background: '#fcfdfe',
  primary: '#1e4263',
  secondary: '#6c798a',
  accent: '#345a7c',
}

/** Готовые наборы. Свободной пипетки нет намеренно: произвольный цвет
 *  легко делал текст нечитаемым. Здесь выверенные варианты — от
 *  сдержанных деловых до насыщенных фиолетовых и розовых; у каждого
 *  проверена читаемость текста и цифр при долгой работе.
 *
 *  mode — для какого режима набор задуман. Набор со светлым фоном в
 *  тёмной теме смотрелся бы вспышкой, поэтому редактор показывает
 *  только подходящие текущему режиму. */
export const THEME_PRESETS: { name: string; mode: 'light' | 'dark'; colors: ThemeColors }[] = [
  { name: 'Графит', mode: 'light', colors: DEFAULT_THEME },
  { name: 'Сталь',  mode: 'light', colors: { text: '#16202b', background: '#fcfdfe', primary: '#1e4263', secondary: '#5c718a', accent: '#345a7c' } },
  { name: 'Индиго', mode: 'light', colors: { text: '#141a2e', background: '#fbfcff', primary: '#2b3a67', secondary: '#5f6b8c', accent: '#3f5288' } },
  { name: 'Хаки',   mode: 'light', colors: { text: '#1a1f16', background: '#fcfdfa', primary: '#3d4a2b', secondary: '#6b7558', accent: '#54663a' } },
  { name: 'Фиалка', mode: 'light', colors: { text: '#1d1630', background: '#fdfbff', primary: '#5b3fa8', secondary: '#6d6490', accent: '#7c4dcc' } },
  { name: 'Слива',  mode: 'light', colors: { text: '#2a1421', background: '#fffbfd', primary: '#9c2f63', secondary: '#8a6577', accent: '#c2437f' } },
  { name: 'Тёмная',  mode: 'dark', colors: { text: '#e8ecf1', background: '#161e28', primary: '#6a93bd', secondary: '#8fa2b8', accent: '#5c85b0' } },
  { name: 'Аметист', mode: 'dark', colors: { text: '#ece8f8', background: '#1a1630', primary: '#9b7ce0', secondary: '#a49bc2', accent: '#8b6ad6' } },
  { name: 'Орхидея', mode: 'dark', colors: { text: '#f8e9f1', background: '#261420', primary: '#e07ca8', secondary: '#c09aac', accent: '#d66a9c' } },
  { name: 'Индиго ночь', mode: 'dark', colors: { text: '#e6e9f7', background: '#141a2e', primary: '#7f95d6', secondary: '#98a2c4', accent: '#6e85cc' } },
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
    // Текст сайдбара ← Text, но осветлённый — чтобы следовал роли
    // «Текст» по оттенку и всегда читался на тёмной панели.
    '--sidebar-fg': rgbStr(mix(T, WHITE, 0.62)),
    '--sidebar-fg-dim': rgbStr(mix(T, WHITE, 0.42)),
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
    // Текст сайдбара ← Text, осветлённый для читаемости на тёмном.
    '--sidebar-fg': rgbStr(mix(T, WHITE, 0.62)),
    '--sidebar-fg-dim': rgbStr(mix(T, WHITE, 0.42)),
    ...accentVars(theme),
  }
}

const STYLE_ID = 'theme-vars'
const block = (sel: string, vars: Record<string, string>) =>
  `${sel}{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}}`

/** Вставляем/обновляем <style> с двумя блоками (светлый+тёмный) и
 *  включаем класс theme-on на <html>. Селекторы html.theme-on /
 *  html.dark.theme-on перебивают дефолтные :root / .dark. */
function applyVars(light: ThemeColors, dark: ThemeColors) {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!el) { el = document.createElement('style'); el.id = STYLE_ID; document.head.appendChild(el) }
  // Светлая тема строится из набора light, тёмная — из набора dark
  // (раздельный выбор цветов для каждого режима).
  el.textContent =
    block('html.theme-on', buildLight(light)) +
    block('html.dark.theme-on', buildDark(dark))
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

/** Пара тем: 10 hex через дефис (5 светлая + 5 тёмная). */
export function serializeThemePair(light: ThemeColors, dark: ThemeColors): string {
  return `${serializeTheme(light)}-${serializeTheme(dark)}`
}
/** Разбор: 10 цветов → {light, dark}; 5 цветов (легаси) → один набор на оба
 *  режима; иначе null. */
export function parseThemePair(str?: string | null): { light: ThemeColors; dark: ThemeColors } | null {
  const s = (str || '').trim()
  if (/^[0-9a-f]{6}(-[0-9a-f]{6}){9}$/i.test(s)) {
    const parts = s.split('-')
    const light = parseTheme(parts.slice(0, 5).join('-'))
    const dark = parseTheme(parts.slice(5, 10).join('-'))
    if (light && dark) return { light, dark }
  }
  const single = parseTheme(s)
  if (single) return { light: single, dark: single }
  return null
}

// ─── Zustand-стор ─────────────────────────────────────────────────────
interface ThemeState {
  /** Набор цветов для СВЕТЛОЙ темы. */
  light: ThemeColors
  /** Набор цветов для ТЁМНОЙ темы (выбирается отдельно от светлой). */
  dark: ThemeColors
  /** true если применена кастомная тема (не дефолт). Когда false —
   *  цвета берёт из CSS (включая .dark серый primary). */
  isCustom: boolean
  /** Применяет обе темы мгновенно (DOM + localStorage + стор). */
  setThemes: (light: ThemeColors, dark: ThemeColors) => void
  /** Обновить набор только одного режима, второй оставить как есть. */
  updateMode: (mode: 'light' | 'dark', theme: ThemeColors) => void
  /** Сброс к дефолтному ч/б монохрому (оба режима). */
  reset: () => void
}

const STORAGE_KEY = 'theme-colors'

export const useThemeStore = create<ThemeState>((set, get) => ({
  light: DEFAULT_THEME,
  dark: DEFAULT_THEME,
  isCustom: false,
  setThemes: (light, dark) => {
    applyVars(light, dark)
    try { localStorage.setItem(STORAGE_KEY, serializeThemePair(light, dark)) } catch {}
    set({ light, dark, isCustom: true })
  },
  updateMode: (mode, theme) => {
    const cur = get()
    get().setThemes(mode === 'light' ? theme : cur.light, mode === 'dark' ? theme : cur.dark)
  },
  reset: () => {
    clearVars()
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
    set({ light: DEFAULT_THEME, dark: DEFAULT_THEME, isCustom: false })
  },
}))

/** Бутстрап до первого рендера — применяем закэшированную тему,
 *  чтобы интерфейс не мигал дефолтным. */
export function initThemeFromStorage() {
  let cached: { light: ThemeColors; dark: ThemeColors } | null = null
  try { cached = parseThemePair(localStorage.getItem(STORAGE_KEY)) } catch {}
  if (cached) {
    applyVars(cached.light, cached.dark)
    useThemeStore.setState({ light: cached.light, dark: cached.dark, isCustom: true })
  }
}

/** Синхронизация с сервером после /auth/me — сервер источник истины. */
export function syncThemeFromServer(themeColor?: string | null) {
  const parsed = parseThemePair(themeColor)
  if (parsed) {
    const cur = useThemeStore.getState()
    const next = serializeThemePair(parsed.light, parsed.dark)
    if (!cur.isCustom || serializeThemePair(cur.light, cur.dark) !== next) {
      cur.setThemes(parsed.light, parsed.dark)
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

/** Реактивная палитра графиков — перерисовываются при смене темы. Берёт
 *  набор активного режима (светлый/тёмный). */
export function useChartColors(): string[] {
  const light = useThemeStore(s => s.light)
  const dark = useThemeStore(s => s.dark)
  const isCustom = useThemeStore(s => s.isCustom)
  const mode = useColorModeStore(s => s.theme)
  // Дефолт (не кастом) — прежняя серая рампа (нейтральна к ч/б).
  if (!isCustom) return ['#18181b', '#52525b', '#8a8a93', '#a1a1aa', '#b4b4bb', '#d4d4d8']
  return buildChartColors(mode === 'dark' ? dark : light)
}

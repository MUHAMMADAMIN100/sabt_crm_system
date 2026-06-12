import { create } from 'zustand'

/**
 * Персональный акцентный цвет интерфейса.
 *
 * Вся палитра системы сидит на CSS-переменных --prim-* (см. index.css).
 * Выбор цвета вешает класс accent-<key> на <html> — переменные
 * мгновенно подменяются, и ВСЁ, что использует primary-* (кнопки,
 * ссылки, сайдбар, фокусы, календарь, бейджи), перекрашивается без
 * перезагрузки. «black» — дефолтный ч/б монохром (класс не вешается).
 *
 * Выбор хранится в users.themeColor (ездит за сотрудником между
 * устройствами) + кэш в localStorage, чтобы не мигало при загрузке.
 */
export type AccentKey = 'black' | 'violet' | 'blue' | 'green' | 'red' | 'orange' | 'teal' | 'pink'

export const ACCENTS: { key: AccentKey; label: string; swatch: string }[] = [
  { key: 'black',  label: 'Чёрный',     swatch: '#18181b' },
  { key: 'violet', label: 'Фиолетовый', swatch: '#4f46e5' },
  { key: 'blue',   label: 'Синий',      swatch: '#2563eb' },
  { key: 'green',  label: 'Зелёный',    swatch: '#059669' },
  { key: 'red',    label: 'Красный',    swatch: '#dc2626' },
  { key: 'orange', label: 'Оранжевый',  swatch: '#ea580c' },
  { key: 'teal',   label: 'Бирюзовый',  swatch: '#0d9488' },
  { key: 'pink',   label: 'Розовый',    swatch: '#db2777' },
]

const ACCENT_CLASSES = ACCENTS.filter(a => a.key !== 'black').map(a => `accent-${a.key}`)

export function normalizeAccent(v?: string | null): AccentKey {
  return (ACCENTS.some(a => a.key === v) ? v : 'black') as AccentKey
}

/** Вешает/снимает класс акцента на <html>. */
function applyAccentDom(key: AccentKey) {
  const el = document.documentElement
  el.classList.remove(...ACCENT_CLASSES)
  if (key !== 'black') el.classList.add(`accent-${key}`)
}

interface ThemeState {
  accent: AccentKey
  /** Мгновенно применяет цвет (DOM + localStorage + подписчики). */
  setAccent: (key: AccentKey) => void
}

export const useThemeStore = create<ThemeState>(set => ({
  accent: 'black',
  setAccent: (key) => {
    try { localStorage.setItem('accent-color', key) } catch {}
    applyAccentDom(key)
    set({ accent: key })
  },
}))

/** Вызывается один раз при старте приложения (до первого рендера) —
 *  применяет закэшированный цвет, чтобы интерфейс не мигал дефолтным. */
export function initAccentFromStorage() {
  let cached: AccentKey = 'black'
  try { cached = normalizeAccent(localStorage.getItem('accent-color')) } catch {}
  applyAccentDom(cached)
  useThemeStore.setState({ accent: cached })
}

/** Синхронизация с сервером: вызывается после /auth/me. */
export function syncAccentFromServer(themeColor?: string | null) {
  const key = normalizeAccent(themeColor)
  if (useThemeStore.getState().accent !== key) {
    useThemeStore.getState().setAccent(key)
  }
}

/** Сброс при выходе — следующий вошедший не наследует чужой цвет. */
export function resetAccent() {
  try { localStorage.removeItem('accent-color') } catch {}
  applyAccentDom('black')
  useThemeStore.setState({ accent: 'black' })
}

// ─── Палитры графиков по акценту ──────────────────────────────────────
const MONO_CHART = ['#18181b', '#52525b', '#8a8a93', '#a1a1aa', '#b4b4bb', '#d4d4d8']
const CHART_PALETTES: Record<AccentKey, string[]> = {
  black:  MONO_CHART,
  violet: ['#4f46e5', '#818cf8', '#312e81', '#a5b4fc', '#71717a', '#d4d4d8'],
  blue:   ['#2563eb', '#60a5fa', '#1e3a8a', '#93c5fd', '#71717a', '#d4d4d8'],
  green:  ['#059669', '#34d399', '#064e3b', '#6ee7b7', '#71717a', '#d4d4d8'],
  red:    ['#dc2626', '#f87171', '#7f1d1d', '#fca5a5', '#71717a', '#d4d4d8'],
  orange: ['#ea580c', '#fb923c', '#7c2d12', '#fdba74', '#71717a', '#d4d4d8'],
  teal:   ['#0d9488', '#2dd4bf', '#134e4a', '#5eead4', '#71717a', '#d4d4d8'],
  pink:   ['#db2777', '#f472b6', '#831843', '#f9a8d4', '#71717a', '#d4d4d8'],
}

/** Палитра графиков текущего акцента — реактивная (графики
 *  перекрашиваются мгновенно при смене цвета). */
export function useChartColors(): string[] {
  const accent = useThemeStore(s => s.accent)
  return CHART_PALETTES[accent]
}

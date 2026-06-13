import { useState } from 'react'
import { HexColorPicker } from 'react-colorful'
import { Palette, Pipette, RotateCcw, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { authApi } from '@/services/api.service'
import {
  useThemeStore, serializeTheme, THEME_PRESETS, DEFAULT_THEME, type ThemeColors,
} from '@/lib/theme'

/** 5 ролей цвета (модель realtimecolors). Порядок — как в редакторе. */
const ROLES: { key: keyof ThemeColors; label: string; hint: string }[] = [
  { key: 'text',       label: 'Текст',     hint: 'Текст и тёмные элементы' },
  { key: 'background', label: 'Фон',       hint: 'Фон страниц и карточек' },
  { key: 'primary',    label: 'Основной',  hint: 'Кнопки, ссылки, активные пункты' },
  { key: 'secondary',  label: 'Вторичный', hint: 'Вторичные элементы, графики' },
  { key: 'accent',     label: 'Акцент',    hint: 'Выделения, графики' },
]

/**
 * Редактор персональной темы (как realtimecolors): 5 настраиваемых
 * цветов с пикером/HEX/пипеткой. Любое изменение применяется МГНОВЕННО
 * ко всему интерфейсу (live-preview прямо на системе), сохраняется на
 * сервере (users.themeColor) — тема ездит за сотрудником, персональна.
 */
export default function ThemeEditorSection() {
  const theme = useThemeStore(s => s.theme)
  const isCustom = useThemeStore(s => s.isCustom)
  const setTheme = useThemeStore(s => s.setTheme)
  const reset = useThemeStore(s => s.reset)
  const [openRole, setOpenRole] = useState<keyof ThemeColors | null>(null)

  const saveServer = (str: string | null) =>
    authApi.setTheme(str).catch(() => toast.error('Не удалось сохранить тему — действует до перезахода'))

  // Мгновенно применяем; на сервер пишем при закрытии пикера/смене роли.
  const changeColor = (key: keyof ThemeColors, hex: string) =>
    setTheme({ ...useThemeStore.getState().theme, [key]: hex })

  const commit = () => saveServer(serializeTheme(useThemeStore.getState().theme))

  const applyPreset = (colors: ThemeColors) => {
    if (serializeTheme(colors) === serializeTheme(DEFAULT_THEME)) {
      reset(); saveServer(null); setOpenRole(null); return
    }
    setTheme(colors); saveServer(serializeTheme(colors)); setOpenRole(null)
  }

  const onReset = () => { reset(); saveServer(null); setOpenRole(null) }

  const pickEyedropper = async (key: keyof ThemeColors) => {
    const Eye = (window as any).EyeDropper
    if (!Eye) { toast('Пипетка не поддерживается этим браузером', { icon: 'ℹ️' }); return }
    try {
      const res = await new Eye().open()
      if (res?.sRGBHex) { changeColor(key, res.sRGBHex); commit() }
    } catch { /* отменили — игнор */ }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <div className="flex items-center gap-2">
          <Palette size={16} className="text-primary-600" />
          <h3 className="section-title">Цвет системы</h3>
        </div>
        {isCustom && (
          <button type="button" onClick={onReset}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-surface-500 hover:text-surface-800 dark:hover:text-surface-200">
            <RotateCcw size={13} /> Сбросить
          </button>
        )}
      </div>
      <p className="text-xs text-surface-500 dark:text-surface-400 mb-4">
        Личная настройка — весь интерфейс перекрашивается мгновенно и только у вас.
      </p>

      {/* Быстрые пресеты */}
      <div className="flex flex-wrap gap-2 mb-5">
        {THEME_PRESETS.map(p => (
          <button
            key={p.name}
            type="button"
            onClick={() => applyPreset(p.colors)}
            title={p.name}
            className="flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border border-surface-200 dark:border-surface-700 hover:border-surface-400 dark:hover:border-surface-500 transition-colors"
          >
            <span className="flex -space-x-1">
              <span className="w-4 h-4 rounded-full ring-1 ring-surface-200 dark:ring-surface-700" style={{ backgroundColor: p.colors.primary }} />
              <span className="w-4 h-4 rounded-full ring-1 ring-surface-200 dark:ring-surface-700" style={{ backgroundColor: p.colors.accent }} />
            </span>
            <span className="text-[11px] font-medium text-surface-600 dark:text-surface-300">{p.name}</span>
          </button>
        ))}
      </div>

      {/* 5 ролей цвета */}
      <div className="space-y-2">
        {ROLES.map(role => {
          const value = theme[role.key]
          const isOpen = openRole === role.key
          return (
            <div key={role.key} className="rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
              <button
                type="button"
                onClick={() => { if (isOpen) commit(); setOpenRole(isOpen ? null : role.key) }}
                className="w-full flex items-center gap-3 p-2.5 hover:bg-surface-50 dark:hover:bg-surface-800/60 transition-colors"
              >
                <span
                  className="w-9 h-9 rounded-lg shrink-0 ring-1 ring-inset ring-black/10"
                  style={{ backgroundColor: value }}
                />
                <span className="flex-1 min-w-0 text-left">
                  <span className="block text-sm font-medium text-surface-800 dark:text-surface-100">{role.label}</span>
                  <span className="block text-[11px] text-surface-400 dark:text-surface-500 truncate">{role.hint}</span>
                </span>
                <span className="text-xs font-mono uppercase text-surface-500 dark:text-surface-400">{value}</span>
              </button>

              {isOpen && (
                <div className="p-3 border-t border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/40">
                  <HexColorPicker
                    color={value}
                    onChange={(hex) => changeColor(role.key, hex)}
                    style={{ width: '100%', height: 160 }}
                  />
                  <div className="flex items-center gap-2 mt-3">
                    <span className="text-sm text-surface-400">#</span>
                    <input
                      value={value.replace('#', '')}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
                        changeColor(role.key, `#${v.padEnd(6, '0')}`)
                      }}
                      onBlur={commit}
                      className="input flex-1 font-mono uppercase"
                      maxLength={6}
                      placeholder="000000"
                    />
                    <button type="button" onClick={() => pickEyedropper(role.key)} title="Пипетка"
                      className="btn-secondary px-2.5 shrink-0"><Pipette size={15} /></button>
                    <button type="button" onClick={() => { commit(); setOpenRole(null) }} title="Готово"
                      className="btn-primary px-2.5 shrink-0"><Check size={15} /></button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

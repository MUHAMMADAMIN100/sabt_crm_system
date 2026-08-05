import { useState } from 'react'
import { Palette, RotateCcw, Sun, Moon } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { authApi } from '@/services/api.service'
import {
  useThemeStore, serializeTheme, serializeThemePair, THEME_PRESETS, DEFAULT_THEME, type ThemeColors,
} from '@/lib/theme'
import { useThemeStore as useColorMode } from '@/store/theme.store'

/** 5 ролей цвета (модель realtimecolors). Порядок — как в редакторе. */
const ROLES: { key: keyof ThemeColors; label: string; hint: string }[] = [
  { key: 'text',       label: 'Текст',     hint: 'Текст, заголовки, сайдбар' },
  { key: 'background', label: 'Фон',       hint: 'Фон страниц, карточек, границы' },
  { key: 'primary',    label: 'Основной',  hint: 'Кнопки, ссылки, активные пункты' },
  { key: 'secondary',  label: 'Вторичный', hint: 'Приглушённый текст, иконки' },
  { key: 'accent',     label: 'Акцент',    hint: 'Графики, выделения' },
]

/**
 * Редактор персональной темы (как realtimecolors): 5 настраиваемых цветов
 * с пикером/HEX/пипеткой — ОТДЕЛЬНО для светлой и тёмной темы. Переключатель
 * режима вверху меняет и редактируемый набор, и сам интерфейс (живой
 * предпросмотр). Сохраняется на сервере (users.themeColor) — тема ездит за
 * сотрудником, персональна.
 */
export default function ThemeEditorSection() {
  const light = useThemeStore(s => s.light)
  const dark = useThemeStore(s => s.dark)
  const isCustom = useThemeStore(s => s.isCustom)
  const updateMode = useThemeStore(s => s.updateMode)
  const reset = useThemeStore(s => s.reset)

  // Текущий режим интерфейса (light/dark) — он же определяет, какой набор
  // цветов мы сейчас редактируем. Переключение режима даёт живой предпросмотр.
  const mode = useColorMode(s => s.theme)
  const setColorMode = useColorMode(s => s.setTheme)
  const active = mode === 'dark' ? dark : light

  const saveServer = (str: string | null) =>
    authApi.setTheme(str).catch(() => toast.error('Не удалось сохранить тему — действует до перезахода'))

  // Сохраняем пару (светлая+тёмная). Если оба набора = дефолт — сбрасываем.
  const commit = () => {
    const st = useThemeStore.getState()
    const isDefault =
      serializeTheme(st.light) === serializeTheme(DEFAULT_THEME) &&
      serializeTheme(st.dark) === serializeTheme(DEFAULT_THEME)
    if (isDefault) { reset(); saveServer(null) }
    else saveServer(serializeThemePair(st.light, st.dark))
  }

  // Мгновенно применяем выбранному режиму; на сервер пишем по commit.
  const applyPreset = (colors: ThemeColors) => { updateMode(mode, colors); commit() }

  const onReset = () => { reset(); saveServer(null) }


  const modeBtn = (m: 'light' | 'dark', Icon: any, label: string) => (
    <button
      type="button"
      onClick={() => { setColorMode(m) }}
      className={clsx(
        'flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
        mode === m
          ? 'bg-primary-600 text-white shadow-sm'
          : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600',
      )}
    >
      <Icon size={15} /> {label}
    </button>
  )

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
      <p className="text-xs text-surface-500 dark:text-surface-400 mb-3">
        Личная настройка — весь интерфейс перекрашивается мгновенно и только у вас.
        Цвета можно задать отдельно для светлой и тёмной темы.
      </p>

      {/* Переключатель редактируемого режима (он же — режим интерфейса) */}
      <div className="flex items-center gap-2 mb-4">
        {modeBtn('light', Sun, 'Светлая')}
        {modeBtn('dark', Moon, 'Тёмная')}
      </div>
      <p className="text-[11px] text-surface-400 dark:text-surface-500 mb-4 -mt-2">
        Сейчас настраиваете: <b className="text-surface-600 dark:text-surface-300">{mode === 'dark' ? 'тёмная тема' : 'светлая тема'}</b>
      </p>

      {/* Быстрые пресеты — применяются к выбранному режиму */}
      <div className="flex flex-wrap gap-2 mb-5">
        {THEME_PRESETS.map(p => (
          <button
            key={p.name}
            type="button"
            onClick={() => applyPreset(p.colors)}
            title={`${p.name} — для ${mode === 'dark' ? 'тёмной' : 'светлой'} темы`}
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

      {/* Свободный подбор цвета убран: он позволял покрасить рабочую
          систему в розовый или лайм. Остались выверенные деловые наборы
          выше — этого достаточно, чтобы настроить под себя, но нельзя
          сделать интерфейс несерьёзным. */}
      <p className="text-[11px] text-surface-500 dark:text-surface-400">
        Наборы подобраны так, чтобы текст и цифры оставались читаемыми при долгой работе.
      </p>
    </div>
  )
}

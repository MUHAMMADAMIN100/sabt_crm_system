import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import clsx from 'clsx'

export interface BoardSelectOption {
  value: string
  label: string
}

interface PanelPos {
  left: number
  top: number      // низ кнопки (или её верх при раскрытии вверх)
  width: number
  up: boolean      // true — панель раскрывается вверх (мало места снизу)
}

/**
 * Кастомный селект модуля «Доска разработки».
 *
 * Общий <Select> из @/components/ui — это нативный <select>: выпадашка
 * рисуется браузером (системный синий хайлайт, ноль анимации, разный вид
 * на Windows/macOS). Здесь — собственный поповер:
 *  - плавное раскрытие (fade + slide + scale, 150 мс ease-out) и такое же
 *    плавное сворачивание (панель уходит с затуханием, а не исчезает мгновенно);
 *  - выбранная опция — с галочкой, hover — мягкий фон;
 *  - навигация с клавиатуры (↑/↓/Home/End/Enter/Esc), закрытие по клику вне;
 *  - панель рисуется через portal в document.body и позиционируется
 *    position:fixed по кнопке — НЕ клиппится контейнерами с overflow
 *    (таблица с инлайн-селектами, модалка), при нехватке места снизу
 *    раскрывается вверх; закрывается при скролле/resize окна;
 *  - тот же API, что у ui-Select: value / onChange / options / placeholder.
 *
 * Локальный для dev-board: общий компонент не трогаем, остальная система
 * продолжает использовать нативный селект.
 */
export function BoardSelect({ value, onChange, options, placeholder, className }: {
  value: string
  onChange: (v: string) => void
  options: BoardSelectOption[]
  placeholder?: string
  className?: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  // Стабильные id для aria: панель в портале (не DOM-потомок кнопки),
  // связываем button ↔ listbox ↔ option через aria-controls/activedescendant.
  const btnId = useId()
  const listId = useId()
  // rAF раскрытия — отменяем при unmount, чтобы не звать setState после.
  const rafRef = useRef<number[]>([])
  // mounted — панель в DOM; visible — классы анимации. Разделяем, чтобы
  // успела сыграть анимация закрытия до удаления панели из DOM.
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [pos, setPos] = useState<PanelPos | null>(null)
  const closeTimer = useRef<number | null>(null)

  const all = placeholder ? [{ value: '', label: placeholder }, ...options] : options
  const current = all.find(o => o.value === value)
  const isPlaceholder = !current || current.value === ''

  const openPanel = () => {
    if (mounted) return
    // Отменяем отложенный unmount после быстрого toggle (иначе панель
    // закроется сама через 160 мс после повторного открытия).
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    // Фиксируем позицию по кнопке ДО маунта панели.
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom
      const up = spaceBelow < 280 && rect.top > 280
      setPos({ left: rect.left, top: up ? rect.top - 4 : rect.bottom + 4, width: rect.width, up })
    }
    setMounted(true)
    setHighlight(Math.max(0, all.findIndex(o => o.value === value)))
    // Двойной rAF: маунт с «закрытыми» классами, следующий кадр — «открытые»,
    // иначе transition не успеет инициализироваться. id — в rafRef для отмены
    // при размонтировании (setState после unmount).
    rafRef.current.push(
      requestAnimationFrame(() => {
        rafRef.current.push(requestAnimationFrame(() => setVisible(true)))
      }),
    )
  }
  const closePanel = () => {
    setVisible(false)
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      setMounted(false)
      closeTimer.current = null
    }, 160)
  }
  const toggle = () => (mounted ? closePanel() : openPanel())

  const pick = (v: string) => {
    closePanel()
    onChange(v)
    // Клик по опции в портале переносит фокус в body (li не фокусируется) —
    // возвращаем его на триггер, чтобы Tab продолжался с места выбора.
    btnRef.current?.focus({ preventScroll: true })
  }

  // Размонтирование: глушим отложенные rAF раскрытия и таймер закрытия —
  // иначе setState после unmount (панель живёт ещё 160 мс) и висячий таймер.
  useEffect(() => () => {
    rafRef.current.forEach(id => cancelAnimationFrame(id))
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  // Клик вне — закрыть. Скролл/resize — тоже: панель position:fixed по
  // старым координатам кнопки, при сдвиге страницы она «отвалится».
  // Скролл внутри самой панели (длинные списки) — не закрываем.
  useEffect(() => {
    if (!mounted) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!rootRef.current?.contains(t) && !listRef.current?.contains(t)) closePanel()
    }
    const onScroll = (e: Event) => {
      if (listRef.current && e.target instanceof Node && listRef.current.contains(e.target)) return
      closePanel()
    }
    const onResize = () => closePanel()
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current)
        closeTimer.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!mounted) {
      // ↑/↓/Enter/Пробел открывают панель (паттерн listbox).
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        openPanel()
      }
      return
    }
    if (e.key === 'Escape') {
      // Не отдаём Escape родителям: селект живёт внутри модалок доски —
      // без stopPropagation закрылась бы и модалка.
      e.preventDefault()
      e.stopPropagation()
      closePanel()
    }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(all.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)) }
    else if (e.key === 'Home') { e.preventDefault(); setHighlight(0) }
    else if (e.key === 'End') { e.preventDefault(); setHighlight(all.length - 1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (all[highlight]) pick(all[highlight].value) }
    else if (e.key === 'Tab') closePanel()
  }

  // Подсвеченная опция всегда в зоне видимости (длинные списки сотрудников).
  useEffect(() => {
    if (!mounted || highlight < 0) return
    listRef.current?.children[highlight]?.scrollIntoView({ block: 'nearest' })
  }, [highlight, mounted])

  return (
    <div ref={rootRef} className={clsx('relative', className)} onKeyDown={onKeyDown}>
      <button
        ref={btnRef}
        id={btnId}
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={mounted}
        aria-label={placeholder}
        aria-controls={mounted && pos ? listId : undefined}
        aria-activedescendant={mounted && pos && highlight >= 0 ? `${listId}-${highlight}` : undefined}
        className={clsx(
          'input w-full flex items-center justify-between gap-2 text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50',
          isPlaceholder && 'text-surface-500 dark:text-surface-400',
        )}
      >
        <span className="truncate">{current?.label ?? placeholder ?? ''}</span>
        <ChevronDown
          size={15}
          aria-hidden="true"
          className={clsx(
            'shrink-0 text-surface-400 transition-transform duration-150 ease-out',
            mounted && 'rotate-180',
          )}
        />
      </button>

      {mounted && pos && createPortal(
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-labelledby={btnId}
          style={{
            position: 'fixed',
            // У края viewport панель не уезжает за правый край.
            left: Math.max(8, Math.min(pos.left, window.innerWidth - pos.width - 8)),
            width: pos.width,
            maxWidth: 'calc(100vw - 16px)',
            ...(pos.up
              ? { bottom: window.innerHeight - pos.top }
              : { top: pos.top }),
          }}
          className={clsx(
            'z-[999] py-1',
            'rounded-lg border border-surface-200 dark:border-surface-700',
            'bg-white dark:bg-surface-800 shadow-xl',
            'max-h-64 overflow-auto',
            'transition-all duration-150 ease-out',
            pos.up ? 'origin-bottom' : 'origin-top',
            visible
              ? 'opacity-100 translate-y-0 scale-100'
              : clsx('opacity-0 scale-[0.98] pointer-events-none', pos.up ? 'translate-y-1' : '-translate-y-1'),
          )}
        >
          {all.map((o, idx) => {
            const selected = o.value === value
            return (
              <li
                key={o.value || '__placeholder__'}
                id={`${listId}-${idx}`}
                role="option"
                aria-selected={selected}
                onClick={() => pick(o.value)}
                onMouseEnter={() => setHighlight(idx)}
                className={clsx(
                  'px-3 py-1.5 text-sm flex items-center justify-between gap-2 cursor-pointer',
                  'transition-colors duration-100',
                  highlight === idx && 'bg-primary-50 dark:bg-primary-900/30',
                  selected
                    ? 'text-primary-700 dark:text-primary-300 font-medium'
                    : 'text-surface-700 dark:text-surface-300',
                )}
              >
                <span className="truncate">{o.label}</span>
                {selected && <Check size={14} aria-hidden="true" className="shrink-0" />}
              </li>
            )
          })}
        </ul>,
        document.body,
      )}
    </div>
  )
}

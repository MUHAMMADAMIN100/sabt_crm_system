import React from 'react'

/** Ошибка загрузки lazy-чанка: после выкладки браузер со старым index.html
 *  просит файл, которого уже нет. Chrome — «Failed to fetch dynamically
 *  imported module», Safari — «Importing a module script failed», Firefox —
 *  «error loading dynamically imported module» (добавлен 15.11.2026). */
export function isChunkLoadError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null
  if (!e) return false
  if (e.name === 'ChunkLoadError') return true
  const msg = String(e.message || e.name || '')
  return /Loading chunk \S+ failed/i.test(msg)
    || /Failed to fetch dynamically imported module/i.test(msg)
    || /error loading dynamically imported module/i.test(msg)
    || /Importing a module script failed/i.test(msg)
}

const RELOAD_KEY = '__chunkReloadTs'

/** Перезагрузка за свежим index.html — не чаще раза в 8 сек. Если сразу после
 *  перезагрузки снова та же ошибка, reload не помог: не зацикливаемся, а
 *  показываем экран с кнопкой. Возвращает true, если перезагрузка запущена. */
export function reloadForChunkError(): boolean {
  if (typeof window === 'undefined') return false
  let last = 0
  try { last = Number(sessionStorage.getItem(RELOAD_KEY) || '0') } catch { /* ignore */ }
  if (Date.now() - last <= 8000) return false
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch { /* ignore */ }
  window.location.reload()
  return true
}

/** Экран «что-то пошло не так» (15.11.2026). Раньше любая ошибка рендера
 *  давала вечный лоадер. Цвета — из темы (primary/surface), без индиго. */
export function ErrorScreen({ chunk, fullScreen, onHome }: {
  /** Не загрузилась новая версия страницы (чанк), а не ошибка в коде. */
  chunk?: boolean
  /** На весь экран (верхняя граница, без меню) или внутри страницы. */
  fullScreen?: boolean
  /** Переход на главную без перезагрузки (внутри Layout). */
  onHome?: () => void
}) {
  const reload = () => {
    try { sessionStorage.removeItem(RELOAD_KEY) } catch { /* ignore */ }
    window.location.reload()
  }
  const goHome = () => {
    // Уже на главной — переход ничего не сбросит, нужна перезагрузка.
    if (onHome && window.location.pathname !== '/') onHome()
    else window.location.assign('/')
  }
  return (
    <div
      role="alert"
      className={
        'flex flex-col items-center justify-center gap-3 p-6 text-center ' +
        (fullScreen ? 'min-h-screen bg-surface-50 dark:bg-surface-900' : 'min-h-[50vh]')
      }
    >
      <h2 className="text-base font-semibold text-surface-900 dark:text-surface-100">
        {chunk ? 'Вышла новая версия CRM' : 'Не удалось показать страницу'}
      </h2>
      <p className="max-w-sm text-sm text-surface-500 dark:text-surface-400">
        {chunk
          ? 'Не удалось загрузить обновлённую версию страницы. Обновите её.'
          : 'Произошла ошибка. Обновите страницу или вернитесь на главную. Если повторится — сообщите администратору.'}
      </p>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={reload} className="btn-primary">Обновить страницу</button>
        <button type="button" onClick={goHome} className="btn-secondary">На главную</button>
      </div>
    </div>
  )
}

/** Граница ошибок (15.11.2026). Внутри Layout — вокруг <Outlet>: ошибка одной
 *  страницы не роняет меню, а переход на другой адрес (resetKey) снимает её.
 *  Наверху App — та же граница на весь экран. Ошибку загрузки чанка лечим
 *  перезагрузкой (не чаще раза в 8 сек), остальные показываем экраном. */
export default class PageErrorBoundary extends React.Component<
  { children: React.ReactNode; resetKey?: string; fullScreen?: boolean; onHome?: () => void },
  { error: Error | null; key?: string }
> {
  state = { error: null as Error | null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  static getDerivedStateFromProps(
    props: { resetKey?: string },
    state: { error: Error | null; key?: string },
  ) {
    // Сменился адрес — пробуем показать новую страницу заново.
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey }
    return null
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (isChunkLoadError(error)) {
      reloadForChunkError()
      return
    }
    // eslint-disable-next-line no-console
    console.error('[PageErrorBoundary]', error, info?.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return <ErrorScreen chunk={isChunkLoadError(error)} fullScreen={this.props.fullScreen} onHome={this.props.onHome} />
  }
}

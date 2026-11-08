// «Назад» — ровно на шаг (08.11.2026, макет «Как будет работать «Назад»»,
// утверждён владельцем). Три вещи в одном месте:
//  1. Память места: прокрутка <main> для каждого шага истории и подсветка
//     «вы были здесь» на строке, из которой ушли (useScrollMemory — в Layout).
//  2. Стрелка «‹»: ведёт на шаг назад и подписана местом, откуда пришли;
//     если пришли не из CRM (ссылка в новой вкладке) — в родительский раздел
//     (useBackTarget / BackLink).
//  3. Окна и шторки как шаг истории: «Назад» сначала закрывает окно, а если
//     из окна ушли дальше — при возврате оно снова открыто (useHistoryOverlay).
// История — обычный BrowserRouter: idx шага лежит в window.history.state.idx.
import { useEffect, useLayoutEffect, useRef, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom'

type Mark = { tag: string; text: string }
type Mem = {
  /** idx шага истории → ключ шага (location.key). */
  stack: string[]
  /** ключ шага → адрес и заголовок страницы. */
  pages: Record<string, { path: string; title?: string }>
  /** ключ шага → прокрутка <main>. */
  scroll: Record<string, number>
  /** ключ шага → последняя нажатая строка (для «вы были здесь»). */
  mark: Record<string, Mark>
}

const STORE = 'sabt-nav-mem-v1'
const mem: Mem = (() => {
  try {
    const raw = sessionStorage.getItem(STORE)
    if (raw) return { stack: [], pages: {}, scroll: {}, mark: {}, ...JSON.parse(raw) }
  } catch { /* приватный режим — живём в памяти */ }
  return { stack: [], pages: {}, scroll: {}, mark: {} }
})()
let saveTimer: number | undefined
function persist() {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      // Держим только последние ~80 шагов, чтобы sessionStorage не рос.
      const keep = new Set(mem.stack.slice(-80))
      const pick = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([k]) => keep.has(k)))
      sessionStorage.setItem(STORE, JSON.stringify({ stack: mem.stack, pages: pick(mem.pages), scroll: pick(mem.scroll), mark: pick(mem.mark) }))
    } catch { /* нет места или нет доступа — не страшно */ }
  }, 300)
}

const historyIdx = (): number => {
  const idx = (window.history.state as any)?.idx
  return typeof idx === 'number' ? idx : 0
}

/** Заголовок открытой страницы — им подписываем стрелку «‹» на следующей. */
function currentTitle(root: ParentNode | null): string | undefined {
  const h = root?.querySelector('h1') as HTMLElement | null
  const t = h?.innerText?.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, 40) : undefined
}

/** Подписи разделов, у которых нет понятного заголовка на странице. */
const ROUTE_LABEL: Record<string, string> = {
  '/': 'Панель',
  '/finance': 'Обзор',
}

/** Идёт восстановление места после «Назад» (на случай, если страница сразу
 *  заменит адрес). */
let restoring: { until: number; target: number; mark?: Mark } | null = null

const ROW_SELECTOR = 'a, button, tr, li, [role="button"], [role="row"], [data-row]'
const markOf = (el: Element): Mark | null => {
  const row = el.closest(ROW_SELECTOR) as HTMLElement | null
  if (!row) return null
  const text = (row.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  return text ? { tag: row.tagName, text } : null
}

/** Каркас (Layout): запоминает и восстанавливает прокрутку <main> на каждом
 *  шаге, ведёт стек шагов для стрелки «‹» и подсвечивает строку, из
 *  которой ушли. Возвращает тип перехода — Layout не проигрывает появление
 *  страницы при «Назад». */
export function useScrollMemory(mainRef: RefObject<HTMLElement>) {
  const location = useLocation()
  const navType = useNavigationType()
  const keyRef = useRef(location.key)
  keyRef.current = location.key

  // Стек шагов и адреса.
  useLayoutEffect(() => {
    const idx = historyIdx()
    if (navType === 'PUSH') mem.stack.length = idx
    // Тот же шаг получил новый ключ (сменили месяц или фильтр — адрес
    // заменён): переносим на него прокрутку, строку и заголовок.
    const prevKey = mem.stack[idx]
    if (navType === 'REPLACE' && prevKey && prevKey !== location.key) {
      if (mem.scroll[prevKey] != null && mem.scroll[location.key] == null) mem.scroll[location.key] = mem.scroll[prevKey]
      if (mem.mark[prevKey] && !mem.mark[location.key]) mem.mark[location.key] = mem.mark[prevKey]
      if (mem.pages[prevKey]?.title) mem.pages[location.key] = { path: '', title: mem.pages[prevKey].title }
    }
    mem.stack[idx] = location.key
    const prev = mem.pages[location.key]
    mem.pages[location.key] = { path: location.pathname + location.search, title: prev?.title }
    persist()
  }, [location.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Прокрутка: запоминаем по ходу, восстанавливаем при «Назад»/«Вперёд»,
  // на новой странице — наверх; смена фильтра/месяца (REPLACE) не трогает.
  useLayoutEffect(() => {
    const el = mainRef.current
    if (!el) return
    if (navType === 'PUSH') { el.scrollTop = 0; return }
    // Страница сразу после «Назад» заменила адрес (дописала параметр) —
    // восстановление продолжаем, иначе оно оборвалось бы на полпути.
    const continuing = navType === 'REPLACE' && restoring && Date.now() < restoring.until
    if (navType !== 'POP' && !continuing) return
    const target = continuing ? restoring!.target : (mem.scroll[location.key] ?? 0)
    const mark = continuing ? restoring!.mark : mem.mark[location.key]
    restoring = { until: Date.now() + 1500, target, mark }
    let done = false
    const started = Date.now()
    // Данные могут прийти не сразу — ждём, пока страница дорастёт до нужной
    // высоты. Таймер, а не requestAnimationFrame: тот замирает, пока вкладка
    // не на экране, и место тогда не восстанавливалось бы.
    let timer: number | undefined
    const tryRestore = () => {
      if (done) return
      const enough = el.scrollHeight - el.clientHeight >= target - 2
      if (enough || Date.now() - started > 2500) {
        el.scrollTop = target
        done = true
        restoring = null
        if (mark) highlight(el, mark)
        return
      }
      timer = window.setTimeout(tryRestore, 30)
    }
    tryRestore()
    return () => { done = true; window.clearTimeout(timer) }
  }, [location.key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const onScroll = () => { mem.scroll[keyRef.current] = el.scrollTop; persist() }
    // Нажатие внутри страницы: запоминаем строку и заголовок — перед уходом.
    const onClick = (e: Event) => {
      const t = e.target as Element | null
      if (!t) return
      const m = markOf(t)
      if (m) mem.mark[keyRef.current] = m
      const title = currentTitle(el)
      const page = mem.pages[keyRef.current]
      if (page && title) page.title = title
      persist()
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('click', onClick, true)
    return () => { el.removeEventListener('scroll', onScroll); el.removeEventListener('click', onClick, true) }
  }, [mainRef])

  return navType
}

/** «Вы были здесь»: строка, из которой ушли, на секунду подсвечивается. */
function highlight(root: HTMLElement, mark: Mark) {
  const started = Date.now()
  const find = () => {
    const rows = Array.from(root.querySelectorAll(mark.tag)) as HTMLElement[]
    const hit = rows.find(r => (r.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80) === mark.text)
    if (hit) {
      const box = hit.getBoundingClientRect()
      const view = root.getBoundingClientRect()
      if (box.top < view.top || box.bottom > view.bottom) hit.scrollIntoView({ block: 'nearest' })
      hit.classList.remove('nav-was-here')
      void hit.offsetWidth
      hit.classList.add('nav-was-here')
      window.setTimeout(() => hit.classList.remove('nav-was-here'), 1600)
      return
    }
    if (Date.now() - started < 1500) window.setTimeout(find, 120)
  }
  find()
}

/** Куда ведёт стрелка «‹»: на шаг назад внутри CRM (подпись — откуда пришли)
 *  или, если назад некуда, в родительский раздел. */
export function useBackTarget(fallback: string, fallbackLabel: string) {
  const navigate = useNavigate()
  const location = useLocation()
  const idx = historyIdx()
  const prevKey = idx > 0 ? mem.stack[idx - 1] : undefined
  const prev = prevKey ? mem.pages[prevKey] : undefined
  // Предыдущий шаг — та же страница (например, окно поверх) — смотрим глубже.
  const usable = prev && prev.path.split('?')[0] !== location.pathname ? prev : undefined
  const label = usable
    ? (ROUTE_LABEL[usable.path.split('?')[0]] || usable.title || fallbackLabel)
    : fallbackLabel
  const go = (e?: MouseEvent) => {
    e?.preventDefault()
    if (usable) navigate(-1)
    else navigate(fallback, { replace: true })
  }
  return { label, go, href: usable ? usable.path : fallback, viaHistory: !!usable }
}

/** Стрелка «‹ Откуда пришли». children — иконка/обёртка подписи. */
export function BackLink({ fallback, fallbackLabel, className, icon, children }: {
  fallback: string
  fallbackLabel: string
  className?: string
  icon?: ReactNode
  /** Своя разметка подписи; по умолчанию — просто текст. */
  children?: (label: string) => ReactNode
}) {
  const { label, go, href } = useBackTarget(fallback, fallbackLabel)
  return (
    <Link to={href} onClick={go} className={className} aria-label={`Назад: ${label}`}>
      {icon}{children ? children(label) : label}
    </Link>
  )
}

// ── Окна и шторки как шаг истории ─────────────────────────────────────
// Открыли окно — в истории новый шаг (тот же адрес, в state — что открыто).
// «Назад» — шаг снимается, окно закрывается. Закрыли крестиком — снимаем шаг
// сами. Ушли из окна на другую страницу — шаг остаётся, и при возврате окно
// снова открыто. Пока идёт наше собственное снятие шагов, окна не открываем.
let pendingCloses = 0
// Каждое событие «Назад»/«Вперёд» — свой номер. По ключу шага различать
// нельзя: у первой страницы после входа ключ всегда один и тот же ('default'),
// и своё закрытие окна на ней не распознавалось бы.
let popSeq = 0
if (typeof window !== 'undefined') window.addEventListener('popstate', () => { popSeq++ })
let lastPopSeq = 0
let skipSeq = -1
// Закрыли сразу несколько окон (день и задачу поверх) — снимаем их шаги одним
// прыжком: два «Назад» в одно мгновение браузер может склеить в один.
let backSteps = 0
let backScheduled = false
// Адрес на момент закрытия окна: если пока окно было открыто, сменили месяц
// или фильтр (адрес заменён), после снятия шага возвращаем свежий адрес —
// иначе он откатился бы к тому, что был под окном.
let urlAfterBack: string | null = null
function scheduleBack(go: (delta: number) => void) {
  backSteps++
  if (backScheduled) return
  backScheduled = true
  urlAfterBack = window.location.pathname + window.location.search + window.location.hash
  queueMicrotask(() => {
    const n = backSteps
    backSteps = 0
    backScheduled = false
    pendingCloses++ // прыжок на n шагов — одно событие «Назад»
    window.setTimeout(() => { pendingCloses = 0 }, 1500) // страховка, если «Назад» не дошёл
    go(-n)
  })
}

/** value — что открыто (строка: день, id задачи, '1'); null — закрыто.
 *  apply — открыть/закрыть окно по истории. */
export function useHistoryOverlay(id: string, value: string | null, apply: (v: string | null) => void) {
  const navigate = useNavigate()
  const location = useLocation()
  const navType = useNavigationType()
  const st: any = location.state || {}
  const inState: string | null = st.__ov && typeof st.__ov[id] === 'string' ? st.__ov[id] : null
  const applyRef = useRef(apply)
  applyRef.current = apply
  const expected = useRef<string | null | undefined>(undefined)
  const mounted = useRef(false)
  const here = location.pathname + location.search + location.hash

  // История → окно.
  useEffect(() => {
    if (navType === 'POP') {
      if (lastPopSeq !== popSeq) {
        lastPopSeq = popSeq
        if (pendingCloses > 0) {
          pendingCloses--
          skipSeq = popSeq
          // Своё закрытие окна: вернуть свежий адрес той же страницы.
          const fresh = urlAfterBack
          urlAfterBack = null
          if (fresh && fresh !== here && fresh.split(/[?#]/)[0] === location.pathname) {
            navigate(fresh, { replace: true, state: location.state })
          }
        }
      }
      if (skipSeq === popSeq) {
        // Своё снятие шагов: только закрываем, не открываем заново.
        if (inState === null && value !== null) { expected.current = null; applyRef.current(null) }
        return
      }
      if (inState !== value) { expected.current = inState; applyRef.current(inState) }
      return
    }
    // Адрес заменили (месяц, фильтр) при открытом окне — вернуть отметку окна.
    if (navType === 'REPLACE' && value !== null && inState !== value) {
      navigate(here, { replace: true, state: { ...st, __ov: { ...(st.__ov || {}), [id]: value } } })
    }
  }, [location.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Окно → история.
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    if (value === expected.current) { expected.current = undefined; return }
    expected.current = undefined
    if (value === inState) return
    const ov = { ...(st.__ov || {}) }
    if (value !== null) {
      ov[id] = value
      // Открыли — новый шаг; переключили (другой день) — заменяем.
      navigate(here, { replace: inState !== null, state: { ...st, __ov: ov } })
    } else {
      // Закрыли крестиком — снимаем свой шаг.
      scheduleBack(delta => navigate(delta))
    }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
}

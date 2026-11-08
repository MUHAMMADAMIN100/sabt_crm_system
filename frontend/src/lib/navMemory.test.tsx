import { useRef, useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserRouter, Link, Outlet, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'

// Модуль держит память в module scope — каждый тест берёт свежую копию.
let nav: typeof import('./navMemory')

beforeEach(async () => {
  vi.resetModules()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  nav = await import('./navMemory')
})

function Shell() {
  const ref = useRef<HTMLElement>(null)
  nav.useScrollMemory(ref)
  const loc = useLocation()
  return <main ref={ref}><span data-testid="path">{loc.pathname}</span><Outlet /></main>
}

function DayPage() {
  const [day, setDay] = useState<string | null>(null)
  nav.useHistoryOverlay('day', day, setDay)
  return (
    <div>
      <h1>Панель дня</h1>
      <button onClick={() => setDay('2026-11-09')}>открыть день</button>
      <Link to="/project">в проект</Link>
      {day && (
        <div role="dialog">
          окно {day}
          <button onClick={() => setDay('2026-11-10')}>другой день</button>
          <button onClick={() => setDay(null)}>закрыть</button>
          <Link to="/project">проект из окна</Link>
        </div>
      )}
    </div>
  )
}

function NestedPage() {
  const [day, setDay] = useState<string | null>(null)
  const [task, setTask] = useState<string | null>(null)
  const [, setParams] = useSearchParams()
  nav.useHistoryOverlay('day', day, v => { setDay(v); if (!v) setTask(null) })
  nav.useHistoryOverlay('task', task, setTask)
  return (
    <div>
      <button onClick={() => setDay('d1')}>день</button>
      {day && <div role="dialog" aria-label="day">день {day}
        <button onClick={() => setTask('t1')}>задача</button>
        <button onClick={() => { setDay(null); setTask(null) }}>закрыть всё</button>
        <button onClick={() => setParams({ ym: '2026-12' }, { replace: true })}>декабрь</button>
      </div>}
      {task && <div role="dialog" aria-label="task">задача {task}</div>}
    </div>
  )
}

function ProjectPage() {
  return <div><h1>Payk</h1><nav.BackLink fallback="/projects" fallbackLabel="Проекты" /></div>
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<DayPage />} />
          <Route path="/project" element={<ProjectPage />} />
          <Route path="/projects" element={<h1>Список проектов</h1>} />
          <Route path="/nested" element={<NestedPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

const back = async () => { await act(async () => { window.history.back(); await new Promise(r => setTimeout(r, 30)) }) }

describe('«Назад» — ровно на шаг', () => {
  it('«Назад» закрывает окно, а не уводит со страницы', async () => {
    render(<App />)
    fireEvent.click(screen.getByText('открыть день'))
    expect(screen.getByRole('dialog')).toHaveTextContent('2026-11-09')
    await waitFor(() => expect((window.history.state as any)?.usr?.__ov?.day).toBe('2026-11-09'))
    await back()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByTestId('path')).toHaveTextContent('/')
  })

  it('другой день в открытом окне — замена шага, крестик снимает шаг', async () => {
    render(<App />)
    const idx0 = (window.history.state as any)?.idx ?? 0
    fireEvent.click(screen.getByText('открыть день'))
    await waitFor(() => expect((window.history.state as any)?.usr?.__ov?.day).toBe('2026-11-09'))
    const idx1 = (window.history.state as any).idx
    expect(idx1).toBe(idx0 + 1)
    fireEvent.click(screen.getByText('другой день'))
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('2026-11-10'))
    await waitFor(() => expect((window.history.state as any)?.usr?.__ov?.day).toBe('2026-11-10'))
    expect((window.history.state as any).idx).toBe(idx1)
    fireEvent.click(screen.getByText('закрыть'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Шаг снят: состояние истории без отметки окна.
    await waitFor(() => expect((window.history.state as any)?.usr?.__ov?.day).toBeUndefined())
  })

  it('ушли из окна дальше — при возврате окно снова открыто', async () => {
    render(<App />)
    fireEvent.click(screen.getByText('открыть день'))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.click(screen.getByText('проект из окна'))
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/project'))
    await back()
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('2026-11-09'))
    await back()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('стрелка подписана местом, откуда пришли, и ведёт туда', async () => {
    render(<App />)
    fireEvent.click(screen.getByText('в проект'))
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/project'))
    const arrow = screen.getByRole('link', { name: /Назад/ })
    // «/» — это «Панель» (у неё нет понятного заголовка на странице).
    expect(arrow).toHaveTextContent('Панель')
    fireEvent.click(arrow)
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/))
  })

  it('пришли не из CRM — стрелка ведёт в родительский раздел', async () => {
    window.history.replaceState(null, '', '/project')
    render(<App />)
    const arrow = screen.getByRole('link', { name: /Назад/ })
    expect(arrow).toHaveTextContent('Проекты')
    fireEvent.click(arrow)
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/projects'))
  })

  it('закрыли окно дня вместе с задачей поверх — оба шага сняты, ничего не открывается заново', async () => {
    window.history.replaceState(null, '', '/nested')
    render(<App />)
    const idx0 = (window.history.state as any)?.idx ?? 0
    fireEvent.click(screen.getByText('день'))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'day' })).toBeTruthy())
    fireEvent.click(screen.getByText('задача'))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'task' })).toBeTruthy())
    fireEvent.click(screen.getByText('закрыть всё'))
    await act(async () => { await new Promise(r => setTimeout(r, 120)) })
    expect(screen.queryByRole('dialog', { name: 'day' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'task' })).toBeNull()
    await waitFor(() => expect((window.history.state as any)?.idx).toBe(idx0))
  })

  it('смена месяца в адресе при открытом окне не закрывает его', async () => {
    window.history.replaceState(null, '', '/nested')
    render(<App />)
    fireEvent.click(screen.getByText('день'))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'day' })).toBeTruthy())
    fireEvent.click(screen.getByText('декабрь'))
    await waitFor(() => expect(window.location.search).toBe('?ym=2026-12'))
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    expect(screen.getByRole('dialog', { name: 'day' })).toBeTruthy()
    expect((window.history.state as any)?.usr?.__ov?.day).toBe('d1')
    await back()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'day' })).toBeNull())
  })
})

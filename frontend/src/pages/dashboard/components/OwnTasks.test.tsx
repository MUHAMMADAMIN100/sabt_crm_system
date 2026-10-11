import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OwnDayTasks, splitTime, useOwnTasks } from './OwnTasks'

// Скорость добавления своей задачи (замечание владельца 11.10.2026): строка
// должна появляться сразу, список после успеха не перезапрашивается, а
// действия с только что добавленной строкой не ждут ответа сервера.

const mocks = vi.hoisted(() => ({
  own: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/services/api.service', () => ({
  tasksApi: { own: mocks.own, create: mocks.create, update: mocks.update, remove: mocks.remove },
}))
vi.mock('react-hot-toast', () => {
  const toast: any = vi.fn()
  toast.error = vi.fn()
  toast.dismiss = vi.fn()
  return { default: toast }
})

const TODAY = '2026-10-11'

function Harness() {
  const own = useOwnTasks(TODAY)
  return <OwnDayTasks dayKey={TODAY} todayKey={TODAY} own={own} />
}
function renderHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>)
}
/** Обещание, которое разрешаем вручную, — «сервер ещё думает». */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

describe('свои задачи — мгновенный отклик', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(m => m.mockReset())
    mocks.own.mockResolvedValue([])
    mocks.update.mockResolvedValue({})
    mocks.remove.mockResolvedValue({})
  })

  it('строка появляется сразу, а список после сохранения не перезапрашивается', async () => {
    const server = deferred<any>()
    mocks.create.mockReturnValue(server.promise)
    renderHarness()
    await waitFor(() => expect(mocks.own).toHaveBeenCalledTimes(1))

    await userEvent.type(screen.getByLabelText('Новая своя задача'), 'Забрать штатив{Enter}')
    // сервер ещё не ответил — строка уже на экране
    expect(screen.getByText('Забрать штатив')).toBeInTheDocument()
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Забрать штатив', scope: 'personal' }))

    await act(async () => { server.resolve({ id: 'real-1', title: 'Забрать штатив', status: 'new', deadline: `${TODAY}T07:00:00.000Z` }) })
    expect(screen.getByText('Забрать штатив')).toBeInTheDocument()
    expect(mocks.own).toHaveBeenCalledTimes(1)
  })

  it('отметка только что добавленной задачи дожидается настоящего id', async () => {
    const server = deferred<any>()
    mocks.create.mockReturnValue(server.promise)
    renderHarness()
    await waitFor(() => expect(mocks.own).toHaveBeenCalledTimes(1))

    await userEvent.type(screen.getByLabelText('Новая своя задача'), 'Позвонить клиенту{Enter}')
    await userEvent.click(screen.getByTitle('Отметить готовой'))
    // галочка стоит сразу, запрос на сервер ещё не ушёл: id пока временный
    expect(screen.getByTitle('Снять отметку')).toBeInTheDocument()
    expect(mocks.update).not.toHaveBeenCalled()

    await act(async () => { server.resolve({ id: 'real-2', title: 'Позвонить клиенту', status: 'new', deadline: `${TODAY}T07:00:00.000Z` }) })
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('real-2', { status: 'done' }))
    expect(screen.getByTitle('Снять отметку')).toBeInTheDocument()
  })

  it('при ошибке сервера строка убирается', async () => {
    mocks.create.mockRejectedValue(new Error('нет сети'))
    renderHarness()
    await waitFor(() => expect(mocks.own).toHaveBeenCalledTimes(1))

    await userEvent.type(screen.getByLabelText('Новая своя задача'), 'Не сохранится{Enter}')
    await waitFor(() => expect(screen.queryByText('Не сохранится')).not.toBeInTheDocument())
  })
})

describe('splitTime — время прямо в строке', () => {
  it('вынимает время и оставляет название', () => {
    expect(splitTime('18:00 отправить отчёт')).toEqual({ title: 'отправить отчёт', time: '18:00' })
    expect(splitTime('позвонить в 9:30 клиенту')).toEqual({ title: 'позвонить клиенту', time: '09:30' })
  })
  it('не путает дату и время и не принимает одно время за задачу', () => {
    expect(splitTime('сдать 15.10 отчёт')).toEqual({ title: 'сдать 15.10 отчёт', time: null })
    expect(splitTime('18:00')).toEqual({ title: '18:00', time: null })
  })
})

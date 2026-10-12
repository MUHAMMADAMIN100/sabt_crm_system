import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TransportCard from './TransportCard'

// «Транспорт по работе» — одна строка над панелью (решение владельца
// 12.10.2026: большая карточка занимала слишком много места). Проверяем, что
// из строки по-прежнему доступно всё: подать заявку, увидеть, сколько ждёт
// оплаты, и открыть свои заявки.

const mocks = vi.hoisted(() => ({
  my: vi.fn(),
  projects: vi.fn(),
  create: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock('@/services/api.service', () => ({
  transportApi: { my: mocks.my, projects: mocks.projects, create: mocks.create, cancel: mocks.cancel },
}))
vi.mock('react-hot-toast', () => {
  const toast: any = vi.fn()
  toast.error = vi.fn()
  toast.success = vi.fn()
  return { default: toast }
})

const item = (id: string, amount: number) => ({
  id, projectName: 'US2TJK', amount, date: '2026-10-10', note: null,
  receiptUrl: null, status: 'pending' as const, rejectReason: null, decidedAt: null,
})

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><TransportCard /></QueryClientProvider>)
}

describe('строка «Транспорт по работе»', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(m => m.mockReset())
    mocks.projects.mockResolvedValue([])
  })

  it('не показывается тем, кому заявки не положены', async () => {
    mocks.my.mockResolvedValue({ canRequest: false, pendingSum: 0, pendingCount: 0, paidMonthSum: 0, items: [] })
    const { container } = renderCard()
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('без заявок — только «Подать заявку», она открывает форму', async () => {
    mocks.my.mockResolvedValue({ canRequest: true, pendingSum: 0, pendingCount: 0, paidMonthSum: 0, items: [] })
    renderCard()
    await waitFor(() => expect(mocks.my).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Мои заявки' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Подать заявку' }))
    expect(await screen.findByText('Заявка на транспорт')).toBeInTheDocument()
  })

  it('есть неоплаченные — в строке видно сколько, нажатие открывает «Мои заявки»', async () => {
    mocks.my.mockResolvedValue({
      canRequest: true, pendingSum: 80, pendingCount: 2, paidMonthSum: 0,
      items: [item('a', 30), item('b', 50)],
    })
    renderCard()

    const status = await screen.findByRole('button', { name: '2 заявки ждут оплаты · 80 сомони' })
    expect(screen.getByRole('button', { name: 'Мои заявки' })).toBeInTheDocument()

    await userEvent.click(status)
    expect(await screen.findByText('Мои заявки на транспорт')).toBeInTheDocument()
  })
})

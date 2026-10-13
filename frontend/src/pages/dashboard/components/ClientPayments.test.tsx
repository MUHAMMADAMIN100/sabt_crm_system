import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ClientPayments, { payStateText } from './ClientPayments'

// «Оплаты клиентов» на панели менеджера по продажам (решение владельца
// 12.10.2026): по каким SMM-проектам и когда клиент должен заплатить —
// только свои проекты, без сумм; сроки приходят из «Финансов».

const mocks = vi.hoisted(() => ({ mine: vi.fn() }))
vi.mock('@/services/api.service', () => ({ smmPaymentsApi: { mine: mocks.mine } }))

const TODAY = '2026-10-12'
const item = (over: Record<string, unknown>) => ({
  key: 'k', projectId: 'p', projectName: 'Проект', date: TODAY, dueDate: TODAY,
  partNo: 1, state: 'wait', paidAt: null, ...over,
})

function renderBlock() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><ClientPayments /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('блок «Оплаты клиентов»', () => {
  beforeEach(() => mocks.mine.mockReset())

  it('у менеджера без своих SMM-проектов блока нет', async () => {
    mocks.mine.mockResolvedValue({ today: TODAY, projects: 0, items: [], unlinked: [] })
    const { container } = renderBlock()
    await waitFor(() => expect(mocks.mine).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('показывает проект, день и состояние и ведёт в карточку проекта', async () => {
    mocks.mine.mockResolvedValue({
      today: TODAY, projects: 4, unlinked: [],
      items: [
        item({ key: 'a', projectId: 'p1', projectName: 'Остиум', date: '2026-10-09', dueDate: '2026-10-09', partNo: 2, state: 'late' }),
        item({ key: 'b', projectId: 'p2', projectName: 'US2TJK', state: 'today' }),
        item({ key: 'c', projectId: 'p3', projectName: 'Paradise Hall', date: '2026-10-14', dueDate: '2026-10-14' }),
        item({ key: 'd', projectId: 'p4', projectName: 'Asan', date: '2026-10-10', dueDate: '2026-10-10', state: 'paid', paidAt: '2026-10-10' }),
      ],
    })
    renderBlock()

    expect(await screen.findByText('Остиум')).toBeInTheDocument()
    expect(screen.getByText('мои SMM-проекты · 4')).toBeInTheDocument()
    expect(screen.getByText('просрочено 3 дня')).toBeInTheDocument()
    expect(screen.getByText('2-я часть')).toBeInTheDocument()
    expect(screen.getByText('сегодня')).toBeInTheDocument()
    expect(screen.getByText('через 2 дня')).toBeInTheDocument()
    expect(screen.getByText('оплачено 10 октября')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Остиум/ })).toHaveAttribute('href', '/smm/projects/p1')
  })

  it('проекты, которых нет в «Финансах», названы отдельной строкой', async () => {
    mocks.mine.mockResolvedValue({
      today: TODAY, projects: 2, items: [],
      unlinked: [{ projectId: 'p8', projectName: 'Афсона' }, { projectId: 'p9', projectName: 'Grant China' }],
    })
    renderBlock()
    expect(await screen.findByText('Ближайших оплат нет')).toBeInTheDocument()
    expect(screen.getByText('Срок оплаты не найден в «Финансах»: Афсона, Grant China')).toBeInTheDocument()
  })
})

describe('payStateText — состояние словами', () => {
  const at = (state: string, date: string, paidAt: string | null = null) =>
    payStateText({ state: state as any, date, paidAt }, TODAY)

  it('просрочка и ожидание склоняются по числу дней', () => {
    expect(at('late', '2026-10-11')).toBe('просрочено 1 день')
    expect(at('late', '2026-10-08')).toBe('просрочено 4 дня')
    expect(at('late', '2026-09-30')).toBe('просрочено 12 дней')
    expect(at('wait', '2026-10-13')).toBe('завтра')
    expect(at('wait', '2026-10-17')).toBe('через 5 дней')
    expect(at('wait', '2026-11-02')).toBe('через 21 день')
  })

  it('оплаченное называет день получения, а не срок', () => {
    expect(at('paid', '2026-10-14', '2026-10-10')).toBe('оплачено 10 октября')
  })
})

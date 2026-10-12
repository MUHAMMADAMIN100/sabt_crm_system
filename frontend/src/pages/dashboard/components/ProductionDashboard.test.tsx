import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { format } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProductionDashboard from './ProductionDashboard'

// Кабинет видеографа / монтажёра / дизайнера: день открывается модальным
// окном на любом экране, как у СММ-специалиста (решение владельца
// 12.10.2026). Раньше на компьютере окна не было — задачи дня стояли списком
// под календарём, и нажатие на день «ничего не открывало».

const mocks = vi.hoisted(() => ({
  myWork: vi.fn(),
  shootAssignees: vi.fn(),
  own: vi.fn(),
}))

vi.mock('@/services/api.service', () => ({
  contentPlanApi: {
    myWork: mocks.myWork, shootAssignees: mocks.shootAssignees,
    myWorkUpdate: vi.fn(), setDefaultVideographer: vi.fn(), reassignShoot: vi.fn(),
  },
  tasksApi: { own: mocks.own, create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  projectsApi: {},
  storiesApi: {},
}))
vi.mock('react-hot-toast', () => {
  const toast: any = vi.fn()
  toast.error = vi.fn()
  toast.success = vi.fn()
  toast.dismiss = vi.fn()
  return { default: toast }
})

const TODAY = format(new Date(), 'yyyy-MM-dd')
const shoot = {
  id: 'i1', projectId: 'p1', projectName: 'US2TJK', stage: 'shoot', topic: null,
  status: 'planned', date: TODAY, time: null, durationMin: null, contentType: null,
  parentId: 'r1', parentTopic: 'Рилс про доставку', parentType: 'reel', parentDate: null, scriptText: null,
}

function renderCabinet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><ProductionDashboard /></QueryClientProvider>)
}
const todayCell = () => document.querySelector(`[data-own-cell="${TODAY}"]`) as HTMLElement

describe('кабинет производства — окно дня', () => {
  beforeEach(() => {
    Object.values(mocks).forEach(m => m.mockReset())
    mocks.myWork.mockResolvedValue({ items: [shoot] })
    mocks.shootAssignees.mockResolvedValue({ candidates: [], defaultId: null })
    mocks.own.mockResolvedValue([])
  })

  it('пока день не открыт, окна нет и строк задач под календарём тоже', async () => {
    renderCabinet()
    // задача видна названием в клетке календаря
    await waitFor(() => expect(within(todayCell()).getByText('Рилс про доставку')).toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Новая своя задача')).not.toBeInTheDocument()
  })

  it('нажатие на день открывает окно с задачами этого дня, крестик закрывает', async () => {
    renderCabinet()
    await waitFor(() => expect(within(todayCell()).getByText('Рилс про доставку')).toBeInTheDocument())

    await userEvent.click(todayCell())
    const dialog = screen.getByRole('dialog', { name: 'Задачи дня' })
    expect(within(dialog).getByText('Сегодня')).toBeInTheDocument()
    expect(within(dialog).getByText('Рилс про доставку')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Новая своя задача')).toBeInTheDocument()

    await userEvent.click(within(dialog).getByTitle('Закрыть'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

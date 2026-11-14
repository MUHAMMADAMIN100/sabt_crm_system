import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { igDone, pubDone, tiktokPending } from './tiktok'
import { TaskPanel, TaskRow } from '@/pages/dashboard/components/SmmSpecialistDashboard'

vi.mock('@/services/api.service', () => ({
  contentPlanApi: { itemHistory: vi.fn(async () => []) },
  projectsApi: {}, storiesApi: {},
}))

const pub = (over: any = {}) => ({
  id: 'item:r1', itemId: 'r1', kind: 'publication', contentType: 'reel', topic: 'Кредит за 15 минут',
  projectId: 'p', projectName: 'Комерцбанк', date: '2026-11-20', status: 'planned', tiktok: true, tiktokAt: null, ...over,
})

describe('TikTok: правило «сделано» (вариант А, 14.11.2026)', () => {
  it('сделано — когда вышло в Instagram и, если нужен, в TikTok', () => {
    expect(pubDone(pub({ status: 'published' }))).toBe(false)
    expect(tiktokPending(pub({ status: 'published' }))).toBe(true)
    expect(pubDone(pub({ status: 'published', tiktokAt: '2026-11-20' }))).toBe(true)
    expect(pubDone(pub({ status: 'published', tiktok: false }))).toBe(true)
    expect(pubDone({ kind: 'shoot', status: 'published' })).toBe(true)
    expect(igDone(pub({ tiktokAt: '2026-11-20' }))).toBe(false)
  })
})

describe('строка задачи: две отметки', () => {
  it('вместо галочки — Instagram и TikTok; вышло в Instagram — «ждём TikTok»', () => {
    const onToggle = vi.fn(), onToggleTiktok = vi.fn(), onInfo = vi.fn()
    render(<TaskRow e={pub({ status: 'published' })} onToggle={onToggle} onToggleTiktok={onToggleTiktok} onInfo={onInfo} />)
    expect(screen.queryByTitle('Отметить готовой')).not.toBeInTheDocument()
    const ig = screen.getByRole('button', { name: 'Instagram: выложено, снять отметку' })
    const tt = screen.getByRole('button', { name: 'Отметить: выложено в TikTok' })
    expect(ig).toHaveAttribute('aria-pressed', 'true')
    expect(tt).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('ждём TikTok')).toBeInTheDocument()
    // Не сделано целиком — название не зачёркнуто.
    expect(screen.getByText('Кредит за 15 минут')).not.toHaveClass('line-through')

    fireEvent.click(tt)
    expect(onToggleTiktok).toHaveBeenCalledTimes(1)
    expect(onToggle).not.toHaveBeenCalled()
    expect(onInfo).not.toHaveBeenCalled()
    fireEvent.click(ig)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('обе площадки — строка сделана; без TikTok — прежняя одна галочка', () => {
    const { unmount } = render(<TaskRow e={pub({ status: 'published', tiktokAt: '2026-11-20' })} onToggle={vi.fn()} onToggleTiktok={vi.fn()} onInfo={vi.fn()} />)
    expect(screen.getByText('Кредит за 15 минут')).toHaveClass('line-through')
    expect(screen.queryByText('ждём TikTok')).not.toBeInTheDocument()
    unmount()
    render(<TaskRow e={pub({ tiktok: false })} onToggle={vi.fn()} onToggleTiktok={vi.fn()} onInfo={vi.fn()} />)
    expect(screen.getByTitle('Отметить готовой')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /TikTok/ })).not.toBeInTheDocument()
  })
})

describe('окно задачи: две кнопки', () => {
  it('«Instagram ✓» снимает Instagram, «Выложено в TikTok» ставит TikTok', () => {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    })) as any
    const onToggle = vi.fn(), onToggleTiktok = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TaskPanel e={pub({ status: 'published' })} pos={1} total={1} onPrev={vi.fn()} onNext={vi.fn()} onClose={vi.fn()}
            onToggle={onToggle} onToggleTiktok={onToggleTiktok} onMove={vi.fn()} onCancel={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.queryByRole('button', { name: /Отметить готовым/ })).not.toBeInTheDocument()
    const ig = screen.getByTitle('Выложено в Instagram — нажмите, чтобы снять отметку')
    const tt = screen.getByTitle('Отметить: выложено в TikTok')
    expect(ig).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(tt)
    expect(onToggleTiktok).toHaveBeenCalledTimes(1)
    fireEvent.click(ig)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})

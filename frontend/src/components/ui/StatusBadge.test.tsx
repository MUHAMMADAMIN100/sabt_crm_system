import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { StatusBadge, PriorityBadge, Avatar } from './index'

describe('StatusBadge', () => {
  it('renders Russian label for known status', () => {
    render(<StatusBadge status="new" />)
    expect(screen.getByText('Новая')).toBeInTheDocument()
  })

  it('renders Russian label for in_progress status', () => {
    render(<StatusBadge status="in_progress" />)
    expect(screen.getByText('В работе')).toBeInTheDocument()
  })

  it('renders Russian label for done status', () => {
    render(<StatusBadge status="done" />)
    expect(screen.getByText('Готово')).toBeInTheDocument()
  })

  it('normalizes an unknown/legacy status to «В работе» instead of showing it raw', () => {
    // 4-статусная модель: любое неизвестное значение (в т.ч. старые review /
    // on_rework / approved) нормализуется в 'in_progress', чтобы в интерфейсе
    // не всплывали технические строки из БД. См. normalizeTaskStatus().
    render(<StatusBadge status="unknown_status" />)
    expect(screen.getByText('В работе')).toBeInTheDocument()
    expect(screen.queryByText('unknown_status')).not.toBeInTheDocument()
  })

  it('normalizes legacy task statuses (review → В работе, published → Готово)', () => {
    const { rerender } = render(<StatusBadge status="review" />)
    expect(screen.getByText('В работе')).toBeInTheDocument()

    rerender(<StatusBadge status="published" />)
    expect(screen.getByText('Готово')).toBeInTheDocument()
  })

  it('renders project statuses correctly', () => {
    const { rerender } = render(<StatusBadge status="planning" />)
    expect(screen.getByText('Планируется')).toBeInTheDocument()

    rerender(<StatusBadge status="completed" />)
    expect(screen.getByText('Завершён')).toBeInTheDocument()
  })
})

describe('PriorityBadge', () => {
  it('renders Russian label for low priority', () => {
    render(<PriorityBadge priority="low" />)
    expect(screen.getByText('Низкий')).toBeInTheDocument()
  })

  it('renders Russian label for critical priority', () => {
    render(<PriorityBadge priority="critical" />)
    expect(screen.getByText('Критический')).toBeInTheDocument()
  })

  it('applies correct CSS class based on priority', () => {
    render(<PriorityBadge priority="high" />)
    const badge = screen.getByText('Высокий')
    expect(badge).toHaveClass('priority-high')
  })

  it('falls back to raw priority string for unknown value', () => {
    render(<PriorityBadge priority="extreme" />)
    expect(screen.getByText('extreme')).toBeInTheDocument()
  })
})

describe('Avatar', () => {
  it('renders initials from first letters of each word', () => {
    render(<Avatar name="Иван Петров" />)
    expect(screen.getByText('ИП')).toBeInTheDocument()
  })

  it('renders image when src is provided', () => {
    render(<Avatar name="Test User" src="https://example.com/avatar.jpg" />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'https://example.com/avatar.jpg')
    expect(img).toHaveAttribute('alt', 'Test User')
  })

  it('renders placeholder when name is undefined', () => {
    render(<Avatar />)
    expect(screen.getByText('?')).toBeInTheDocument()
  })

  it('opens fullscreen photo on click and closes on Escape', async () => {
    render(<Avatar name="Test User" src="https://example.com/avatar.jpg" />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('img'))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-label', 'Фото: Test User')
    // Имя подписано под фотографией — понятно, чьё это фото.
    expect(within(dialog).getByText('Test User')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('yields to a parent button instead of opening the photo', () => {
    // Аватарка внутри кнопки/ссылки не должна отнимать у неё клик:
    // иначе переход к сотруднику или загрузка фото перестают работать.
    const onParent = vi.fn()
    render(
      <button type="button" onClick={onParent}>
        <Avatar name="Test User" src="https://example.com/avatar.jpg" />
      </button>,
    )
    fireEvent.click(screen.getByRole('img'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onParent).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('img')).not.toHaveAttribute('tabindex')
  })

  it('does not open photo view for initials placeholder', () => {
    render(<Avatar name="Иван Петров" />)
    fireEvent.click(screen.getByText('ИП'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

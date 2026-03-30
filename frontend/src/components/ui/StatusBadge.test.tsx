import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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

  it('falls back to raw status string for unknown status', () => {
    render(<StatusBadge status="unknown_status" />)
    expect(screen.getByText('unknown_status')).toBeInTheDocument()
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
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import ClientAccountCard from './ClientAccountCard'
import { canSeeClientAccess } from '@/components/projects/ClientAccessCard'

const api = vi.hoisted(() => ({
  clientAccess: vi.fn(async () => ({ login: '@lola', hasPassword: true, note: '' })),
  clientAccessPassword: vi.fn(async () => ({ password: 's3cret' })),
  saveClientAccess: vi.fn(),
}))
vi.mock('@/services/api.service', () => ({ projectsApi: api }))

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ClientAccountCard projectId="p" pageUrl={null} canSeeAccess />
    </QueryClientProvider>,
  )
}

describe('«Аккаунт клиента»: пароль только по действию (14.11.2026)', () => {
  it('при открытии пароль не загружается, по «Показать» — загружается и виден', async () => {
    renderCard()
    expect(await screen.findByText('@lola')).toBeInTheDocument()
    expect(screen.getByText('••••••••')).toBeInTheDocument()
    expect(api.clientAccessPassword).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Показать пароль' }))
    expect(await screen.findByText('s3cret')).toBeInTheDocument()
    expect(api.clientAccessPassword).toHaveBeenCalledTimes(1)

    // Скрыть и показать снова — второй раз с сервера не грузим.
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть пароль' }))
    fireEvent.click(screen.getByRole('button', { name: 'Показать пароль' }))
    await waitFor(() => expect(screen.getByText('s3cret')).toBeInTheDocument())
    expect(api.clientAccessPassword).toHaveBeenCalledTimes(1)
  })
})

describe('кому виден блок доступов', () => {
  it('менеджер по продажам — только если он менеджер этого проекта', () => {
    const m = { id: 'm1', role: 'sales_manager_smm' }
    expect(canSeeClientAccess(m, { salesManagerId: 'm1' })).toBe(true)
    expect(canSeeClientAccess(m, { salesManagerId: 'm2' })).toBe(false)
    expect(canSeeClientAccess({ id: 'd1', role: 'sales_manager_dev' }, { salesManagerId: 'd1' })).toBe(true)
    expect(canSeeClientAccess({ id: 'x', role: 'smm_director' })).toBe(true)
    expect(canSeeClientAccess({ id: 's1', role: 'smm_specialist' }, { specialistIds: ['s1'] })).toBe(true)
  })
})

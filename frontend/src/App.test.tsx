import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'

vi.mock('./services/voucher.service', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('./services/voucher.service')>()
  return {
    ...original,
    getVoucherFilterOptions: vi.fn().mockResolvedValue({ categories: [], regions: [], partners: [] }),
    searchVouchers: vi
      .fn()
      .mockResolvedValue({ vouchers: [], pagination: { page: 1, limit: 1, total: 0, totalPages: 0 } })
  }
})

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  )
}

describe('App routing', () => {
  it('renders the public layout with primary navigation', () => {
    renderApp()

    const primaryNav = screen.getByRole('navigation', { name: /điều hướng chính/i })
    expect(
      within(primaryNav)
        .getByRole('link', { name: /Danh mục/ })
        .getAttribute('href')
    ).toBe('/search')
    expect(screen.getByRole('link', { name: /VoucherHub Tiết kiệm nhiều hơn mỗi ngày/ }).getAttribute('href')).toBe('/')
  })

  it('renders the home page at the index route', () => {
    renderApp()
    expect(screen.getByRole('heading', { name: /home/i })).toBeDefined()
  })

  it('shows login/sign up actions for unauthenticated visitors', () => {
    renderApp()
    expect(screen.getByRole('link', { name: 'Đăng nhập', exact: true })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Đăng ký', exact: true })).toBeDefined()
  })
})

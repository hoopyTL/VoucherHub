import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Header } from './Header'
import { AuthContext, type AuthContextValue, type AuthUser } from '../../store/AuthContext'

/**
 * Header navigation tests — focus on the auth-gating of role-specific links.
 *
 * Regression guard: the customer destinations (Cart / Orders) must
 * only appear once the session is confirmed authenticated. Even if a caller
 * provides stale user display data while `isAuthenticated` is false, the header
 * must not leak authenticated navigation links.
 */
function makeAuth(overrides: Partial<AuthContextValue>): AuthContextValue {
  return {
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: false,
    login: async () => ({ id: '', name: '', role: 'CUSTOMER' }),
    updateProfile: async () => ({
      id: '',
      email: null,
      phone: null,
      fullName: '',
      address: null,
      status: 'ACTIVE',
      role: { name: 'CUSTOMER' },
      createdAt: '',
      updatedAt: ''
    }),
    logout: () => {},
    ...overrides
  }
}

function renderHeader(auth: AuthContextValue) {
  // Keep a QueryClient wrapper because the application shell owns one globally.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter>
          <Header />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>
  )
}

const customer: AuthUser = { id: 'u1', name: 'Cust', role: 'CUSTOMER' }

describe('Header navigation', () => {
  it('shows Log in / Sign up and hides customer links for an unauthenticated visitor', () => {
    renderHeader(makeAuth({ isAuthenticated: false }))

    expect(screen.getByRole('link', { name: /VoucherHub Tiết kiệm nhiều hơn mỗi ngày/ }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: /Danh mục/ }).getAttribute('href')).toBe('/search')
    expect(screen.getByRole('link', { name: 'Đăng nhập', exact: true })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Đăng ký', exact: true })).toBeDefined()

    // Customer-only destinations must not be present.
    expect(screen.queryByRole('link', { name: 'Mở giỏ hàng' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Voucher của tôi' })).toBeNull()
  })

  it('does not leak customer links while a profile is present but the session is not yet authenticated', () => {
    // Mid-restore state: user populated from persisted profile, isAuthenticated false.
    renderHeader(makeAuth({ user: customer, isAuthenticated: false }))

    expect(screen.queryByRole('link', { name: 'Mở giỏ hàng' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Voucher của tôi' })).toBeNull()
  })

  it('shows customer links once authenticated', () => {
    renderHeader(makeAuth({ user: customer, token: 't', isAuthenticated: true }))

    expect(screen.getByRole('link', { name: 'Mở giỏ hàng' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Voucher của tôi' }).getAttribute('href')).toBe('/my-vouchers')
    expect(screen.queryByText('Orders')).toBeNull()
    expect(screen.queryByText('My Codes')).toBeNull()
    // No guest CTAs when signed in.
    expect(screen.queryByRole('link', { name: 'Đăng ký', exact: true })).toBeNull()
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { UserRole } from '@ui-contracts'
import { LoginPage } from './LoginPage'
import { AuthProvider } from '../../store/AuthContext'
import { api, getAccessToken, clearAccessToken } from '../../services/api'

/** Probe component that renders the current path so we can assert redirects. */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid='location'>{location.pathname}</div>
}

/**
 * Renders the LoginPage inside a router + auth provider. `initialEntry` lets a
 * test seed `location.state.from` to exercise the "return to attempted page"
 * behavior.
 */
function renderLogin(initialEntry: { pathname: string; state?: unknown } = { pathname: '/login' }) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path='/login' element={<LoginPage />} />
          <Route path='*' element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  )
}

/** Fills the credential fields with the given values. */
function fillCredentials(emailOrPhone: string, password: string) {
  fireEvent.change(screen.getByLabelText(/^Email hoặc số điện thoại/), {
    target: { value: emailOrPhone }
  })
  fireEvent.change(screen.getByLabelText(/^Mật khẩu/), {
    target: { value: password }
  })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }))
}

describe('LoginPage', () => {
  beforeEach(() => {
    localStorage.clear()
    clearAccessToken()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders email/phone and password fields plus a submit button', () => {
    renderLogin()
    expect(screen.getByLabelText(/^Email hoặc số điện thoại/)).toBeDefined()
    expect(screen.getByLabelText(/^Mật khẩu/)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeDefined()
  })

  it('authenticates, stores the token, and redirects by role', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: true, data: { token: 'jwt-token-123', user: { id: 'u1', role: UserRole.ADMIN } } }
    } as never)
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: { id: 'u1', fullName: 'Alice', role: { name: UserRole.ADMIN } } }
    } as never)

    renderLogin()

    fillCredentials('admin@example.com', 'password123')
    submit()

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/admin')
    })

    expect(postSpy).toHaveBeenCalledWith('/auth/login', {
      identifier: 'admin@example.com',
      password: 'password123'
    })
    // Access token is held in memory (httpOnly-cookie session model), not localStorage.
    expect(getAccessToken()).toBe('jwt-token-123')
  })

  it('redirects back to the attempted page when provided via location state', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: true, data: { token: 'jwt-token-123', user: { id: 'u2', role: UserRole.CUSTOMER } } }
    } as never)
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: { id: 'u2', fullName: 'Carol', role: { name: UserRole.CUSTOMER } } }
    } as never)

    renderLogin({ pathname: '/login', state: { from: { pathname: '/cart' } } })

    fillCredentials('carol@example.com', 'password123')
    submit()

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/cart')
    })
  })

  it('shows a generic error on invalid credentials without revealing the field', async () => {
    vi.spyOn(api, 'post').mockRejectedValue({
      response: {
        status: 401,
        data: {
          error: { code: 'UNAUTHORIZED', message: 'Invalid email/phone or password' }
        }
      }
    })

    renderLogin()

    fillCredentials('bad@example.com', 'wrongpass')
    submit()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/invalid email\/phone or password/i)
    // The message must not name a specific field as the culprit.
    expect(alert.textContent).not.toMatch(/password is incorrect/i)
    expect(alert.textContent).not.toMatch(/no account|user not found/i)
    // Stays on the login page (no redirect occurred).
    expect(screen.queryByTestId('location')).toBeNull()
  })

  it('surfaces a locked-account message returned by the backend', async () => {
    vi.spyOn(api, 'post').mockRejectedValue({
      response: {
        status: 401,
        data: { error: { code: 'UNAUTHORIZED', message: 'Your account is locked' } }
      }
    })

    renderLogin()

    fillCredentials('locked@example.com', 'password123')
    submit()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/account is locked/i)
  })

  it('validates required fields without calling the API', async () => {
    const postSpy = vi.spyOn(api, 'post')

    renderLogin()

    submit()

    expect(await screen.findByRole('alert')).toBeDefined()
    expect(postSpy).not.toHaveBeenCalled()
  })
})

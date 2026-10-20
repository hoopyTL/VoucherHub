import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyVoucher } from '../../types/customer'
import { api } from '../../services/api'
import { MyVouchersPage } from './MyVouchersPage'
import { AuthProvider } from '../../store/AuthContext'

vi.mock('../../services/api', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('../../services/api')>()
  return { ...original, api: { ...original.api, get: vi.fn() } }
})

const baseVoucher: MyVoucher = {
  id: 'code-1',
  code: '9015DF81E2F8',
  status: 'UNUSED',
  remainingUses: 2,
  totalUses: 3,
  issuedAt: '2026-08-24T10:00:00.000Z',
  expiresAt: '2026-09-30T10:00:00.000Z',
  lastUsedAt: null,
  lastUsedBranch: null,
  order: { id: 'order-1', createdAt: '2026-08-24T10:00:00.000Z' },
  voucher: {
    id: 'voucher-1',
    name: 'Buffet cuối tuần',
    description: 'Buffet',
    imageUrl: null,
    partnerName: 'Garden Restaurant'
  }
}

const usedVoucher: MyVoucher = {
  ...baseVoucher,
  id: 'code-2',
  code: 'USED00000001',
  status: 'USED',
  remainingUses: 0,
  totalUses: 1,
  lastUsedAt: '2026-08-23T12:42:00.000Z',
  lastUsedBranch: { id: 1, name: 'Chi nhánh Quận 1', address: '1 Nguyễn Huệ' },
  voucher: { ...baseVoucher.voucher, name: 'Massage thư giãn' }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthProvider>
          <MyVouchersPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('MyVouchersPage', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: [baseVoucher, usedVoucher] } } as never)
  })

  it('shows individual unused codes and opens their QR', async () => {
    renderPage()

    expect(await screen.findByText('Buffet cuối tuần')).toBeDefined()
    expect(screen.getByText('Mã: 9015DF81E2F8')).toBeDefined()
    expect(screen.queryByText('Massage thư giãn')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Hiển thị QR' }))
    expect(screen.getByRole('dialog', { name: 'Buffet cuối tuần' })).toBeDefined()
    expect(screen.getByTestId('qr-code-display').getAttribute('data-value')).toBe('9015DF81E2F8')
  })

  it('separates used codes and does not allow opening their QR', async () => {
    renderPage()
    await screen.findByText('Buffet cuối tuần')

    fireEvent.click(screen.getByRole('tab', { name: /Đã sử dụng/ }))

    expect(screen.getByText('Massage thư giãn')).toBeDefined()
    expect(screen.queryByText('Buffet cuối tuần')).toBeNull()
    expect(screen.getByRole('button', { name: 'Đã sử dụng' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Hiển thị QR' })).toBeNull()
  })
})

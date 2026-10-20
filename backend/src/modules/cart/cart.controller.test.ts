import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import cartRoutes from './cart.routes'
import * as cartService from './cart.service'

// Mock các methods của cart.service
vi.mock('./cart.service', () => ({
  getCart: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  removeItem: vi.fn()
}))

// Mock middleware auth
vi.mock('../../middlewares/authenticate', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { sub: 'test-user-id', role: 'CUSTOMER', ver: 0 }
    next()
  }
}))
vi.mock('../../middlewares/authorize', () => ({ authorize: () => (_req: any, _res: any, next: any) => next() }))

// Cần tạo express app để test bằng supertest
const app = express()
app.use(express.json())
app.use('/api/cart', cartRoutes)
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('Test error:', err)
  res.status(500).json({ error: err.stack || err.message })
})

describe('Cart Controller & Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/cart', () => {
    it('sẽ trả về thông tin giỏ hàng', async () => {
      const mockCart = {
        id: 'cart-1',
        customerId: 'test-user-id',
        items: [],
        subtotal: '0.00',
        updatedAt: '2026-01-01T00:00:00Z'
      }

      vi.mocked(cartService.getCart).mockResolvedValue(mockCart)

      const response = await request(app).get('/api/cart')

      expect(response.status).toBe(200)
      expect(response.body.data).toEqual(mockCart)
      expect(cartService.getCart).toHaveBeenCalledWith('test-user-id')
    })
  })

  describe('POST /api/cart/items', () => {
    it('gọi service để thêm item và trả về thành công', async () => {
      const mockCart = {
        id: 'cart-1',
        customerId: 'test-user-id',
        items: [
          {
            id: 1,
            voucherProductId: '123e4567-e89b-12d3-a456-426614174000',
            quantity: 1,
            salePrice: '100',
            voucherProductName: 'abc',
            imageUrl: null,
            itemTotal: '100'
          }
        ],
        subtotal: '100.00',
        updatedAt: '2026-01-01T00:00:00Z'
      }

      vi.mocked(cartService.addItem).mockResolvedValue(mockCart)

      const payload = { voucherProductId: '123e4567-e89b-12d3-a456-426614174000', quantity: 1 }

      const response = await request(app).post('/api/cart/items').send(payload)

      expect(response.status).toBe(200)
      expect(response.body.data).toEqual(mockCart)
      expect(cartService.addItem).toHaveBeenCalledWith('test-user-id', payload)
    })
  })
})

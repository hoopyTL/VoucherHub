import path from 'node:path'

import express from 'express'
import helmet from 'helmet'
import cors from 'cors'

import { env } from '~/configs/env'
import { notFoundHandler } from '~/middlewares/not-found'
import { errorHandler } from '~/middlewares/error-handler'
import { ApiResponse } from '~/utils/api-response'
import apiRouter from '~/modules'
import cartRoutes from '~/modules/cart/cart.routes'
import orderRoutes from '~/modules/order/order.routes'
import paymentRoutes from '~/modules/payment/payment.routes'
import adminRoutes from '~/routes/admin.routes'
import { authenticate } from '~/middlewares/authenticate'
import { authorize } from '~/middlewares/authorize'
import { RoleName } from '@voucher/shared'
import prisma from '~/configs/prisma'
import { requestLogger } from '~/middlewares/request-logger'

const app = express()
app.use(requestLogger)

// Security
app.use(helmet())

// Cors
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }))

// Body parsing
app.use('/api/orders/webhook/stripe', express.raw({ type: 'application/json' }))
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')))

// Routes
app.get('/health', (_req, res) => {
  ApiResponse.success(res, { status: 'ok' })
})

app.get('/ready', async (_req, res) => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Readiness timeout')), 1000)
      })
    ])
    ApiResponse.success(res, { status: 'ready' })
  } catch {
    res.status(503).json({ success: false, error: { code: 'NOT_READY', message: 'Service is not ready' } })
  } finally {
    clearTimeout(timeout)
  }
})

app.get('/', (_req, res) => {
  ApiResponse.success(res, { message: 'Welcome VoucherHub' })
})

// API routes
app.use('/api', apiRouter)
app.use('/api/cart', cartRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api/payments', paymentRoutes)
app.use('/api/admin', authenticate, authorize(RoleName.ADMIN), adminRoutes)

// Error handling must remain after all routes.
app.use(notFoundHandler)
app.use(errorHandler)

export default app

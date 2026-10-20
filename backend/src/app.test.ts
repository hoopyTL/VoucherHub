import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '~/app'
import prisma from '~/configs/prisma'
import { vi } from 'vitest'

describe('GET /health', () => {
  it('returns 200 with success shape', async () => {
    const res = await request(app).get('/health')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      success: true,
      data: { status: 'ok' }
    })
  })
})

describe('GET /ready', () => {
  it('reports ready only after the real test database answers', async () => {
    const res = await request(app).get('/ready')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, data: { status: 'ready' } })
    expect(res.headers['x-request-id']).toBeTruthy()
  })

  it('fails readiness without exposing database errors while liveness stays up', async () => {
    const query = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('private-database-password'))
    try {
      const res = await request(app).get('/ready')
      expect(res.status).toBe(503)
      expect(res.body.error.code).toBe('NOT_READY')
      expect(JSON.stringify(res.body)).not.toContain('private-database-password')
      expect((await request(app).get('/health')).status).toBe(200)
    } finally {
      query.mockRestore()
    }
  })
})

describe('GET /', () => {
  it('returns 200 with welcome message', async () => {
    const res = await request(app).get('/')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      success: true,
      data: { message: 'Welcome VoucherHub' }
    })
  })
})

describe('admin routes', () => {
  it('mounts the dashboard API behind authentication', async () => {
    const res = await request(app).get('/api/admin/dashboard/stats')

    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'UNAUTHORIZED' }
    })
  })
})

describe('404 handler', () => {
  it('returns NOT_FOUND for unknown routes', async () => {
    const res = await request(app).get('/nonexistent-route')

    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(res.body.error.message).toContain('/nonexistent-route')
  })

  it('returns NOT_FOUND for unregistered HTTP methods', async () => {
    const res = await request(app).delete('/health')

    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })
})

describe('error handler', () => {
  it('returns BAD_REQUEST for malformed JSON body', async () => {
    const res = await request(app).post('/health').set('Content-Type', 'application/json').send('{ invalid json }')

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('BAD_REQUEST')
  })
})

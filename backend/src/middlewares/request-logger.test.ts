import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createRequestLogger } from './request-logger'

function fixture(enabled = true) {
  const logs: string[] = []
  const app = express()
  app.use(createRequestLogger((line) => logs.push(line), enabled))
  app.get('/codes/:code', (_req, res) => res.sendStatus(204))
  return { app, logs }
}

describe('HTTP request context and safe access logs', () => {
  it('correlates response and log without recording voucher, query or credential headers', async () => {
    const { app, logs } = fixture()
    const res = await request(app)
      .get('/codes/BEARER-VOUCHER?token=private-query')
      .set('X-Request-Id', 'interview-123')
      .set('Authorization', 'Bearer private-token')
      .set('Referer', 'https://example.invalid/?secret=private-referrer')
    expect(res.headers['x-request-id']).toBe('interview-123')
    expect(JSON.parse(logs[0])).toMatchObject({
      requestId: 'interview-123',
      method: 'GET',
      status: 204,
      route: '/codes/:code'
    })
    expect(logs[0]).not.toMatch(/BEARER-VOUCHER|private-query|private-token|private-referrer/)
  })

  it.each(['x'.repeat(65), 'invalid,header'])('replaces an unsafe incoming request id: %s', async (id) => {
    const { app } = fixture()
    const res = await request(app).get('/codes/code').set('X-Request-Id', id)
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
    expect(res.headers['x-request-id']).not.toBe(id)
  })

  it('logs unknown routes without copying the user supplied path', async () => {
    const { app, logs } = fixture()
    const res = await request(app).get('/unknown/secret-value')
    expect(res.status).toBe(404)
    expect(JSON.parse(logs[0]).route).toBe('[unmatched]')
    expect(logs[0]).not.toContain('secret-value')
  })

  it('keeps correlation headers when logging is disabled for tests', async () => {
    const { app, logs } = fixture(false)
    const res = await request(app).get('/codes/code')
    expect(res.headers['x-request-id']).toBeTruthy()
    expect(logs).toEqual([])
  })
})

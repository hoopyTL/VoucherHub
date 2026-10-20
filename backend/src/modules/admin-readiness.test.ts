import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import app from '~/app'
import prisma from '~/configs/prisma'
import { authHeader, resetUsers, seedRoles } from '~/test/helpers'
import { commerceFixture } from '~/test/commerce-fixture'

beforeAll(seedRoles)
beforeEach(resetUsers)

describe('S0 admin HTTP contracts against PostgreSQL', () => {
  it.each([
    '/dashboard',
    '/dashboard/stats',
    '/analytics',
    '/orders',
    '/codes',
    '/usage-logs',
    '/content',
    '/audit-logs'
  ])('protects %s from unauthenticated and customer access', async (path) => {
    const f = await commerceFixture()
    expect((await request(app).get(`/api/admin${path}`)).status).toBe(401)
    const res = await request(app).get(`/api/admin${path}`).set(authHeader(f.customer.id))
    expect(res.status).toBe(403)
    expect(res.body.success).toBe(false)
  })

  it('calculates analytics from paid snapshots rather than current catalogue prices', async () => {
    const f = await commerceFixture()
    const res = await request(app).get('/api/admin/analytics?days=7').set(authHeader(f.admin.id, 'ADMIN'))
    expect(res.status).toBe(200)
    expect(res.body.data.funnel).toMatchObject({
      ordersCreated: 2,
      ordersPaid: 1,
      ordersCancelled: 0,
      paidConversionRate: 0.5
    })
    expect(res.body.data.categoryBreakdown).toContainEqual({
      category: 'Fixture Category',
      revenue: 120000,
      unitsSold: 2
    })
    expect(res.body.data.revenueSeries.reduce((sum: number, p: { revenue: number }) => sum + p.revenue, 0)).toBe(120000)
  })

  it('returns empty dashboards without inventing revenue or orders', async () => {
    const f = await commerceFixture()
    await prisma.usageLog.deleteMany()
    await prisma.issuedVoucherCode.deleteMany()
    await prisma.paymentTransaction.deleteMany()
    await prisma.orderItem.deleteMany()
    await prisma.order.deleteMany()
    const res = await request(app).get('/api/admin/analytics?days=0').set(authHeader(f.admin.id, 'ADMIN'))
    expect(res.status).toBe(200)
    expect(res.body.data.funnel).toMatchObject({ ordersCreated: 0, ordersPaid: 0, paidConversionRate: 0 })
    expect(res.body.data.categoryBreakdown).toEqual([])
  })

  it.each(['/dashboard', '/dashboard/stats'])('returns supported dashboard data at %s', async (path) => {
    const f = await commerceFixture()
    const res = await request(app).get(`/api/admin${path}`).set(authHeader(f.admin.id, 'ADMIN'))
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(JSON.stringify(res.body.data)).toContain('120000')
  })

  it('filters orders by status, identity and date, and returns an authorized detail', async () => {
    const f = await commerceFixture()
    const headers = authHeader(f.admin.id, 'ADMIN')
    const res = await request(app)
      .get('/api/admin/orders')
      .query({
        status: 'PAID',
        q: f.customer.email,
        from: new Date(Date.now() - 86400000).toISOString(),
        to: new Date(Date.now() + 86400000).toISOString(),
        limit: 1
      })
      .set(headers)
    expect(res.status).toBe(200)
    expect(res.body.data.items).toHaveLength(1)
    expect(res.body.data.items[0].id).toBe(f.paid.id)
    const detail = await request(app).get(`/api/admin/orders/${f.paid.id}`).set(headers)
    expect(detail.status).toBe(200)
    expect(JSON.stringify(detail.body)).toContain(f.code.code)
    const empty = await request(app).get('/api/admin/orders?q=no-such-customer').set(headers)
    expect(empty.body.data.items).toEqual([])
  })

  it.each(['cancel', 'refund'])('rejects missing and ineligible orders for %s without mutation', async (action) => {
    const f = await commerceFixture(),
      headers = authHeader(f.admin.id, 'ADMIN')
    const missing = await request(app).patch(`/api/admin/orders/${randomUUID()}/${action}`).set(headers)
    expect(missing.status).toBe(404)
    const target = action === 'cancel' ? f.paid : f.pending
    const res = await request(app).patch(`/api/admin/orders/${target.id}/${action}`).set(headers)
    expect(res.status).toBe(409)
    expect((await prisma.voucherProduct.findUniqueOrThrow({ where: { id: f.voucher.id } })).remainingQuantity).toBe(47)
  })

  it('filters issued codes and usage logs without returning provider payload', async () => {
    const f = await commerceFixture(),
      headers = authHeader(f.admin.id, 'ADMIN')
    const codes = await request(app)
      .get('/api/admin/codes')
      .query({ status: 'USED', q: f.usedCode.code, limit: 5 })
      .set(headers)
    expect(codes.status).toBe(200)
    expect(codes.body.data.items).toHaveLength(1)
    expect(codes.body.data.items[0].code).toBe(f.usedCode.code)
    const logs = await request(app).get('/api/admin/usage-logs').query({ q: f.usedCode.code }).set(headers)
    expect(logs.status).toBe(200)
    expect(logs.body.data.items).toHaveLength(1)
    expect(logs.body.data.items[0]).toMatchObject({
      code: f.usedCode.code,
      result: 'SUCCESS',
      branchName: 'Main Branch'
    })
    expect(JSON.stringify(logs.body)).not.toContain('privateProviderPayload')
  })

  it('locks and unlocks a user and records the actions', async () => {
    const f = await commerceFixture(),
      headers = authHeader(f.admin.id, 'ADMIN')
    for (const status of ['LOCKED', 'ACTIVE']) {
      const res = await request(app).patch(`/api/admin/users/${f.customer.id}/status`).set(headers).send({ status })
      expect(res.status).toBe(200)
      expect(res.body.data.status).toBe(status)
    }
    const logs = await request(app)
      .get('/api/admin/audit-logs')
      .query({ action: 'user.', entityType: 'user', q: f.customer.id })
      .set(headers)
    expect(logs.status).toBe(200)
    expect(logs.body.data.items.map((l: { action: string }) => l.action).sort()).toEqual(['user.lock', 'user.unlock'])
  })

  it('suspends and restores a partner operational status', async () => {
    const f = await commerceFixture(),
      headers = authHeader(f.admin.id, 'ADMIN')
    for (const status of ['SUSPENDED', 'ACTIVE']) {
      const res = await request(app)
        .patch(`/api/admin/partners/${f.partner.id}/operating-status`)
        .set(headers)
        .send({ operatingStatus: status })
      expect(res.status).toBe(200)
      expect(res.body.data.operatingStatus).toBe(status)
    }
  })

  it.each([
    ['users', 'status'],
    ['partners', 'operating-status']
  ])('rejects invalid %s/%s status', async (resource, action) => {
    const f = await commerceFixture()
    const res = await request(app)
      .patch(`/api/admin/${resource}/${randomUUID()}/${action}`)
      .set(authHeader(f.admin.id, 'ADMIN'))
      .send({ status: 'INVALID', operatingStatus: 'INVALID' })
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
  })
})

describe('S0 CMS publication contract', () => {
  it('creates draft, publishes, filters public visibility, updates and archives content with audit', async () => {
    const f = await commerceFixture(),
      headers = authHeader(f.admin.id, 'ADMIN')
    const created = await request(app)
      .post('/api/admin/content')
      .set(headers)
      .send({ type: 'faq', title: 'Fixture FAQ', body: 'Initial answer' })
    expect(created.status).toBe(201)
    expect(created.body.data.status).toBe('draft')
    const id = created.body.data.id
    expect((await request(app).get('/api/content?type=faq')).body.data.items).toEqual([])
    const updated = await request(app)
      .patch(`/api/admin/content/${id}`)
      .set(headers)
      .send({ title: 'Published FAQ', body: 'New answer', status: 'published', displayFrom: null, displayTo: null })
    expect(updated.status).toBe(200)
    expect(updated.body.data.body).toBe('New answer')
    const visible = await request(app).get('/api/content?type=faq')
    expect(visible.body.data.items).toHaveLength(1)
    expect(visible.body.data.items[0].id).toBe(id)
    const filtered = await request(app).get('/api/admin/content?type=faq&status=published&q=New').set(headers)
    expect(filtered.body.data.items).toHaveLength(1)
    const archived = await request(app).delete(`/api/admin/content/${id}`).set(headers)
    expect(archived.status).toBe(200)
    expect(archived.body.data.status).toBe('archived')
    expect((await request(app).get('/api/content')).body.data.items).toEqual([])
    const actions = await prisma.auditLog.findMany({ where: { entityId: id } })
    expect(actions.map((a) => a.action).sort()).toEqual(['content.archive', 'content.create', 'content.update'])
  })

  it.each([
    {},
    { type: 'invalid', title: 'Title', body: 'Body' },
    { type: 'faq', title: ' ', body: 'Body' },
    { type: 'faq', title: 'Title', body: ' ' },
    { type: 'faq', title: 'Title', body: 'Body', status: 'invalid' },
    { type: 'faq', title: 'Title', body: 'Body', displayFrom: 'bad-date' },
    { type: 'faq', title: 'Title', body: 'Body', displayFrom: '2030-02-01', displayTo: '2030-01-01' }
  ])('rejects invalid content input without inserting a row: %j', async (body) => {
    const f = await commerceFixture()
    const res = await request(app).post('/api/admin/content').set(authHeader(f.admin.id, 'ADMIN')).send(body)
    expect(res.status).toBe(400)
    expect(await prisma.contentItem.count()).toBe(0)
  })

  it('rejects empty updates and missing content ids', async () => {
    const f = await commerceFixture(),
      headers = authHeader(f.admin.id, 'ADMIN'),
      id = randomUUID()
    expect((await request(app).patch(`/api/admin/content/${id}`).set(headers).send({})).status).toBe(400)
    expect((await request(app).patch(`/api/admin/content/${id}`).set(headers).send({ title: 'Missing' })).status).toBe(
      404
    )
    expect((await request(app).delete(`/api/admin/content/${id}`).set(headers)).status).toBe(404)
  })

  it('does not publish future, expired or draft items', async () => {
    const f = await commerceFixture(),
      now = Date.now()
    await prisma.contentItem.createMany({
      data: [
        {
          type: 'faq',
          title: 'Future',
          body: 'x',
          status: 'published',
          displayFrom: new Date(now + 86400000),
          authorUserId: f.admin.id
        },
        {
          type: 'faq',
          title: 'Expired',
          body: 'x',
          status: 'published',
          displayTo: new Date(now - 86400000),
          authorUserId: f.admin.id
        },
        { type: 'faq', title: 'Draft', body: 'x', status: 'draft', authorUserId: f.admin.id }
      ]
    })
    const res = await request(app).get('/api/content?type=faq')
    expect(res.status).toBe(200)
    expect(res.body.data.items).toEqual([])
  })
})

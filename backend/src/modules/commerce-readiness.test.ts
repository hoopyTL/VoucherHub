import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import app from '~/app'
import prisma from '~/configs/prisma'
import { authHeader, resetUsers, seedRoles, TEST_PASSWORD } from '~/test/helpers'
import { commerceFixture } from '~/test/commerce-fixture'

beforeAll(seedRoles)
beforeEach(resetUsers)

describe('S0 cart and customer payment contracts on PostgreSQL', () => {
  it('creates a cart, merges quantities, reprices reads and removes only the owner item', async () => {
    const f = await commerceFixture(),
      headers = authHeader(f.customer.id)
    const empty = await request(app).get('/api/cart').set(headers)
    expect(empty.body.data).toMatchObject({ items: [], subtotal: '0.00' })
    for (const quantity of [2, 1]) {
      const res = await request(app)
        .post('/api/cart/items')
        .set(headers)
        .send({ voucherProductId: f.voucher.id, quantity })
      expect(res.status).toBe(200)
    }
    const cart = await request(app).get('/api/cart').set(headers)
    expect(cart.body.data.items).toHaveLength(1)
    expect(cart.body.data).toMatchObject({ subtotal: '240000.00', items: [{ quantity: 3, itemTotal: '240000.00' }] })
    const id = cart.body.data.items[0].id
    const foreign = await request(app).delete(`/api/cart/items/${id}`).set(authHeader(f.outsider.id))
    expect(foreign.status).toBe(403)
    const changed = await request(app).patch(`/api/cart/items/${id}`).set(headers).send({ quantity: 1 })
    expect(changed.status).toBe(200)
    expect(changed.body.data.subtotal).toBe('80000.00')
    expect((await request(app).delete(`/api/cart/items/${id}`).set(headers)).status).toBe(200)
    expect((await request(app).get('/api/cart').set(headers)).body.data.items).toEqual([])
  })

  it.each([0, -1, 1000])('rejects invalid cart quantity %s without writes', async (quantity) => {
    const f = await commerceFixture()
    const res = await request(app)
      .post('/api/cart/items')
      .set(authHeader(f.customer.id))
      .send({ voucherProductId: f.voucher.id, quantity })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(await prisma.cartItem.count()).toBe(0)
  })

  it('rejects unavailable vouchers and missing cart items', async () => {
    const f = await commerceFixture(),
      headers = authHeader(f.customer.id)
    await prisma.voucherProduct.update({ where: { id: f.voucher.id }, data: { status: 'PAUSED' } })
    expect(
      (await request(app).post('/api/cart/items').set(headers).send({ voucherProductId: f.voucher.id, quantity: 1 }))
        .status
    ).toBe(422)
    expect((await request(app).patch('/api/cart/items/99999999').set(headers).send({ quantity: 1 })).status).toBe(404)
    expect((await request(app).delete('/api/cart/items/99999999').set(headers)).status).toBe(404)
  })

  it('returns safe serialized payment details and only successful order history', async () => {
    const f = await commerceFixture(),
      headers = authHeader(f.customer.id)
    await prisma.paymentTransaction.create({
      data: { orderId: f.paid.id, gateway: 'TEST', amount: 120000, status: 'FAILED' }
    })
    const detail = await request(app).get(`/api/payments/${f.payment.id}`).set(headers)
    expect(detail.status).toBe(200)
    expect(detail.body.data).toMatchObject({
      id: f.payment.id,
      amount: '120000.00',
      currency: 'VND',
      status: 'SUCCESS',
      refundedAt: null
    })
    expect(detail.body.data.paidAt).toMatch(/^\d{4}-/)
    expect(detail.body.data).not.toHaveProperty('rawResponse')
    const history = await request(app).get(`/api/orders/${f.paid.id}/payments`).set(headers)
    expect(history.status).toBe(200)
    expect(history.body.data).toHaveLength(1)
    expect(history.body.data[0].id).toBe(f.payment.id)
    expect(JSON.stringify(history.body)).not.toContain('privateProviderPayload')
  })

  it('rejects foreign and missing payments/order histories', async () => {
    const f = await commerceFixture(),
      headers = authHeader(f.outsider.id)
    for (const path of [`/api/payments/${f.payment.id}`, `/api/orders/${f.paid.id}/payments`]) {
      expect((await request(app).get(path).set(headers)).status).toBe(403)
    }
    for (const path of [`/api/payments/${randomUUID()}`, `/api/orders/${randomUUID()}/payments`]) {
      expect((await request(app).get(path).set(headers)).status).toBe(404)
    }
  })

  it('supports customer review create/read/update/delete after paid purchase', async () => {
    const f = await commerceFixture(),
      headers = authHeader(f.customer.id)
    const eligible = await request(app).get('/api/reviews/eligible').set(headers)
    expect(eligible.status).toBe(200)
    expect(JSON.stringify(eligible.body.data)).toContain(f.voucher.id)
    const created = await request(app)
      .post('/api/reviews')
      .set(headers)
      .send({ voucherProductId: f.voucher.id, rating: 4, comment: 'Clear checkout' })
    expect(created.status).toBe(201)
    const id = created.body.data.id
    const mine = await request(app).get('/api/reviews/me').set(headers)
    expect(mine.status).toBe(200)
    expect(JSON.stringify(mine.body.data)).toContain(id)
    const publicReviews = await request(app).get(`/api/vouchers/${f.voucher.id}/reviews?rating=4&sort=oldest&limit=1`)
    expect(publicReviews.status).toBe(200)
    expect(JSON.stringify(publicReviews.body.data)).toContain('Clear checkout')
    const updated = await request(app)
      .patch(`/api/reviews/${id}`)
      .set(headers)
      .send({ rating: 5, comment: 'Updated review' })
    expect(updated.status).toBe(200)
    expect(updated.body.data.rating).toBe(5)
    const foreign = await request(app).delete(`/api/reviews/${id}`).set(authHeader(f.outsider.id))
    expect(foreign.status).toBe(403)
    expect((await request(app).delete(`/api/reviews/${id}`).set(headers)).status).toBe(200)
    expect(await prisma.review.count()).toBe(0)
  })
})

describe('S0 partner staff and reporting scope', () => {
  it('counts only paid snapshots and counts redeemed codes rather than usage events', async () => {
    const f = await commerceFixture()
    await prisma.usageLog.create({
      data: { issuedCodeId: f.usedCode.id, branchId: f.branch.id, actorUserId: f.owner.id, result: 'SUCCESS' }
    })
    const res = await request(app).get('/api/partner/reports').set(authHeader(f.owner.id, 'PARTNER'))
    expect(res.status).toBe(200)
    expect(res.body.data.summary).toEqual({
      revenue: 120000,
      issuedCount: 2,
      soldCount: 2,
      usedCount: 1,
      usageRate: 0.5
    })
    const other = await request(app).get('/api/partner/reports').set(authHeader(f.foreignOwner.id, 'PARTNER'))
    expect(other.body.data).toMatchObject({ vouchers: [], summary: { revenue: 0, soldCount: 0, usedCount: 0 } })
  })

  it('creates, lists, reassigns, locks and changes a staff password within owned branches', async () => {
    const f = await commerceFixture(),
      headers = authHeader(f.owner.id, 'PARTNER')
    const created = await request(app)
      .post('/api/partner/staff')
      .set(headers)
      .send({
        fullName: 'Desk Staff',
        email: 'desk@example.test',
        phone: '0912345678',
        password: TEST_PASSWORD,
        branchIds: [f.branch.id, f.branch.id]
      })
    expect(created.status).toBe(201)
    const id = created.body.data.id
    expect(created.body.data.assignments).toHaveLength(1)
    expect(JSON.stringify(created.body)).not.toContain('passwordHash')
    const list = await request(app).get('/api/partner/staff').set(headers)
    expect(list.status).toBe(200)
    expect(list.body.data[0].id).toBe(id)
    const updated = await request(app)
      .patch(`/api/partner/staff/${id}`)
      .set(headers)
      .send({
        fullName: 'Updated Desk',
        email: 'updated-desk@example.test',
        phone: '0987654321',
        password: 'NewPassword123!',
        locked: true,
        status: 'INACTIVE',
        branchIds: [f.branch.id]
      })
    expect(updated.status).toBe(200)
    expect(updated.body.data).toMatchObject({
      status: 'INACTIVE',
      user: { fullName: 'Updated Desk', status: 'LOCKED' }
    })
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: updated.body.data.user.id } })
    expect(stored.tokenVersion).toBe(1)
    expect(stored.passwordHash).not.toBe(TEST_PASSWORD)
    const unlocked = await request(app)
      .patch(`/api/partner/staff/${id}`)
      .set(headers)
      .send({ locked: false, status: 'ACTIVE' })
    expect(unlocked.status).toBe(200)
    expect(unlocked.body.data.user.status).toBe('ACTIVE')
  })

  it('rejects foreign/inactive branches and duplicate staff identities', async () => {
    const f = await commerceFixture(),
      headers = authHeader(f.owner.id, 'PARTNER')
    const input = { fullName: 'Staff', email: 'staff@example.test', password: TEST_PASSWORD, branchIds: [f.branch.id] }
    for (const branchId of [f.foreignPartner.branches[0].id, f.partner.branches.find((b) => !b.isActive)!.id]) {
      const res = await request(app)
        .post('/api/partner/staff')
        .set(headers)
        .send({ ...input, branchIds: [branchId] })
      expect(res.status).toBe(403)
    }
    const first = await request(app).post('/api/partner/staff').set(headers).send(input)
    expect(first.status).toBe(201)
    expect((await request(app).post('/api/partner/staff').set(headers).send(input)).status).toBe(409)
    const foreign = await request(app)
      .patch(`/api/partner/staff/${first.body.data.id}`)
      .set(authHeader(f.foreignOwner.id, 'PARTNER'))
      .send({ fullName: 'Intruder' })
    expect(foreign.status).toBe(404)
    const duplicate = await request(app)
      .patch(`/api/partner/staff/${first.body.data.id}`)
      .set(headers)
      .send({ email: f.customer.email })
    expect(duplicate.status).toBe(409)
    expect((await request(app).patch(`/api/partner/staff/${first.body.data.id}`).set(headers).send({})).status).toBe(
      400
    )
  })
})

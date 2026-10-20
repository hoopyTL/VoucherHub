import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import app from '~/app'
import prisma from '~/configs/prisma'
import { resetUsers, seedRoles } from '~/test/helpers'
import { commerceFixture } from '~/test/commerce-fixture'

beforeAll(seedRoles)
beforeEach(resetUsers)

describe('Public catalogue HTTP contracts on PostgreSQL', () => {
  it('combines public filters and returns current price with paid sold quantity', async () => {
    const f = await commerceFixture()
    const res = await request(app).get('/api/vouchers').query({
      keyword: 'Snapshot',
      category: 'Fixture Category',
      region: 'HCM',
      partnerId: f.partner.id,
      minPrice: 70000,
      maxPrice: 90000,
      page: 1,
      limit: 1
    })
    expect(res.status).toBe(200)
    expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 1, total: 1 })
    expect(res.body.data.vouchers).toHaveLength(1)
    expect(res.body.data.vouchers[0]).toMatchObject({ id: f.voucher.id, salePrice: '80000', soldQuantity: 2 })
    const detail = await request(app).get(`/api/vouchers/${f.voucher.id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.data.id).toBe(f.voucher.id)
    expect(JSON.stringify(detail.body)).not.toContain('passwordHash')
    const filters = await request(app).get('/api/vouchers/filters')
    expect(filters.status).toBe(200)
    expect(filters.body.data.categories).toContain('Fixture Category')
    expect(filters.body.data.regions).toContain('HCM')
  })

  it('applies minimum-discount filtering before pagination', async () => {
    const f = await commerceFixture()
    const match = await request(app).get('/api/vouchers?minDiscount=20&limit=1')
    expect(match.status).toBe(200)
    expect(match.body.data.vouchers.map((v: { id: string }) => v.id)).toEqual([f.voucher.id])
    const empty = await request(app).get('/api/vouchers?minDiscount=21&limit=1')
    expect(empty.status).toBe(200)
    expect(empty.body.data.vouchers).toEqual([])
    expect(empty.body.data.pagination.total).toBe(0)
  })

  it('hides expired sale windows from search and detail', async () => {
    const f = await commerceFixture()
    await prisma.voucherProduct.update({ where: { id: f.voucher.id }, data: { saleEnd: new Date(Date.now() - 1000) } })
    const search = await request(app).get('/api/vouchers')
    expect(search.status).toBe(200)
    expect(search.body.data.vouchers).toEqual([])
    expect((await request(app).get(`/api/vouchers/${f.voucher.id}`)).status).toBe(404)
    const filters = await request(app).get('/api/vouchers/filters')
    expect(filters.body.data.priceRange).toEqual({ min: 0, max: 0 })
  })
})

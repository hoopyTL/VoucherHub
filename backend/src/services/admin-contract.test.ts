import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import prisma from '~/configs/prisma'
import { resetUsers, seedRoles } from '~/test/helpers'
import { commerceFixture } from '~/test/commerce-fixture'
import * as admin from './admin.service'
import { paymentService } from '~/modules/payment/payment.service'

beforeAll(seedRoles)
beforeEach(resetUsers)

// Service contract evidence, not HTTP coverage: some legacy admin routes are
// shadowed by module routers. Keep that routing gap visible in the S0 report.
describe('Admin service contracts with real persistence', () => {
  it('filters users, partners and vouchers and serializes their aggregate counts', async () => {
    const f = await commerceFixture()
    const users = await admin.listAdminUsers({ status: 'ACTIVE', q: f.customer.email!, limit: '1' })
    expect(users.items).toHaveLength(1)
    expect(users.items[0]).toMatchObject({ id: f.customer.id, orders: 1, issuedCodes: 2, roleName: 'CUSTOMER' })
    const partners = await admin.listAdminPartners({ status: 'APPROVED', q: f.partner.taxCode, limit: '10' })
    expect(partners.items).toHaveLength(1)
    expect(partners.items[0]).toMatchObject({ id: f.partner.id, branches: 2, vouchers: 1 })
    const vouchers = await admin.listAdminVouchers({ status: 'ON_SALE', q: 'Snapshot', limit: '5' })
    expect(vouchers.items).toHaveLength(1)
    expect(vouchers.items[0]).toMatchObject({
      id: f.voucher.id,
      categoryName: 'Fixture Category',
      orders: 2,
      issuedCodes: 2,
      branches: 1,
      salePrice: 80000
    })
    expect((await admin.listAdminUsers({ q: 'no-such-user' })).items).toEqual([])
    expect((await admin.listAdminPartners({ q: 'no-such-partner' })).items).toEqual([])
    expect((await admin.listAdminVouchers({ q: 'no-such-product' })).items).toEqual([])
  })

  it('paginates orders without repeating the cursor and rejects unknown status', async () => {
    const f = await commerceFixture()
    const first = await admin.listAdminOrders({ limit: '1', status: 'PAID,PENDING_PAYMENT' })
    expect(first.items).toHaveLength(1)
    expect(first.nextCursor).toBe(first.items[0].id)
    const next = await admin.listAdminOrders({ limit: '1', cursor: first.nextCursor! })
    expect(next.items).toHaveLength(1)
    expect(new Set([first.items[0].id, next.items[0].id])).toEqual(new Set([f.paid.id, f.pending.id]))
    expect(next.nextCursor).toBeNull()
    await expect(admin.listAdminOrders({ status: 'UNKNOWN' })).rejects.toThrow('Invalid order status')
    await expect(admin.getAdminOrder(randomUUID())).rejects.toThrow('Không tìm thấy')
  })

  it('persists valid moderation decisions and their audit records', async () => {
    const f = await commerceFixture()
    await prisma.partner.update({ where: { id: f.partner.id }, data: { approvalStatus: 'PENDING' } })
    expect((await admin.setAdminPartnerApproval(f.partner.id, 'REJECTED', 'Missing evidence')).rejectReason).toBe(
      'Missing evidence'
    )
    await prisma.partner.update({ where: { id: f.partner.id }, data: { approvalStatus: 'PENDING' } })
    expect((await admin.setAdminPartnerApproval(f.partner.id, 'APPROVED')).rejectReason).toBeNull()
    await prisma.voucherProduct.update({ where: { id: f.voucher.id }, data: { status: 'PENDING_REVIEW' } })
    expect((await admin.setAdminVoucherApproval(f.voucher.id, 'REJECTED', 'Clarify terms')).rejectReason).toBe(
      'Clarify terms'
    )
    await prisma.voucherProduct.update({ where: { id: f.voucher.id }, data: { status: 'PENDING_REVIEW' } })
    expect((await admin.setAdminVoucherApproval(f.voucher.id, 'APPROVED')).status).toBe('APPROVED')
    for (const status of ['ON_SALE', 'PAUSED', 'ON_SALE', 'DISCONTINUED'] as const) {
      expect((await admin.setAdminVoucherStatus(f.voucher.id, status)).status).toBe(status)
    }
    const actions = (await prisma.auditLog.findMany()).map((row) => row.action)
    expect(actions).toEqual(
      expect.arrayContaining([
        'partner.reject',
        'partner.approve',
        'voucher.reject',
        'voucher.approve',
        'voucher.publish',
        'voucher.pause',
        'voucher.discontinue'
      ])
    )
  })

  it('rejects missing moderation resources and unsupported target states', async () => {
    await commerceFixture()
    const id = randomUUID()
    await expect(admin.setAdminPartnerApproval(id, 'APPROVED')).rejects.toThrow('Không tìm thấy')
    await expect(admin.setAdminPartnerOperatingStatus(id, 'SUSPENDED')).rejects.toThrow('Không tìm thấy')
    await expect(admin.setAdminUserStatus(id, 'LOCKED')).rejects.toThrow('Không tìm thấy')
    await expect(admin.setAdminVoucherApproval(id, 'APPROVED')).rejects.toThrow('Không tìm thấy')
    await expect(admin.setAdminVoucherStatus(id, 'ON_SALE')).rejects.toThrow('Không tìm thấy')
    await expect(admin.setAdminVoucherApproval(id, 'DRAFT')).rejects.toThrow('Trạng thái duyệt')
    await expect(admin.setAdminVoucherStatus(id, 'DRAFT')).rejects.toThrow('không được hỗ trợ')
  })

  it('looks up payment ledger records without exposing provider payload', async () => {
    const f = await commerceFixture()
    await prisma.paymentTransaction.update({ where: { id: f.payment.id }, data: { gatewayTransId: 'known-event' } })
    expect(await paymentService.getByGatewayTransId('no-event')).toBeNull()
    expect(await paymentService.getSuccessfulPayment(f.pending.id)).toBeNull()
    expect(await paymentService.getByGatewayTransId('known-event')).toMatchObject({
      id: f.payment.id,
      amount: '120000.00'
    })
    const paid = await paymentService.getSuccessfulPayment(f.paid.id)
    expect(paid?.id).toBe(f.payment.id)
    expect(paid).not.toHaveProperty('rawResponse')
  })
})

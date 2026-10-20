import { randomUUID } from 'node:crypto'
import prisma from '~/configs/prisma'
import { hashPassword } from '~/utils/password'
import { TEST_PASSWORD } from './helpers'

let passwordHash: Promise<string> | undefined

/** Real database fixtures: no mocked transactions or payment-provider calls. */
export async function commerceFixture() {
  passwordHash ??= hashPassword(TEST_PASSWORD)
  const roles = await prisma.role.findMany()
  const user = async (name: string, role: string, email?: string) =>
    prisma.user.create({
      data: {
        email: email ?? `${randomUUID()}@example.test`,
        fullName: name,
        passwordHash: await passwordHash!,
        roleId: roles.find((r) => r.name === role)!.id
      }
    })
  const admin = await user('Audit Admin', 'ADMIN', 'admin@voucherhub.com')
  const customer = await user('Customer One', 'CUSTOMER')
  const outsider = await user('Customer Two', 'CUSTOMER')
  const owner = await user('Partner Owner', 'PARTNER')
  const foreignOwner = await user('Other Owner', 'PARTNER')
  const partner = await prisma.partner.create({
    data: {
      ownerUserId: owner.id,
      legalName: 'Fixture Partner',
      taxCode: randomUUID().slice(0, 30),
      representative: 'Representative',
      approvalStatus: 'APPROVED',
      operatingStatus: 'ACTIVE',
      branches: {
        create: [
          { name: 'Main Branch', address: '1 Test Road', region: 'HCM' },
          { name: 'Inactive Branch', address: '2 Test Road', region: 'HN', isActive: false }
        ]
      }
    },
    include: { branches: true }
  })
  const foreignPartner = await prisma.partner.create({
    data: {
      ownerUserId: foreignOwner.id,
      legalName: 'Other Partner',
      taxCode: randomUUID().slice(0, 30),
      representative: 'Other Representative',
      approvalStatus: 'APPROVED',
      branches: { create: { name: 'Foreign Branch', address: '3 Test Road', region: 'DN' } }
    },
    include: { branches: true }
  })
  const category = await prisma.category.create({ data: { name: 'Fixture Category' } })
  const now = Date.now()
  const voucher = await prisma.voucherProduct.create({
    data: {
      partnerId: partner.id,
      categoryId: category.id,
      name: 'Snapshot Voucher',
      description: 'Fixture description',
      originalPrice: 100000,
      salePrice: 80000,
      totalQuantity: 50,
      remainingQuantity: 47,
      status: 'ON_SALE',
      saleStart: new Date(now - 86_400_000),
      saleEnd: new Date(now + 86_400_000),
      usageStart: new Date(now - 86_400_000),
      usageEnd: new Date(now + 864_000_000),
      voucherProductBranches: { create: { branchId: partner.branches.find((b) => b.isActive)!.id } }
    }
  })
  const paid = await prisma.order.create({
    data: {
      customerId: customer.id,
      status: 'PAID',
      totalAmount: 120000,
      paymentMethod: 'TEST',
      paidAt: new Date(now - 86_400_000),
      orderItems: { create: { voucherProductId: voucher.id, quantity: 2, unitPrice: 60000 } }
    },
    include: { orderItems: true }
  })
  const pending = await prisma.order.create({
    data: {
      customerId: outsider.id,
      status: 'PENDING_PAYMENT',
      totalAmount: 80000,
      paymentMethod: 'TEST',
      expiresAt: new Date(now + 900_000),
      orderItems: { create: { voucherProductId: voucher.id, quantity: 1, unitPrice: 80000 } }
    }
  })
  const code = await prisma.issuedVoucherCode.create({
    data: {
      code: randomUUID().replaceAll('-', '').slice(0, 24),
      orderId: paid.id,
      orderItemId: paid.orderItems[0].id,
      voucherProductId: voucher.id,
      ownerUserId: customer.id,
      remainingUses: 1,
      expiresAt: voucher.usageEnd
    }
  })
  const usedCode = await prisma.issuedVoucherCode.create({
    data: {
      code: randomUUID().replaceAll('-', '').slice(0, 24),
      orderId: paid.id,
      orderItemId: paid.orderItems[0].id,
      voucherProductId: voucher.id,
      ownerUserId: customer.id,
      remainingUses: 0,
      status: 'USED',
      expiresAt: voucher.usageEnd
    }
  })
  const branch = partner.branches.find((b) => b.isActive)!
  await prisma.usageLog.create({
    data: { issuedCodeId: usedCode.id, branchId: branch.id, actorUserId: owner.id, result: 'SUCCESS' }
  })
  const payment = await prisma.paymentTransaction.create({
    data: {
      orderId: paid.id,
      gateway: 'TEST',
      amount: 120000,
      currency: 'VND',
      status: 'SUCCESS',
      paidAt: new Date(now),
      rawResponse: { privateProviderPayload: 'must-not-be-returned' }
    }
  })
  return {
    admin,
    customer,
    outsider,
    owner,
    foreignOwner,
    partner,
    foreignPartner,
    category,
    voucher,
    paid,
    pending,
    code,
    usedCode,
    payment,
    branch
  }
}

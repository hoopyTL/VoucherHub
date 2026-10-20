import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

import { E2E_PASSWORD, e2eUsers } from './fixtures/task004'
import { resetTestDatabase } from '../backend/src/test/reset-database'

const prisma = new PrismaClient()

async function resetDatabase(): Promise<void> {
  await resetTestDatabase(prisma)
  await prisma.category.deleteMany()
}

export async function setupE2eDatabase(): Promise<void> {
  await resetDatabase()

  const category = await prisma.category.create({ data: { name: 'E2E Ẩm thực' } })

  const roles = new Map<string, number>()
  for (const name of ['ADMIN', 'PARTNER', 'CUSTOMER']) {
    const role = await prisma.role.upsert({ where: { name }, update: {}, create: { name } })
    roles.set(name, role.id)
  }

  const passwordHash = await bcrypt.hash(E2E_PASSWORD, 10)
  for (const user of Object.values(e2eUsers)) {
    const roleId = roles.get(user.role)
    if (!roleId) throw new Error(`Missing E2E role: ${user.role}`)
    const created = await prisma.user.create({
      data: { email: user.email, fullName: user.fullName, roleId, passwordHash }
    })
    if (user.role === 'PARTNER') {
      await prisma.partner.create({
        data: {
          ownerUserId: created.id,
          legalName: 'E2E Approved Partner',
          taxCode: 'E2E-APPROVED-001',
          representative: user.fullName,
          approvalStatus: 'APPROVED',
          branches: { create: { name: 'E2E Main Branch', address: '1 Test Street', region: 'Hà Nội' } }
        }
      })
    }
  }

  const partnerUser = await prisma.user.findUniqueOrThrow({ where: { email: e2eUsers.partner.email } })
  const customer = await prisma.user.findUniqueOrThrow({ where: { email: e2eUsers.customer.email } })
  const partner = await prisma.partner.findUniqueOrThrow({
    where: { ownerUserId: partnerUser.id },
    include: { branches: true }
  })
  const voucher = await prisma.voucherProduct.create({
    data: {
      partnerId: partner.id,
      categoryId: category.id,
      name: 'E2E Redeem Voucher',
      description: 'Voucher for FLOW-007 and FLOW-008',
      originalPrice: 100000,
      salePrice: 80000,
      saleStart: new Date(Date.now() - 86_400_000),
      saleEnd: new Date(Date.now() + 10 * 86_400_000),
      usageStart: new Date(Date.now() - 86_400_000),
      usageEnd: new Date(Date.now() + 30 * 86_400_000),
      totalQuantity: 10,
      remainingQuantity: 9,
      status: 'ON_SALE',
      voucherProductBranches: { create: { branchId: partner.branches[0].id } }
    }
  })
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      totalAmount: 80000,
      paymentMethod: 'TEST',
      status: 'PAID',
      paidAt: new Date(),
      orderItems: { create: { voucherProductId: voucher.id, quantity: 1, unitPrice: 80000 } }
    },
    include: { orderItems: true }
  })
  await prisma.issuedVoucherCode.create({
    data: {
      code: 'VH-E2E-REDEEM-001',
      orderId: order.id,
      orderItemId: order.orderItems[0].id,
      voucherProductId: voucher.id,
      ownerUserId: customer.id,
      remainingUses: 1,
      expiresAt: voucher.usageEnd
    }
  })
}

export async function disconnectE2eDatabase(): Promise<void> {
  await prisma.$disconnect()
}

export default async function globalSetup(): Promise<void> {
  await setupE2eDatabase()
  await disconnectE2eDatabase()
}

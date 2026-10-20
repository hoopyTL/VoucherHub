import type { PrismaClient } from '@prisma/client'
import { assertTestDatabaseUrl } from './database-url'

/** Shared by integration tests and browser E2E; children first, roles retained. */
export async function resetTestDatabase(client: PrismaClient): Promise<void> {
  assertTestDatabaseUrl(process.env.DATABASE_URL)
  await client.review.deleteMany()
  await client.auditLog.deleteMany()
  await client.contentItem.deleteMany()
  await client.usageLog.deleteMany()
  await client.partnerStaffBranch.deleteMany()
  await client.partnerStaff.deleteMany()
  await client.issuedVoucherCode.deleteMany()
  await client.paymentTransaction.deleteMany()
  await client.orderItem.deleteMany()
  await client.order.deleteMany()
  await client.cartItem.deleteMany()
  await client.cart.deleteMany()
  await client.voucherProductBranch.deleteMany()
  await client.voucherProduct.deleteMany()
  // Break the category tree first: parent deletion is RESTRICT, at any depth.
  await client.category.updateMany({ data: { parentId: null } })
  await client.category.deleteMany()
  await client.branch.deleteMany()
  await client.partner.deleteMany()
  await client.user.deleteMany()
}

import { RoleName, type RoleName as RoleNameValue } from '@voucher/shared'
import prisma from '~/configs/prisma'
import { signAccessToken } from '~/utils/jwt'
import { hashPassword } from '~/utils/password'
import { resetTestDatabase } from './reset-database'

export const TEST_PASSWORD = 'ValidPassword123!'

export async function seedRoles(): Promise<void> {
  await Promise.all(
    Object.values(RoleName).map((name) => prisma.role.upsert({ where: { name }, update: {}, create: { name } }))
  )
}

export async function resetUsers(): Promise<void> {
  await resetTestDatabase(prisma)
}

interface CreateUserOptions {
  email: string
  role?: RoleNameValue
  password?: string
  status?: 'ACTIVE' | 'LOCKED'
  fullName?: string
}

export async function createUser({
  email,
  role = RoleName.CUSTOMER,
  password = TEST_PASSWORD,
  status = 'ACTIVE',
  fullName = 'Test User'
}: CreateUserOptions) {
  const dbRole = await prisma.role.findUniqueOrThrow({ where: { name: role } })
  return prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      roleId: dbRole.id,
      status,
      fullName
    }
  })
}

export function authHeader(userId: string, role: RoleNameValue = RoleName.CUSTOMER) {
  return { Authorization: `Bearer ${signAccessToken({ sub: userId, role })}` }
}

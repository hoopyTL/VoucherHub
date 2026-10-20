import dotenv from 'dotenv'
import { afterAll } from 'vitest'
import { assertTestDatabaseUrl } from './database-url'

dotenv.config({ path: '.env.test', quiet: true })

assertTestDatabaseUrl(process.env.DATABASE_URL)
process.env.NODE_ENV = 'test'

afterAll(async () => {
  const { default: prisma } = await import('~/configs/prisma')
  if (typeof prisma.$disconnect === 'function') await prisma.$disconnect()
})

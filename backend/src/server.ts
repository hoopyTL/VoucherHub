import { env } from './configs/env'
import app from './app'
import { startOrderCleanupCron } from './modules/order/order.cron'
import prisma from './configs/prisma'

let stopCleanup: (() => void) | undefined
const server = app.listen(env.PORT, () => {
  console.log(`Server is running on ${env.PORT} (${env.NODE_ENV})`)
  stopCleanup = startOrderCleanupCron()
})

let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  stopCleanup?.()
  const deadline = setTimeout(() => {
    server.closeAllConnections()
    process.exit(1)
  }, 10_000)
  deadline.unref()
  server.close(async () => {
    try {
      await prisma.$disconnect()
    } catch {
      process.exitCode = 1
    } finally {
      clearTimeout(deadline)
    }
  })
  server.closeIdleConnections()
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

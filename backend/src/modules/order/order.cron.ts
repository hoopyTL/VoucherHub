import prisma from '../../configs/prisma'

/**
 * Background worker dọn dẹp đơn hàng quá hạn (chạy mỗi 1 phút).
 *
 * Chính sách: đơn PENDING_PAYMENT hết hạn được hủy nhưng vẫn giữ lịch sử.
 * Khi hết hạn:
 *   1. Hoàn tồn kho (increment remainingQuantity)
 *   2. Trả items về giỏ hàng khách (tạo lại CartItem)
 *   3. Đánh dấu payment đang chờ là FAILED và Order là CANCELLED
 */
export const startOrderCleanupCron = () => {
  const ONE_MINUTE = 60 * 1000

  const timer = setInterval(async () => {
    try {
      const now = new Date()

      // 1. Tìm các đơn PENDING_PAYMENT đã quá hạn
      const expiredOrders = await prisma.order.findMany({
        where: {
          status: 'PENDING_PAYMENT',
          expiresAt: { lt: now }
        },
        include: {
          orderItems: {
            include: {
              voucherProduct: {
                select: { id: true, salePrice: true }
              }
            }
          }
        }
      })

      if (expiredOrders.length === 0) return

      console.log(`[OrderCron] Found ${expiredOrders.length} expired order(s). Cleaning up...`)

      // 2. Xử lý từng đơn trong transaction riêng
      for (const order of expiredOrders) {
        try {
          await prisma.$transaction(async (tx) => {
            // 2a. Hoàn tồn kho
            for (const item of order.orderItems) {
              await tx.voucherProduct.update({
                where: { id: item.voucherProductId },
                data: {
                  remainingQuantity: { increment: item.quantity }
                }
              })
            }

            // 2b. Trả items về giỏ hàng
            // Tìm hoặc tạo cart cho khách
            let cart = await tx.cart.findUnique({
              where: { customerId: order.customerId }
            })
            if (!cart) {
              cart = await tx.cart.create({
                data: { customerId: order.customerId }
              })
            }

            // Thêm lại từng item vào giỏ (nếu đã có thì cộng dồn quantity)
            for (const item of order.orderItems) {
              const existingCartItem = await tx.cartItem.findUnique({
                where: {
                  cartId_voucherProductId: {
                    cartId: cart.id,
                    voucherProductId: item.voucherProductId
                  }
                }
              })

              if (existingCartItem) {
                await tx.cartItem.update({
                  where: { id: existingCartItem.id },
                  data: {
                    quantity: existingCartItem.quantity + item.quantity
                  }
                })
              } else {
                await tx.cartItem.create({
                  data: {
                    cartId: cart.id,
                    voucherProductId: item.voucherProductId,
                    quantity: item.quantity
                  }
                })
              }
            }

            // 2c. Giữ lịch sử thanh toán, đánh dấu các lần thanh toán đang chờ là thất bại.
            await tx.paymentTransaction.updateMany({
              where: {
                orderId: order.id,
                status: 'PENDING'
              },
              data: {
                status: 'FAILED',
                failureReason: 'PAYMENT_TIMEOUT'
              }
            })

            // 2d. Giữ Order và OrderItems để tra cứu lịch sử.
            await tx.order.update({
              where: { id: order.id },
              data: { status: 'CANCELLED' }
            })
          })

          console.log(
            `[OrderCron] Expired order ${order.id} → inventory restored, items returned to cart, order cancelled.`
          )
        } catch (txError) {
          console.error(`[OrderCron] Failed to clean up order ${order.id}:`, txError)
        }
      }
    } catch (error) {
      console.error('[OrderCron] Error running cleanup cron:', error)
    }
  }, ONE_MINUTE)

  console.log('[OrderCron] Order cleanup cron job started (interval: 1 min).')
  return () => clearInterval(timer)
}

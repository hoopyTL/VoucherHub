import { expect, test } from '@playwright/test'

import { E2E_PASSWORD, e2eUsers } from './fixtures/task004'

test('@FLOW-009 admin manages account status and role through the UI', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel(/^Email hoặc số điện thoại\s*\*?$/).fill(e2eUsers.admin.email)
  await page.getByLabel(/^Mật khẩu\s*\*?$/).fill(E2E_PASSWORD)
  await page.getByRole('button', { name: /log in|đăng nhập/i }).click()

  await expect(page).toHaveURL(/\/admin$/)
  await page.getByRole('link', { name: 'Người dùng', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/users$/)
  await expect(page.getByRole('heading', { name: 'Quản lý người dùng' })).toBeVisible()
  await page.getByLabel('Tìm kiếm tài khoản').fill(e2eUsers.lockTarget.email)
  await page.getByRole('button', { name: 'Tìm kiếm' }).click()
  await expect(page.getByText(e2eUsers.lockTarget.fullName)).toBeVisible()

  await page.getByRole('button', { name: `Khóa ${e2eUsers.lockTarget.fullName}` }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Khóa' }).click()
  await expect(page.getByText(`Đã khóa ${e2eUsers.lockTarget.fullName}.`)).toBeVisible()
  await expect(page.getByRole('button', { name: `Mở khóa ${e2eUsers.lockTarget.fullName}` })).toBeVisible()

  await page.getByRole('button', { name: `Mở khóa ${e2eUsers.lockTarget.fullName}` }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Mở khóa' }).click()
  await expect(page.getByText(`Đã mở khóa ${e2eUsers.lockTarget.fullName}.`)).toBeVisible()
  await expect(page.getByRole('button', { name: `Khóa ${e2eUsers.lockTarget.fullName}` })).toBeVisible()

  await page.getByLabel('Tìm kiếm tài khoản').fill(e2eUsers.roleTarget.email)
  await page.getByRole('button', { name: 'Tìm kiếm' }).click()
  const roleTargetRow = page.getByRole('row').filter({ hasText: e2eUsers.roleTarget.fullName })
  await expect(roleTargetRow).toBeVisible()
  await roleTargetRow.getByRole('button', { name: `Đổi vai trò ${e2eUsers.roleTarget.fullName}` }).click()
  await page.getByLabel('Vai trò mới').selectOption('PARTNER')
  const roleResponse = page.waitForResponse(
    (response) => response.url().includes('/api/admin/users/') && response.url().endsWith('/role')
  )
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận đổi' }).click()
  expect((await roleResponse).status()).toBe(200)
  await expect(page.getByText(`Đã đổi vai trò ${e2eUsers.roleTarget.fullName} thành Đối tác.`)).toBeVisible()
  await expect(roleTargetRow).toContainText('Đối tác')

  expect(pageErrors).toEqual([])
})

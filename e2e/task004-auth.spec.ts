import { expect, test } from '@playwright/test'

import { E2E_NEW_PASSWORD, E2E_PASSWORD } from './fixtures/task004'

test('@FLOW-001 password reset request stays generic through the UI', async ({ page }) => {
  await page.goto('/forgot-password')
  await page.getByLabel(/^Email hoặc số điện thoại\s*\*?$/).fill('unknown.browser.e2e@voucherhub.test')
  const resetResponse = page.waitForResponse((response) => response.url().endsWith('/api/auth/password-reset'))
  await page.getByRole('button', { name: 'Gửi yêu cầu khôi phục' }).click()

  expect((await resetResponse).status()).toBe(200)
  await expect(page.getByRole('status')).toContainText('If the account exists')
})

test('@FLOW-001 customer registers, updates profile and changes password through the UI', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/register/customer')
  await page.getByLabel(/^Họ và tên\s*\*?$/).fill('Browser E2E Customer')
  await page.getByLabel(/^Email\s*\*?$/).fill('browser.customer.e2e@voucherhub.test')
  await page.getByLabel(/^Mật khẩu\s*\*?$/).fill(E2E_PASSWORD)

  const registerResponse = page.waitForResponse((response) => response.url().endsWith('/api/auth/register'))
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click()
  expect((await registerResponse).status()).toBe(201)
  await expect(page).toHaveURL(/\/login$/)

  await page.getByLabel(/^Email hoặc số điện thoại\s*\*?$/).fill('browser.customer.e2e@voucherhub.test')
  await page.getByLabel(/^Mật khẩu\s*\*?$/).fill(E2E_PASSWORD)
  await page.getByRole('button', { name: /log in|đăng nhập/i }).click()
  await expect(page).toHaveURL(/\/$/)

  await page.getByRole('link', { name: 'Mở tài khoản' }).click()
  await expect(page.getByRole('heading', { name: 'Browser E2E Customer' })).toBeVisible()

  await page.getByLabel(/Họ và tên/).fill('Browser E2E Customer Updated')
  const profileResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/me') && response.request().method() === 'PATCH'
  )
  await page.getByRole('button', { name: /Lưu hồ sơ/ }).click()
  expect((await profileResponse).status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Browser E2E Customer Updated' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Mở tài khoản' })).toBeVisible()

  await page.getByRole('button', { name: 'Đổi mật khẩu', exact: true }).click()
  await page.locator('input[name="currentPassword"]').fill(E2E_PASSWORD)
  await page.locator('input[name="newPassword"]').fill(E2E_NEW_PASSWORD)
  await page.locator('input[name="confirmNewPassword"]').fill(E2E_NEW_PASSWORD)
  await page.getByRole('tabpanel').getByRole('button', { name: 'Đổi mật khẩu', exact: true }).click()
  await expect(page.getByText('Đổi mật khẩu thành công.')).toBeVisible()

  expect(pageErrors).toEqual([])
})

import { startFreshLogin } from './fixtures/session'
import { expect, test } from '@playwright/test'

import { E2E_PASSWORD, e2eUsers } from './fixtures/task004'

const applicantBase = {
  legalName: 'E2E Partner Applicant',
  representative: 'E2E Representative',
  branchName: 'E2E Registration Branch'
}

async function login(page: import('@playwright/test').Page, email: string) {
  await page.getByLabel(/^Email hoặc số điện thoại\s*\*?$/).fill(email)
  await page.getByLabel(/^Mật khẩu\s*\*?$/).fill(E2E_PASSWORD)
  await page.getByRole('button', { name: /log in|đăng nhập/i }).click()
}

test('@FLOW-005 partner registers, gets approved, then manages branches', async ({ page }, testInfo) => {
  // A failed attempt can already have created the applicant before Playwright
  // retries the complete scenario. Give every retry its own unique account so
  // the next attempt is isolated instead of failing with duplicate email/tax.
  const attempt = `${testInfo.workerIndex}-${testInfo.retry}`
  const applicant = {
    ...applicantBase,
    legalName: `${applicantBase.legalName} ${attempt}`,
    email: `partner-applicant-${attempt}.e2e@voucherhub.test`,
    taxCode: `E2E-TAX-006-${attempt}`
  }

  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/register/partner')
  await page.getByLabel(/^Email\s*\*?$/).fill(applicant.email)
  await page.getByLabel(/^Mật khẩu\s*\*?$/).fill(E2E_PASSWORD)
  await page.getByLabel(/^Tên pháp lý doanh nghiệp\s*\*?$/).fill(applicant.legalName)
  await page.getByLabel(/^Mã số thuế\s*\*?$/).fill(applicant.taxCode)
  await page.getByLabel(/^Họ tên người đại diện\s*\*?$/).fill(applicant.representative)
  await page.getByLabel(/^Tên chi nhánh\s*\*?$/).fill(applicant.branchName)
  await page.getByLabel(/^Địa chỉ\s*\*?$/).fill('6 Integration Street')
  await page.getByLabel(/^Khu vực\s*\*?$/).fill('Hồ Chí Minh')

  const registerResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/partners') && response.request().method() === 'POST'
  )
  await page.getByRole('button', { name: 'Gửi hồ sơ đăng ký' }).click()
  const registration = await registerResponse
  expect(registration.status(), `Partner registration failed: ${await registration.text()}`).toBe(201)
  await expect(page).toHaveURL(/\/login$/)

  const pendingLoginResponse = page.waitForResponse((response) => response.url().endsWith('/api/auth/login'))
  await login(page, applicant.email)
  expect((await pendingLoginResponse).status()).toBe(403)
  await expect(page.getByRole('alert')).toContainText('chờ duyệt')

  await page.goto('/admin/partners')
  await expect(page).toHaveURL(/\/login$/)
  await login(page, e2eUsers.admin.email)
  await expect(page).toHaveURL(/\/admin$/)
  await page.getByRole('link', { name: 'Duyệt đối tác', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/partners$/)
  const applicantRow = page.getByRole('row').filter({ hasText: applicant.email })
  await expect(applicantRow).toBeVisible()

  const approvalResponse = page.waitForResponse(
    (response) => response.url().includes('/api/admin/partners/') && response.url().endsWith('/approval')
  )
  await applicantRow.getByRole('button', { name: `Duyệt ${applicant.legalName}` }).click()
  expect((await approvalResponse).status()).toBe(200)
  await expect(page.getByText(`Đã duyệt ${applicant.legalName}.`)).toBeVisible()

  await startFreshLogin(page)
  await page.goto('/login')
  await login(page, applicant.email)
  await expect(page).toHaveURL(/\/partner$/)
  await page.getByRole('link', { name: 'Chi nhánh', exact: true }).click()
  await expect(page).toHaveURL(/\/partner\/branches$/)
  await expect(page.getByText(applicant.branchName)).toBeVisible()

  await page.getByRole('button', { name: 'Thêm chi nhánh' }).click()
  await page.getByLabel(/^Tên chi nhánh\s*\*?$/).fill('E2E Secondary Branch')
  await page.getByLabel(/^Địa chỉ\s*\*?$/).fill('7 Integration Street')
  await page.getByLabel(/^Khu vực\s*\*?$/).selectOption('Đà Nẵng')
  await page.getByRole('dialog').getByRole('button', { name: 'Thêm chi nhánh' }).click()
  await expect(page.getByText('Đã thêm chi nhánh.')).toBeVisible()

  await page.getByRole('button', { name: 'Chỉnh sửa E2E Secondary Branch' }).click()
  await page.getByLabel(/^Tên chi nhánh\s*\*?$/).fill('E2E Secondary Branch Updated')
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(page.getByText('Đã cập nhật chi nhánh.')).toBeVisible()

  await page.getByRole('button', { name: 'Xóa E2E Secondary Branch Updated' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Xóa' }).click()
  await expect(page.getByText('Đã xóa chi nhánh.')).toBeVisible()
  await expect(page.getByText('E2E Secondary Branch Updated')).not.toBeVisible()
  expect(pageErrors).toEqual([])
})

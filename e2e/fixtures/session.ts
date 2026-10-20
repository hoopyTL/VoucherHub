import { expect, type Page } from '@playwright/test'

/** Isolate the next role by clearing the SPA's tab-local token and reloading.
 * This is test session switching, not a UI logout or revocation assertion. */
export async function startFreshLogin(page: Page) {
  await page.evaluate(() => sessionStorage.removeItem('v_access_token'))
  await page.goto('/login')
  await expect(page.getByLabel(/^Email hoặc số điện thoại\s*\*?$/)).toBeVisible()
}

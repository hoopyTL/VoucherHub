// Vitest global test setup for the client package.
// Cleans up the rendered DOM between tests to avoid cross-test leakage.
import { afterEach, beforeAll, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
// Use the shipped Vietnamese bundle consistently across this suite.
import i18n from './i18n'

const originalWarn = console.warn.bind(console)
beforeEach(() => {
  console.warn = (...args: unknown[]) => {
    const message = String(args[0] ?? '')
    if (message.includes('React Router Future Flag Warning')) return
    originalWarn(...args)
  }
})

beforeAll(async () => {
  await i18n.changeLanguage('vi')
})

afterEach(() => {
  cleanup()
})

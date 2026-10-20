import { readFileSync, existsSync } from 'node:fs'
import assert from 'node:assert/strict'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const major = readFileSync('.nvmrc', 'utf8').trim()
assert.equal(process.versions.node.split('.')[0], major, `Use Node ${major} (nvm use) before running project gates`)
assert.equal(pkg.engines.node, `${major}.x`)
for (const workspace of pkg.workspaces) {
  const manifest = JSON.parse(readFileSync(`${workspace}/package.json`, 'utf8'))
  assert.ok(manifest.scripts.build, `Missing build script: ${workspace}`)
}
for (const name of [
  'ci',
  'test:tooling',
  'db:generate',
  'db:prepare:test',
  'lint',
  'typecheck',
  'typecheck:e2e',
  'build',
  'test:e2e',
  'smoke:runtime',
  'smoke:containers',
  'audit:policy'
]) {
  assert.ok(pkg.scripts[name], `Missing CI script: ${name}`)
}
for (const file of [
  'backend/tsconfig.test.json',
  'e2e/playwright.config.ts',
  'backend/Dockerfile',
  'frontend/Dockerfile',
  'compose.s0.yml'
]) {
  assert.ok(existsSync(file), `Missing runtime/test configuration: ${file}`)
}
console.log(`Runtime/test configuration resolved; Node ${major}; canonical gate npm run ci`)

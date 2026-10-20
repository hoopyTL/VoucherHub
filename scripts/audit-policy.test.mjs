import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const script = path.resolve('scripts/audit-policy.mjs')
const advisory = 'https://example.invalid/advisory'
function run({
  expires = '2999-01-01',
  installed = '1.0.0',
  allowed = true,
  auditError = false,
  transitive = false
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'voucherhub-policy-test-'))
  try {
    mkdirSync(path.join(dir, '.github'))
    const vuln = { severity: 'high', via: [{ url: advisory }] }
    const audit = auditError
      ? { error: { code: 'EAI_AGAIN' } }
      : {
          metadata: { vulnerabilities: { total: transitive ? 2 : 1 } },
          vulnerabilities: {
            vulnerable: vuln,
            ...(transitive ? { parent: { severity: 'high', via: ['vulnerable'] } } : {})
          }
        }
    writeFileSync(path.join(dir, 'audit.json'), JSON.stringify(audit))
    writeFileSync(
      path.join(dir, '.github/dependency-risk-policy.json'),
      JSON.stringify({
        exceptions: allowed ? [{ advisory, packages: { vulnerable: '1.0.0', parent: '2.0.0' }, expires }] : []
      })
    )
    writeFileSync(
      path.join(dir, 'package-lock.json'),
      JSON.stringify({
        packages: { 'node_modules/vulnerable': { version: installed }, 'node_modules/parent': { version: '2.0.0' } }
      })
    )
    writeFileSync(
      path.join(dir, 'npm'),
      '#!/usr/bin/env node\nprocess.stdout.write(require("node:fs").readFileSync("audit.json"));process.exit(1)\n',
      { mode: 0o755 }
    )
    return spawnSync(process.execPath, [script], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` }
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('unknown high advisories fail closed', () => {
  const result = run({ allowed: false })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /no current version-scoped disposition/)
})
test('accepted exact versions remain visibly deferred, including the transitive chain', () => {
  const result = run({ transitive: true })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /DEFERRED/)
  assert.match(result.stdout, /still reports 2 affected package entries/)
})
test('an expired risk disposition fails even without dependency changes', () => {
  assert.equal(run({ expires: '2000-01-01' }).status, 1)
})
test('changing the vulnerable version invalidates the exception', () => {
  assert.equal(run({ installed: '1.0.1' }).status, 1)
})
test('audit network/tool errors never become a green security gate', () => {
  const result = run({ auditError: true })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /gate is not green/)
})

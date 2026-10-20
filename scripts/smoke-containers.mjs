import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const project = `voucherhub-s0-smoke-${process.pid}`
function compose(args, capture = false) {
  const result = spawnSync('docker', ['compose', '-p', project, '-f', 'compose.s0.yml', ...args], {
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Compose ${args[0]} failed (${result.status}): ${result.stderr ?? ''}`)
  return result.stdout?.trim()
}
async function expectStatus(url, status) {
  const allowed = Array.isArray(status) ? status : [status]
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
      if (allowed.includes(res.status)) return res
    } catch {
      /* Wait for the service/proxy readiness transition. */
    }
    await delay(250)
  }
  throw new Error(`Expected ${status} from ${url}`)
}

try {
  compose(['up', '--build', '-d', '--wait'])
  compose([
    'run',
    '--rm',
    '--no-deps',
    'server',
    'node',
    '../node_modules/prisma/build/index.js',
    'migrate',
    'deploy',
    '--schema=prisma/schema.prisma'
  ])
  const api = `http://${compose(['port', 'server', '4000'], true)}`
  const frontend = `http://${compose(['port', 'frontend', '8080'], true)}`
  assert.notEqual(compose(['exec', '-T', 'server', 'id', '-u'], true), '0')
  await expectStatus(`${api}/ready`, 200)
  const spa = await expectStatus(`${frontend}/login`, 200)
  assert.ok((await spa.text()).includes('id="root"'))
  const catalogue = await expectStatus(`${frontend}/api/vouchers`, 200)
  assert.equal((await catalogue.json()).success, true)
  compose(['stop', '-t', '5', 'db'])
  await expectStatus(`${api}/health`, 200)
  await expectStatus(`${api}/ready`, 503)
  compose(['stop', '-t', '12', 'server'])
  const id = compose(['ps', '-a', '-q', 'server'], true)
  const inspected = spawnSync('docker', ['inspect', '--format', '{{.State.ExitCode}}', id], { encoding: 'utf8' })
  assert.equal(inspected.status, 0)
  assert.equal(inspected.stdout.trim(), '0', 'API must drain and exit successfully on SIGTERM')
  // Refused connections yield 502; an unreachable stopped container can time out with 504.
  await expectStatus(`${frontend}/api/vouchers`, [502, 504])
  console.log('Container smoke PASS: non-root API, migrated PostgreSQL, SPA/proxy, DB-down readiness503, SIGTERM exit0')
} finally {
  try {
    compose(['logs', '--no-color'])
  } finally {
    compose(['down', '--volumes', '--remove-orphans'])
  }
}

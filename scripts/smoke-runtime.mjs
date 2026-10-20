import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

async function freePort() {
  const socket = net.createServer()
  socket.listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const port = socket.address().port
  await new Promise((resolve) => socket.close(resolve))
  return port
}

async function smoke(databaseUrl, expectedReadiness) {
  const port = await freePort()
  const child = spawn(process.execPath, ['backend/dist/server.js'], {
    env: { ...process.env, PORT: String(port), NODE_ENV: 'production', DATABASE_URL: databaseUrl },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let logs = ''
  child.stdout.on('data', (data) => {
    logs += data
  })
  child.stderr.on('data', (data) => {
    logs += data
  })
  const exited = once(child, 'exit')
  try {
    const url = `http://127.0.0.1:${port}`
    let booted = false
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`Compiled API exited before boot: ${child.exitCode}`)
      try {
        const res = await fetch(`${url}/health`)
        booted = res.status === 200
        if (booted) break
      } catch {
        /* Retry connection while the process boots. */
      }
      await delay(100)
    }
    assert.ok(booted, 'Compiled API must boot')
    const health = await fetch(`${url}/health`, { headers: { 'X-Request-Id': 'runtime-smoke' } })
    assert.equal(health.headers.get('X-Request-Id'), 'runtime-smoke')
    const ready = await fetch(`${url}/ready`)
    assert.equal(ready.status, expectedReadiness, 'Readiness must reflect database availability')
    if (expectedReadiness === 503) assert.equal((await ready.json()).error.code, 'NOT_READY')
    await fetch(`${url}/private-bearer-value?secret=private-query`)
    const started = performance.now()
    child.kill('SIGTERM')
    const [code, signal] = await Promise.race([
      exited,
      delay(12_000).then(() => {
        throw new Error('SIGTERM did not drain')
      })
    ])
    assert.equal(code, 0, `Graceful shutdown failed: ${signal}`)
    assert.ok(performance.now() - started < 11_000)
    assert.ok(logs.includes('runtime-smoke'), 'Response ID must correlate to access log')
    assert.ok(
      !logs.includes('private-bearer-value') && !logs.includes('private-query'),
      'Access logs must redact user-controlled paths/queries'
    )
    console.log(`Runtime PASS: health200, readiness${expectedReadiness}, requestId/log correlation, SIGTERM exit0`)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
}

assert.ok(process.env.DATABASE_URL, 'Provide an isolated database URL for runtime smoke')
await smoke(process.env.DATABASE_URL, 200)
await smoke('postgresql://unreachable:synthetic@127.0.0.1:1/voucherhub_test?connect_timeout=1', 503)

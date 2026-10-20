import { spawnSync } from 'node:child_process'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const stages = [
  ['run', 'verify:config'],
  ['run', 'test:tooling'],
  ['run', 'db:generate'],
  ['run', 'db:prepare:test'],
  ['run', 'lint'],
  ['run', 'typecheck'],
  ['run', 'typecheck:test', '--workspace=backend'],
  ['run', 'typecheck:e2e'],
  ['run', 'build'],
  ['run', 'test:coverage', '--workspace=backend'],
  ['run', 'test', '--workspace=frontend'],
  ['run', 'test:e2e'],
  ['run', 'smoke:runtime'],
  ['run', 'audit:policy']
]
for (const args of stages) {
  console.log(`\n[CI] ${npm} ${args.join(' ')}`)
  const result = spawnSync(npm, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

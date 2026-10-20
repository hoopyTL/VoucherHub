import { spawnSync } from 'node:child_process'
import { assertTestDatabaseUrl } from '../backend/src/test/database-url'

assertTestDatabaseUrl(process.env.DATABASE_URL)
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(npm, ['run', 'db:deploy', '--workspace=backend'], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1

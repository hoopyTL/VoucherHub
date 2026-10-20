import { spawnSync } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(npm, ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
if (result.error) throw result.error
let audit
try {
  audit = JSON.parse(result.stdout)
} catch {
  throw new Error('npm audit did not return valid JSON; security gate cannot be evaluated')
}
if (audit.error || !audit.metadata || !audit.vulnerabilities)
  throw new Error('npm audit failed; security gate is not green')
mkdirSync('artifacts/security', { recursive: true })
writeFileSync('artifacts/security/npm-audit.json', JSON.stringify(audit, null, 2))
const policy = JSON.parse(readFileSync('.github/dependency-risk-policy.json', 'utf8'))
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
const today = new Date().toISOString().slice(0, 10)
const versions = (name) =>
  new Set(
    Object.entries(lock.packages)
      .filter(([path]) => path.endsWith(`node_modules/${name}`))
      .map(([, item]) => item.version)
  )
function advisories(name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`Cycle in audit dependency graph: ${name}`)
  const next = new Set([...seen, name])
  return audit.vulnerabilities[name].via.flatMap((item) => (typeof item === 'string' ? advisories(item, next) : [item]))
}
const failures = []
for (const [name, item] of Object.entries(audit.vulnerabilities)) {
  for (const advisory of advisories(name)) {
    const entry = policy.exceptions.find((e) => e.advisory === advisory.url && e.packages[name])
    const valid =
      entry &&
      entry.expires >= today &&
      versions(name).size > 0 &&
      [...versions(name)].every((v) => v === entry.packages[name])
    if (!valid) failures.push(`${name} ${item.severity}: ${advisory.url} (no current version-scoped disposition)`)
    else console.log(`DEFERRED until ${entry.expires}: ${name} ${item.severity} ${advisory.url}`)
  }
}
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log(
  `Security policy gate passed; npm audit still reports ${audit.metadata.vulnerabilities.total} affected package entries. Review dispositions before expiry.`
)

#!/usr/bin/env node
/**
 * Stage the Vercel WAF rate-limit rules in firewall/rate-limits.json.
 *
 *   node scripts/firewall-rules.mjs                  # dry run: print the vercel commands, change nothing
 *   node scripts/firewall-rules.mjs --stage          # stage the rules in LOG mode (count, never block)
 *   node scripts/firewall-rules.mjs --stage --enforce  # stage them returning 429 when exceeded
 *
 * Run from packages/website (the directory linked to the Vercel project; `vercel link` first).
 * Staging creates draft changes only. Review with `vercel firewall diff`, then publish yourself
 * with `vercel firewall publish --yes`. Rules that already exist (matched by name) are edited in
 * place, so running it again after changing the JSON updates them.
 *
 * Rollout: stage + publish in log mode, watch Firewall > Traffic for a few days, adjust the
 * numbers in the JSON if real mirrors show up, then re-run with --enforce and publish.
 * See docs/CLOUD_SERVICE.md ("Global rate limits").
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { rules } = JSON.parse(readFileSync(join(root, 'firewall', 'rate-limits.json'), 'utf8'))

const args = new Set(process.argv.slice(2))
const unknown = [...args].filter((a) => !['--stage', '--enforce'].includes(a))
if (unknown.length) {
  console.error(`Unknown option(s): ${unknown.join(' ')}. Use --stage and/or --enforce.`)
  process.exit(2)
}
const stage = args.has('--stage')
const overLimitAction = args.has('--enforce') ? 'rate_limit' : 'log'

for (const r of rules) {
  if (!Number.isInteger(r.window) || r.window < 10 || r.window > 600) {
    throw new Error(`${r.name}: window must be 10-600 s (Pro plan maximum is 10 min)`)
  }
  if (!Number.isInteger(r.requests) || r.requests < 1) throw new Error(`${r.name}: bad requests`)
}

function vercel(cmdArgs, { capture = false } = {}) {
  const res = spawnSync('vercel', cmdArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })
  if (res.error) throw res.error
  if (res.status !== 0) {
    console.error(`vercel ${cmdArgs.slice(0, 3).join(' ')} … failed (exit ${res.status})`)
    process.exit(res.status ?? 1)
  }
  return res.stdout
}

/** Names of the project's existing custom rules. */
function existingRuleNames() {
  const out = vercel(['firewall', 'rules', 'list', '--json'], { capture: true })
  const names = new Set()
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      if (typeof v.name === 'string' && (v.conditionGroup || v.action)) names.add(v.name)
      Object.values(v).forEach(walk)
    }
  }
  walk(JSON.parse(out))
  return names
}

function ruleArgs(r) {
  const a = ['--description', r.description]
  for (const c of r.conditions) a.push('--condition', JSON.stringify(c))
  a.push(
    '--action', 'rate_limit',
    '--rate-limit-window', String(r.window),
    '--rate-limit-requests', String(r.requests),
    '--rate-limit-keys', 'ip',
    '--rate-limit-algo', 'fixed_window',
    '--rate-limit-action', overLimitAction,
    '--yes',
  )
  return a
}

const quote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)

const existing = stage ? existingRuleNames() : new Set()
console.log(`Mode: ${stage ? 'stage' : 'dry run'}, over-limit action: ${overLimitAction}\n`)

for (const r of rules) {
  const cmd = existing.has(r.name)
    ? ['firewall', 'rules', 'edit', r.name, '--enabled', ...ruleArgs(r)]
    : ['firewall', 'rules', 'add', r.name, ...ruleArgs(r)]
  console.log(`# ${r.name}: ${r.requests} req / ${r.window} s per IP`)
  console.log(['vercel', ...cmd].map(quote).join(' ') + '\n')
  if (stage) vercel(cmd)
}

if (stage) {
  vercel(['firewall', 'diff'])
  console.log('\nStaged as drafts. Review the diff above, then publish yourself: vercel firewall publish --yes')
} else {
  console.log('Dry run: nothing changed. Add --stage to stage these as drafts.')
}

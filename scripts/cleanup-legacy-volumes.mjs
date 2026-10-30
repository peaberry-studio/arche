#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const PREFIX = 'arche-opencode-share-'
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
const USAGE = `Usage: node scripts/cleanup-legacy-volumes.mjs --postgres-container NAME [options]

Lists V1 share volumes; dry run is the default. Uses the current Podman connection.
  --database NAME                 PostgreSQL database (default: arche)
  --db-user NAME                  PostgreSQL role (default: postgres)
  --approvals FILE                Operator-verified archive JSON (see infra/README.md)
  --apply                         Remove eligible volumes, without force
  --confirm-retire-v1-rollback     Acknowledge permanent loss of V1 rollback
  --confirm-starts-paused          Confirm all workspace starts/restarts are paused
  --help                          Show this help
`

const SQL = `SELECT json_build_object(
  'instances', (SELECT coalesce(json_agg(json_build_object(
    'slug', slug, 'status', status, 'runtimeKind', runtime_kind
  )), '[]'::json) FROM instances),
  'archives', (SELECT coalesce(json_agg(summary), '[]'::json) FROM (
    SELECT a.slug, count(*)::integer AS count,
      bool_and(jsonb_typeof(a.messages::jsonb) = 'array') AS valid,
      bool_and(a.parent_id IS NULL OR EXISTS (
        SELECT 1 FROM legacy_session_archives parent
        WHERE parent.slug = a.slug AND parent.session_id = a.parent_id
      )) AS "parentsPresent"
    FROM legacy_session_archives a GROUP BY a.slug
  ) summary)
);`

function podman(args) {
  return execFileSync('podman', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function parseOptions(args) {
  const options = { database: 'arche', dbUser: 'postgres', apply: false }
  const values = { '--postgres-container': 'postgresContainer', '--database': 'database', '--db-user': 'dbUser', '--approvals': 'approvals' }
  const flags = { '--apply': 'apply', '--confirm-retire-v1-rollback': 'retireRollback', '--confirm-starts-paused': 'startsPaused' }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--help') return { help: true }
    if (Object.hasOwn(flags, arg)) options[flags[arg]] = true
    else if (Object.hasOwn(values, arg) && args[index + 1] && !args[index + 1].startsWith('-')) options[values[arg]] = args[++index]
    else throw new Error(`Unknown option or missing value: ${arg}`)
  }
  if (!options.postgresContainer) throw new Error('--postgres-container is required; select the database for this Podman host explicitly')
  if (options.apply && (!options.retireRollback || !options.startsPaused || !options.approvals)) {
    throw new Error('--apply requires --approvals, --confirm-retire-v1-rollback and --confirm-starts-paused')
  }
  return options
}

function readApprovals(path) {
  if (!path) return []
  const approvals = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(approvals) || approvals.some((entry) => !entry ||
    typeof entry.slug !== 'string' || entry.slug.length > 32 || !SLUG_PATTERN.test(entry.slug) ||
    entry.archiveComplete !== true || !Number.isSafeInteger(entry.archivedSessionCount) || entry.archivedSessionCount < 1) ||
    new Set(approvals.map((entry) => entry.slug)).size !== approvals.length) {
    throw new Error('Invalid approvals: expected unique slugs, archiveComplete: true and positive archivedSessionCount')
  }
  return approvals
}

function readDatabase(options) {
  const result = JSON.parse(podman(['exec', options.postgresContainer, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-U', options.dbUser, '-d', options.database, '-c', SQL]))
  if (!result || !Array.isArray(result.instances) || !Array.isArray(result.archives) ||
    result.instances.some((row) => !row || typeof row.slug !== 'string' || typeof row.status !== 'string' ||
      !(row.runtimeKind === null || typeof row.runtimeKind === 'string')) ||
    result.archives.some((row) => !row || typeof row.slug !== 'string' || !Number.isSafeInteger(row.count) || row.count < 1 ||
      typeof row.valid !== 'boolean' || typeof row.parentsPresent !== 'boolean') ||
    new Set(result.instances.map((row) => row.slug)).size !== result.instances.length ||
    new Set(result.archives.map((row) => row.slug)).size !== result.archives.length) {
    throw new Error('Unexpected database result; refusing cleanup')
  }
  return result
}

function blockedReason(volume, snapshot, approvals) {
  if (snapshot.instances.some((row) => row.status === 'starting')) return 'a workspace is starting'
  if (snapshot.instances.some((row) => row.status === 'running' && row.runtimeKind !== 'opencode-v2')) return 'a non-V2 workspace is running'
  const slug = volume.slice(PREFIX.length)
  if (slug.length > 32 || !SLUG_PATTERN.test(slug)) return 'unrecognized workspace slug'
  const instance = snapshot.instances.find((row) => row.slug === slug)
  if (!instance || instance.runtimeKind !== 'opencode-v2') return 'instance is not recorded as V2'
  if (!['running', 'stopped'].includes(instance.status)) return 'instance is not in a stable running/stopped state'
  const archive = snapshot.archives.find((row) => row.slug === slug)
  if (!archive) return 'no archived sessions (empty/unverified workspaces are retained)'
  if (!archive.valid || !archive.parentsPresent) return 'invalid or incomplete archive'
  const approval = approvals.find((row) => row.slug === slug)
  if (!approval) return 'final archive completeness has not been operator-verified'
  if (approval.archivedSessionCount !== archive.count) return 'archive count differs from operator verification'
  if (podman(['ps', '--all', '--filter', `volume=${volume}`, '--format', '{{.ID}}'])) return 'attached to a container (including stopped containers)'
  return null
}

function main() {
  const options = parseOptions(process.argv.slice(2))
  if (options.help) return console.log(USAGE)
  const approvals = readApprovals(options.approvals)
  const snapshot = readDatabase(options)
  const volumes = podman(['volume', 'ls', '--format', '{{.Name}}']).split('\n').filter((name) => name.startsWith(PREFIX)).sort()
  console.log(`${options.apply ? 'APPLY' : 'DRY RUN'}: V1 rollback data only; no archive rows or V2 volumes are removed.`)
  for (const volume of volumes) {
    const reason = blockedReason(volume, snapshot, approvals)
    if (reason) {
      console.log(`KEEP ${volume}: ${reason}`)
      continue
    }
    if (!options.apply) {
      console.log(`WOULD DELETE ${volume}`)
      continue
    }
    const currentReason = blockedReason(volume, readDatabase(options), readApprovals(options.approvals))
    if (currentReason) throw new Error(`Eligibility changed for ${volume}: ${currentReason}`)
    podman(['volume', 'rm', volume])
    console.log(`DELETED ${volume}`)
  }
  if (!volumes.length) console.log('No V1 share volumes found.')
}

try {
  main()
} catch (error) {
  console.error(`Cleanup refused: ${error.message}`)
  process.exitCode = 1
}

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const SCRIPT = fileURLToPath(new URL('../cleanup-legacy-volumes.mjs', import.meta.url))
const VOLUME = 'arche-opencode-share-alice'
const APPLY = ['--apply', '--confirm-retire-v1-rollback', '--confirm-starts-paused']
const APPROVALS = [{ slug: 'alice', archiveComplete: true, archivedSessionCount: 2 }]
const SNAPSHOT = {
  instances: [{ slug: 'alice', runtimeKind: 'opencode-v2', status: 'stopped' }],
  archives: [{ slug: 'alice', count: 2, valid: true, parentsPresent: true }],
}

const FAKE_PODMAN = `#!/usr/bin/env node
const fs = require('node:fs')
const path = process.env.CLEANUP_TEST_STATE
const state = JSON.parse(fs.readFileSync(path, 'utf8'))
const args = process.argv.slice(2)
state.calls.push(args)
fs.writeFileSync(path, JSON.stringify(state))
const command = args.slice(0, 2).join(' ')
if (state.fail === args[0] || state.fail === command) process.exit(17)
if (args[0] === 'exec') {
  const reads = state.calls.filter(call => call[0] === 'exec').length
  const snapshot = reads > 1 && state.nextSnapshot ? state.nextSnapshot : state.snapshot
  console.log(state.rawDatabase ?? JSON.stringify(snapshot))
} else if (command === 'volume ls') {
  console.log(state.volumes.join('\\n'))
} else if (args[0] === 'ps') {
  const reads = state.calls.filter(call => call[0] === 'ps').length
  console.log(reads > 1 ? (state.nextAttachment ?? state.attachment ?? '') : (state.attachment ?? ''))
} else if (command === 'volume rm') {
  if (args.length !== 3 || args[2] !== '${VOLUME}') process.exit(18)
} else process.exit(19)
`

function run({ state = {}, approvals = APPROVALS, args = [], includeApprovals = true } = {}) {
  const directory = mkdtempSync(fileURLToPath(new URL('.cleanup-legacy-volumes-', import.meta.url)))
  try {
    const statePath = join(directory, 'state.json')
    const approvalsPath = join(directory, 'approvals.json')
    writeFileSync(statePath, JSON.stringify({ calls: [], snapshot: SNAPSHOT, volumes: [VOLUME], ...state }))
    writeFileSync(approvalsPath, JSON.stringify(approvals))
    writeFileSync(join(directory, 'podman'), FAKE_PODMAN)
    chmodSync(join(directory, 'podman'), 0o700)
    const result = spawnSync(process.execPath, [SCRIPT, '--postgres-container', 'test-db',
      ...(includeApprovals ? ['--approvals', approvalsPath] : []), ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}${delimiter}${process.env.PATH}`, CLEANUP_TEST_STATE: statePath },
    })
    return { ...result, calls: JSON.parse(readFileSync(statePath, 'utf8')).calls }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function removals(result) {
  return result.calls.filter((args) => args[0] === 'volume' && args[1] === 'rm')
}

test('defaults to dry run and only lists exact V1 share volumes', () => {
  const result = run({ state: { volumes: [VOLUME, 'arche-opencode2-share-alice', 'arche-workspace-alice', 'unrelated', 'arche-opencode-share-../unsafe'] } })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /DRY RUN/)
  assert.match(result.stdout, /WOULD DELETE arche-opencode-share-alice/)
  assert.match(result.stdout, /unrecognized workspace slug/)
  assert.doesNotMatch(result.stdout, /opencode2|arche-workspace|unrelated/)
  assert.deepEqual(removals(result), [])
  const query = result.calls.find((args) => args[0] === 'exec')
  assert.deepEqual(query.slice(0, 3), ['exec', 'test-db', 'psql'])
  assert.ok(query.includes('-X'))
  assert.ok(query.includes('ON_ERROR_STOP=1'))
  assert.match(query.at(-1), /FROM legacy_session_archives/)
  assert.doesNotMatch(query.at(-1), /\b(DELETE|INSERT|UPDATE|DROP)\b/i)
})

test('requires explicit final-archive attestation even with archive rows', () => {
  const result = run({ includeApprovals: false })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /completeness has not been operator-verified/)
  assert.deepEqual(removals(result), [])
})

test('recognizes the existing workspace slug rules, including consecutive hyphens', () => {
  const slug = 'ali--ce'
  const result = run({
    approvals: [{ ...APPROVALS[0], slug }],
    state: {
      volumes: [`arche-opencode-share-${slug}`],
      snapshot: {
        instances: [{ ...SNAPSHOT.instances[0], slug }],
        archives: [{ ...SNAPSHOT.archives[0], slug }],
      },
    },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /WOULD DELETE arche-opencode-share-ali--ce/)
  assert.deepEqual(removals(result), [])
})

test('apply requires every destructive-operation guard before contacting Podman', () => {
  for (const options of [
    { args: ['--apply'] },
    { args: ['--apply', '--confirm-retire-v1-rollback'] },
    { args: ['--apply', '--confirm-starts-paused'] },
    { args: APPLY, includeApprovals: false },
  ]) {
    const result = run(options)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /--apply requires/)
    assert.deepEqual(result.calls, [])
  }
})

test('apply rechecks state and attachments and uses only non-forced volume removal', () => {
  const result = run({ args: APPLY })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /DELETED arche-opencode-share-alice/)
  assert.deepEqual(removals(result), [['volume', 'rm', VOLUME]])
  assert.equal(result.calls.filter((args) => args[0] === 'exec').length, 2)
  const attachments = result.calls.filter((args) => args[0] === 'ps')
  assert.equal(attachments.length, 2)
  assert.ok(attachments.every((args) => args.includes('--all') && args.includes(`volume=${VOLUME}`)))
})

test('retains missing, V1/null/unknown-runtime, starting and error instances', () => {
  for (const instances of [
    [],
    [{ slug: 'alice', runtimeKind: null, status: 'stopped' }],
    [{ slug: 'alice', runtimeKind: 'opencode-v1', status: 'stopped' }],
    [{ slug: 'alice', runtimeKind: 'unknown', status: 'stopped' }],
    [{ slug: 'alice', runtimeKind: 'opencode-v2', status: 'starting' }],
    [{ slug: 'alice', runtimeKind: 'opencode-v2', status: 'error' }],
  ]) {
    const result = run({ args: APPLY, state: { snapshot: { ...SNAPSHOT, instances } } })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /KEEP /)
    assert.deepEqual(removals(result), [])
  }
})

test('any running non-V2 or starting workspace blocks cleanup globally', () => {
  for (const other of [
    { slug: 'bob', runtimeKind: 'opencode-v1', status: 'running' },
    { slug: 'bob', runtimeKind: null, status: 'running' },
    { slug: 'bob', runtimeKind: 'opencode-v2', status: 'starting' },
  ]) {
    const result = run({ args: APPLY, state: { snapshot: { ...SNAPSHOT, instances: [...SNAPSHOT.instances, other] } } })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /KEEP /)
    assert.deepEqual(removals(result), [])
  }
})

test('retains absent, structurally incomplete and count-mismatched archives', () => {
  for (const archives of [[],
    [{ ...SNAPSHOT.archives[0], valid: false }],
    [{ ...SNAPSHOT.archives[0], parentsPresent: false }],
    [{ ...SNAPSHOT.archives[0], count: 1 }],
  ]) {
    const result = run({ args: APPLY, state: { snapshot: { ...SNAPSHOT, archives } } })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /KEEP /)
    assert.deepEqual(removals(result), [])
  }
})

test('retains volumes attached to any container, including stopped helpers', () => {
  const result = run({ args: APPLY, state: { attachment: 'stopped-archive-helper' } })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /attached to a container/)
  assert.deepEqual(removals(result), [])
})

test('aborts if eligibility changes immediately before deletion', () => {
  for (const state of [
    { nextAttachment: 'new-container' },
    { nextSnapshot: { ...SNAPSHOT, instances: [{ ...SNAPSHOT.instances[0], runtimeKind: 'opencode-v1' }] } },
    { nextSnapshot: { ...SNAPSHOT, archives: [] } },
  ]) {
    const result = run({ args: APPLY, state })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Eligibility changed/)
    assert.deepEqual(removals(result), [])
  }
})

test('fails closed on database, listing, attachment and removal failures', () => {
  for (const fail of ['exec', 'volume ls', 'ps', 'volume rm']) {
    const result = run({ args: APPLY, state: { fail } })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Cleanup refused/)
    assert.doesNotMatch(result.stdout, /DELETED/)
    if (fail !== 'volume rm') assert.deepEqual(removals(result), [])
  }
})

test('rejects malformed database results and approvals', () => {
  for (const rawDatabase of ['not-json', '{}', '{"instances":[],"archives":[{}]}',
    JSON.stringify({ ...SNAPSHOT, instances: [SNAPSHOT.instances[0], SNAPSHOT.instances[0]] })]) {
    const result = run({ args: APPLY, state: { rawDatabase } })
    assert.equal(result.status, 1)
    assert.deepEqual(removals(result), [])
  }
  for (const approvals of [{}, [{ ...APPROVALS[0], archiveComplete: false }],
    [{ ...APPROVALS[0], archivedSessionCount: 0 }], [...APPROVALS, ...APPROVALS]]) {
    const result = run({ args: APPLY, approvals })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Invalid approvals/)
    assert.deepEqual(result.calls, [])
  }
})

test('handles an empty volume inventory without removing anything', () => {
  const result = run({ state: { volumes: [] } })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /No V1 share volumes found/)
  assert.deepEqual(removals(result), [])
})

test('accepts stable running V2 and passes explicit database selection without a shell', () => {
  const result = run({ args: [...APPLY, '--database', 'other-db', '--db-user', 'read-only'],
    state: { snapshot: { ...SNAPSHOT, instances: [{ ...SNAPSHOT.instances[0], status: 'running' }] } } })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(removals(result), [['volume', 'rm', VOLUME]])
  assert.ok(result.calls.find((args) => args[0] === 'exec').includes('other-db'))
  assert.ok(result.calls.find((args) => args[0] === 'exec').includes('read-only'))
})

test('help and invalid arguments do not contact Podman', () => {
  const help = run({ args: ['--help'] })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /dry run is the default/)
  assert.deepEqual(help.calls, [])
  for (const args of [['--unknown'], ['--database']]) {
    const result = run({ args })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Unknown option or missing value/)
    assert.deepEqual(result.calls, [])
  }
})

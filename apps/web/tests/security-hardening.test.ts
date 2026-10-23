import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

const root = resolve(process.cwd(), '../..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

describe('security deployment invariants', () => {
  it.each([
    ...[
      ['apiKey', 'hasApiKey'],
      ['password', 'hasPassword'],
      ['clientSecret', 'hasClientSecret'],
      ['accessToken', 'hasAccessToken'],
    ].map(([key, flag]) => [`${key}: '${flag}',`, true] as const),
    [`apiKey: '${'credential'.repeat(3)}',`, false],
    [`apiKey: '${'hasApiKey'}', token: '${'ghp_'}${'a'.repeat(36)}'`, false],
    [`const token = '${'ghp_'}${'a'.repeat(36)}'`, false],
  ])('distinguishes public flag mappings from credentials: %s', (line, allowed) => {
    const workflow = parse(read('.github/workflows/pr-governance.yml'))
    const step = workflow.jobs['security-scan'].steps.find((entry: { name: string }) => entry.name === 'Scan for hardcoded secrets')
    const result = spawnSync('bash', ['-e', '-c', `git() { printf '%s\\n' "$SCAN_DIFF"; }; ${step.run}`], {
      env: { ...process.env, CHANGED_FILES: 'fixture.ts', SCAN_DIFF: `+  ${line}` },
      encoding: 'utf8',
    })
    expect(result.status, result.stdout + result.stderr).toBe(allowed ? 0 : 1)
  })

  it('loads dotenv values without executing command substitutions', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'arche-dotenv-'))
    const marker = resolve(directory, 'executed')
    const value = `$(touch ${marker})`
    writeFileSync(resolve(directory, '.env'), `ARCHE_TEST_VALUE="${value}"\n`)
    const deploy = read('infra/deploy/deploy.sh')
    const start = deploy.indexOf('if [[ "$MODE" != "local-dev-down" && -f "$SCRIPT_DIR/.env" ]]')
    const end = deploy.indexOf('\nfi', start) + 3
    expect(start).toBeGreaterThan(0)
    try {
      const result = execFileSync('bash', ['-c', `set -eu; log() { :; }; err() { :; }; MODE=remote; SCRIPT_DIR="$1"; ${deploy.slice(start, end)}\nprintf '%s' "$ARCHE_TEST_VALUE"`, 'test', directory], { encoding: 'utf8' })
      expect(result).toBe(value)
      expect(existsSync(marker)).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.each(['infra/compose/compose.yaml', 'infra/coolify/docker-compose.yml'])('isolates the socket proxy in %s', (file) => {
    const compose = parse(read(file))
    expect(compose.services['docker-socket-proxy'].networks).toEqual(['arche-control'])
    expect(compose.services.web.networks).toContain('arche-control')
    expect(compose.networks['arche-control'].internal).toBe(true)
    expect(compose.services['docker-socket-proxy'].ports).toBeUndefined()
    expect(compose.services['docker-socket-proxy'].image).toMatch(/@sha256:[a-f0-9]{64}$/)
  })

  it('requires SSH host verification and pinned install dependencies', () => {
    expect(read('infra/deploy/ansible.cfg')).toContain('host_key_checking = True')
    const workflow = read('.github/workflows/build-and-deploy.yml')
    expect(workflow).toContain('VPS_KNOWN_HOSTS')
    expect(workflow).not.toContain('ssh-keyscan')
    expect(workflow).toContain('pip install --require-hashes')
  })

  describe.each(['build-push.yml', 'build-push-workspace.yml'])('%s dispatch validation', (file) => {
  it.each([
    ['owner/repo', 'a'.repeat(40), true],
    ['attacker/fork', 'a'.repeat(40), false],
    ['owner/repo', 'b'.repeat(40), false],
  ])('validates dispatched build repository %s and immutable head %s', async (repository, ref, allowed) => {
    const workflow = parse(read(`.github/workflows/${file}`))
    const script = workflow.jobs['build-and-push'].steps[0].with.script
    const permission = vi.fn()
    const output = vi.fn()
    const github = { rest: {
      repos: { getCollaboratorPermissionLevel: permission },
      pulls: { get: async () => ({ data: { number: 1, head: { repo: { full_name: repository }, sha: 'a'.repeat(40) } } }) },
    } }
    const run = new Function('github', 'context', 'core', `return (async () => {${script}})()`)
    const result = run(github, { repo: { owner: 'owner', repo: 'repo' }, actor: 'github-actions[bot]', eventName: 'repository_dispatch', payload: { client_payload: { pr_number: 1, ref } } }, { setOutput: output })
    if (allowed) {
      await result
      expect(output).toHaveBeenCalledWith('ref', 'a'.repeat(40))
      expect(permission).not.toHaveBeenCalled()
    } else await expect(result).rejects.toThrow()
  })

  })

  it.each([
    ['read', 'owner/repo', false],
    ['write', 'attacker/fork', false],
    ['write', 'owner/repo', true],
  ])('gates /build for permission %s and repository %s', async (permission, repository, allowed) => {
    const workflow = parse(read('.github/workflows/pr-commands.yml'))
    const script = workflow.jobs['handle-build-command'].steps[0].with.script
    const dispatch = vi.fn()
    const failed = vi.fn()
    const github = { rest: {
      repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission } }), createDispatchEvent: dispatch },
      pulls: { get: async () => ({ data: { number: 1, head: { repo: { full_name: repository }, sha: 'a'.repeat(40), ref: "branch';touch /tmp/unsafe;'" } } }) },
      reactions: { createForIssueComment: vi.fn() },
    } }
    const run = new Function('github', 'context', 'core', `return (async () => {${script}})()`)
    await run(github, { repo: { owner: 'owner', repo: 'repo' }, issue: { number: 1 }, payload: { comment: { body: '/build', id: 2, user: { login: 'actor' } } } }, { setFailed: failed })
    expect(dispatch).toHaveBeenCalledTimes(allowed ? 1 : 0)
    if (allowed) expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ client_payload: { pr_number: 1, ref: 'a'.repeat(40) } }))
    else expect(failed).toHaveBeenCalledOnce()
  })
})


describe('supply chain and ingress regressions', () => {
  it('pins every external workflow action to a complete commit', () => {
    for (const file of readdirSync(resolve(root, '.github/workflows')).filter((name) => name.endsWith('.yml'))) {
      for (const match of read(`.github/workflows/${file}`).matchAll(/uses:\s+([^\s#]+)/g)) {
        if (match[1].startsWith('./')) continue
        expect(match[1], file).toMatch(/@[a-f0-9]{40}$/)
      }
    }
  })
  it('fails installation before copying a binary when provenance verification rejects it', () => {
    const script = read('install.sh')
    const block = script.slice(script.indexOf('  gh attestation verify'), script.indexOf('  note "Installing'))
    const result = spawnSync('bash', ['-c', `fail() { exit 73; }; gh() { return 1; }; tmp_bin=fixture; ${block}\nexit 0`])
    expect(result.status).toBe(73)
    expect(block).toContain('--signer-workflow peaberry-studio/arche/.github/workflows/release-archectl.yml')
    expect(block).toContain('--deny-self-hosted-runners')
  })
  it('configures an authenticated ingress and excludes internal APIs on the production router', () => {
    const tasks = read('infra/deploy/ansible/roles/app/tasks/main.yml')
    expect(tasks).toContain('!PathPrefix(`/api/internal`)')
    expect(tasks).toContain('customrequestheaders.X-Arche-Ingress=')
    expect(tasks).toContain('ratelimit.average=100')
    expect(read('infra/deploy/ansible/roles/app/templates/.env.j2')).toContain('ARCHE_INGRESS_SECRET=')
  })
})


it('retains OCI child manifests and signatures when cleaning registry versions', () => {
  const source = read('.github/workflows/ghcr-retention.yml')
  const start = source.indexOf('            # Keep content-addressed')
  const end = source.indexOf('            sort -u "$keep_ids_file"', start)
  const directory = mkdtempSync(resolve(tmpdir(), 'arche-retention-'))
  try {
    writeFileSync(resolve(directory, 'versions.json'), JSON.stringify([
      { id: 1, tags: [], updated_at: '2026-01-01' },
      { id: 2, tags: ['sha256-abc.sig'], updated_at: '2026-01-01' },
      { id: 3, tags: ['latest-arm64'], updated_at: '2026-01-01' },
      { id: 4, tags: ['v1.2.3-arm64'], updated_at: '2026-01-01' },
      { id: 5, tags: ['pr-1'], updated_at: '2026-01-01' },
    ]))
    const result = execFileSync('bash', ['-e', '-c', `versions_json="$1/versions.json"; keep_ids_file="$1/keep"; open_prs_json='[]'; ${source.slice(start, end)}\ncat "$keep_ids_file"`, 'test', directory], { encoding: 'utf8' })
    expect(new Set(result.trim().split('\n'))).toEqual(new Set(['1', '2', '3', '4']))
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

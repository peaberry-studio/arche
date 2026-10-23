import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { approveKbProposal, getKbProposal, ZERO_OID } from '@/lib/git/kb-publication'

import { serveKbGit } from '@/lib/git/kb-http-backend'

let directory: string | undefined

afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

describe('KB Git broker', () => {
  it.each(['../config', 'config', 'HEAD', 'hooks/pre-receive', 'git-upload-pack'])('does not expose %s', async (path) => {
    const result = await serveKbGit(new Request('http://localhost/'), '/unused', path, 'alice')
    expect(result.status).toBe(404)
  })

  it('supports a real Git push without executing writable repository hooks', async () => {
    directory = await mkdtemp(join(tmpdir(), 'arche-kb-broker-'))
    const repository = join(directory, 'kb.git')
    const source = join(directory, 'source')
    const git = (args: string[], cwd = directory) => execFileSync('git', args, { cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } })
    git(['init', '--bare', repository])
    git(['init', '-b', 'main', source])
    await writeFile(join(source, 'note.md'), 'shared knowledge')
    git(['add', 'note.md'], source)
    git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'test'], source)
    const commit = git(['rev-parse', 'HEAD'], source).toString().trim()
    const marker = join(directory, 'hook-ran')
    await writeFile(join(repository, 'hooks/pre-receive'), `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o755 })
    const advertisement = await serveKbGit(new Request('http://localhost/info/refs?service=git-receive-pack'), repository, 'info/refs', 'alice')
    expect(advertisement.status).toBe(200)
    expect(await advertisement.text()).toContain('# service=git-receive-pack')
    const accepted = vi.fn()
    const command = `${'0'.repeat(40)} ${commit} refs/heads/proposals/alice/pending\0report-status\n`
    const packet = Buffer.from((Buffer.byteLength(command) + 4).toString(16).padStart(4, '0') + command + '0000')
    const pack = execFileSync('git', ['pack-objects', '--stdout', '--revs'], { cwd: source, input: `${commit}\n` })
    const result = await serveKbGit(new Request('http://localhost/git-receive-pack', {
      method: 'POST', headers: { 'content-type': 'application/x-git-receive-pack-request' },
      body: Buffer.concat([packet, pack]),
    }), repository, 'git-receive-pack', 'alice', accepted)
    expect(result.status).toBe(200)
    expect(await result.text()).toContain('ok refs/heads/proposals/alice/pending')
    expect(git(['--git-dir', repository, 'rev-parse', 'refs/heads/proposals/alice/pending']).toString().trim()).toBe(commit)
    expect(accepted).toHaveBeenCalledWith({ ref: 'refs/heads/proposals/alice/pending', commit, paths: ['note.md'] })
    expect(() => git(['--git-dir', repository, 'rev-parse', '--verify', 'main'])).toThrow()
    const proposal = await getKbProposal(repository, 'alice')
    expect(proposal?.diff).toContain('shared knowledge')
    await expect(approveKbProposal(repository, 'alice', '1'.repeat(40), ZERO_OID)).rejects.toThrow('proposal_changed')
    await approveKbProposal(repository, 'alice', commit, ZERO_OID)
    expect(git(['--git-dir', repository, 'rev-parse', 'main']).toString().trim()).toBe(commit)
    await expect(readFile(marker)).rejects.toThrow()
  })
})

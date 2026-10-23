import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { serveKbGit } from '@/lib/git/kb-http-backend'

let directory: string | undefined

afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

describe('KB Git broker', () => {
  it.each(['../config', 'config', 'HEAD', 'hooks/pre-receive', 'git-upload-pack'])('does not expose %s', async (path) => {
    const result = await serveKbGit(new Request('http://localhost/'), '/unused', path)
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
    const advertisement = await serveKbGit(new Request('http://localhost/info/refs?service=git-receive-pack'), repository, 'info/refs')
    expect(advertisement.status).toBe(200)
    expect(await advertisement.text()).toContain('# service=git-receive-pack')
    const command = `${'0'.repeat(40)} ${commit} refs/heads/main\0report-status\n`
    const packet = Buffer.from((Buffer.byteLength(command) + 4).toString(16).padStart(4, '0') + command + '0000')
    const pack = execFileSync('git', ['pack-objects', '--stdout', '--revs'], { cwd: source, input: `${commit}\n` })
    const result = await serveKbGit(new Request('http://localhost/git-receive-pack', {
      method: 'POST', headers: { 'content-type': 'application/x-git-receive-pack-request' },
      body: Buffer.concat([packet, pack]),
    }), repository, 'git-receive-pack')
    expect(result.status).toBe(200)
    expect(await result.text()).toContain('ok refs/heads/main')
    expect(git(['--git-dir', repository, 'rev-parse', 'main']).toString().trim()).toBe(commit)
    await expect(readFile(marker)).rejects.toThrow()
  })
})

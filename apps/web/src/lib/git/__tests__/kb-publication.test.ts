import { execFile, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { serveKbGit } from '@/lib/git/kb-http-backend'
import { approveKbProposal, getKbProposal, proposalRef, readKbRef, withKbLock, ZERO_OID } from '@/lib/git/kb-publication'

let root: string
let repository: string
let source: string
let base: string
const git = (args: string[], cwd = source, input?: string | Buffer) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
  cwd, input, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, stdio: ['pipe', 'pipe', 'pipe'],
})
const commit = () => {
  git(['add', '-A'])
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'change'])
  return git(['rev-parse', 'HEAD']).toString().trim()
}
const accepted = vi.fn()
async function push(hash: string, ref = proposalRef('alice'), old = ZERO_OID) {
  const command = `${old} ${hash} ${ref}\0report-status\n`
  const packet = Buffer.from((Buffer.byteLength(command) + 4).toString(16).padStart(4, '0') + command + '0000')
  const pack = hash === ZERO_OID ? Buffer.alloc(0) : git(['pack-objects', '--stdout', '--revs'], source, `${hash}\n`)
  return serveKbGit(new Request('http://localhost/git-receive-pack', {
    method: 'POST', headers: { 'content-type': 'application/x-git-receive-pack-request' }, body: Buffer.concat([packet, pack]),
  }), repository, 'git-receive-pack', 'alice', accepted)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'arche-publication-test-'))
  repository = join(root, 'kb.git')
  source = join(root, 'workspace')
  git(['init', '--bare', '-b', 'main', repository], root)
  git(['init', '-b', 'main', source], root)
  await writeFile(join(source, 'note.md'), 'original\n')
  base = commit()
  git(['push', repository, 'HEAD:refs/heads/main'])
  accepted.mockReset()
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('KB publication authorization', () => {
  it('supports the actual Git smart-HTTP client while main stays unchanged until approval', async () => {
    const server = createServer(async (request, response) => {
      try {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const url = new URL(request.url ?? '/', 'http://localhost')
        const result = await serveKbGit(new Request(url, {
          method: request.method,
          headers: { 'content-type': request.headers['content-type'] ?? '' },
          ...(request.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
        }), repository, url.pathname.slice(1), 'alice', accepted)
        response.writeHead(result.status, Object.fromEntries(result.headers))
        response.end(Buffer.from(await result.arrayBuffer()))
      } catch { response.writeHead(400); response.end('rejected') }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('missing_test_address')
      await writeFile(join(source, 'note.md'), 'real client\n')
      const hash = commit()
      await promisify(execFile)('git', ['push', `http://127.0.0.1:${address.port}`, `HEAD:${proposalRef('alice')}`], { cwd: source })
      expect(await readKbRef(repository, 'refs/heads/main')).toBe(base)
      expect(await readKbRef(repository, proposalRef('alice'))).toBe(hash)
      await approveKbProposal(repository, 'alice', hash, base)
      expect(await readKbRef(repository, 'refs/heads/main')).toBe(hash)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
  it.each(['refs/heads/main', 'refs/heads/proposals/bob/pending', 'refs/tags/release', 'refs/replace/test', 'refs/heads/proposals/alice/../../main'])('rejects workspace writes to %s', async (ref) => {
    await writeFile(join(source, 'note.md'), 'attacker\n')
    await expect(push(commit(), ref)).rejects.toThrow()
    expect(await readKbRef(repository, 'refs/heads/main')).toBe(base)
    expect(accepted).not.toHaveBeenCalled()
  })

  it('requires exact commit and base approval, and audits the accepted ref and paths', async () => {
    await writeFile(join(source, 'note.md'), 'review me\n')
    const hash = commit()
    expect((await push(hash)).ok).toBe(true)
    expect(await readKbRef(repository, 'refs/heads/main')).toBe(base)
    expect(accepted).toHaveBeenCalledWith({ ref: proposalRef('alice'), commit: hash, paths: ['note.md'] })
    const proposal = await getKbProposal(repository, 'alice')
    expect(proposal).toMatchObject({ commit: hash, base, paths: ['note.md'] })
    await expect(approveKbProposal(repository, 'alice', hash, ZERO_OID)).rejects.toThrow('proposal_changed')
    await approveKbProposal(repository, 'alice', hash, base)
    expect(await readKbRef(repository, 'refs/heads/main')).toBe(hash)
    expect(await getKbProposal(repository, 'alice')).toBeNull()
  })

  it('invalidates a review when another proposal commit arrives', async () => {
    await writeFile(join(source, 'note.md'), 'first\n')
    const first = commit()
    await push(first)
    await writeFile(join(source, 'note.md'), 'changed after review\n')
    const second = commit()
    await push(second, proposalRef('alice'), first)
    await expect(approveKbProposal(repository, 'alice', first, base)).rejects.toThrow('proposal_changed')
    expect(await readKbRef(repository, 'refs/heads/main')).toBe(base)
  })

  it('rejects ref deletion and non-fast-forward updates', async () => {
    await writeFile(join(source, 'note.md'), 'first\n')
    const first = commit()
    await push(first)
    await expect(push(ZERO_OID, proposalRef('alice'), first)).rejects.toThrow()
    git(['reset', '--hard', base])
    await writeFile(join(source, 'note.md'), 'unrelated edit\n')
    const response = await push(commit(), proposalRef('alice'), first)
    expect(await response.text()).toContain('non-fast-forward')
    expect(await readKbRef(repository, proposalRef('alice'))).toBe(first)
  })

  it.each(['.gitmodules', '.hidden/file', 'hooks/pre-receive', 'AGENTS.md', 'opencode.json'])('rejects forbidden content %s before updating any shared ref', async (path) => {
    await mkdir(join(source, path, '..'), { recursive: true })
    await writeFile(join(source, path), 'untrusted')
    await expect(push(commit())).rejects.toThrow('invalid_proposal_path')
    expect(await readKbRef(repository, proposalRef('alice'))).toBe(ZERO_OID)
  })

  it('rejects file deletion', async () => {
    await rm(join(source, 'note.md'))
    await expect(push(commit())).rejects.toThrow('proposal_deletes_forbidden')
    expect(await readKbRef(repository, 'refs/heads/main')).toBe(base)
  })

  it.each(['../escape', '.git/config'])('rejects a forged Git tree containing %s', async (path) => {
    const blob = git(['rev-parse', 'HEAD:note.md']).toString().trim()
    const rawTree = Buffer.concat([Buffer.from(`100644 ${path}\0`), Buffer.from(blob, 'hex')])
    const tree = git(['hash-object', '-t', 'tree', '--literally', '-w', '--stdin'], source, rawTree).toString().trim()
    const hash = git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit-tree', tree, '-p', base, '-m', 'forged']).toString().trim()
    const result = await push(hash).catch(() => null)
    if (result) expect(await result.text()).not.toContain(`ok ${proposalRef('alice')}`)
    expect(await readKbRef(repository, proposalRef('alice'))).toBe(ZERO_OID)
    expect(await readKbRef(repository, 'refs/heads/main')).toBe(base)
    expect(accepted).not.toHaveBeenCalled()
  })

  it('rejects submodules and oversized blobs', async () => {
    git(['update-index', '--add', '--cacheinfo', `160000,${base},module`])
    git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'submodule'])
    await expect(push(git(['rev-parse', 'HEAD']).toString().trim())).rejects.toThrow('proposal_special_file_forbidden')
    git(['reset', '--hard', base])
    await writeFile(join(source, 'large.md'), Buffer.alloc(8 * 1024 * 1024 + 1, 65))
    await expect(push(commit())).rejects.toThrow('proposal_file_too_large')
  })

  it('does not apply an approval after main advances independently', async () => {
    await writeFile(join(source, 'note.md'), 'proposal\n')
    const hash = commit()
    await push(hash)
    git(['reset', '--hard', base])
    await writeFile(join(source, 'other.md'), 'concurrent change\n')
    const newerMain = commit()
    git(['push', repository, 'HEAD:refs/heads/main'])
    await expect(approveKbProposal(repository, 'alice', hash, base)).rejects.toThrow()
    expect(await readKbRef(repository, 'refs/heads/main')).toBe(newerMain)
  })

  it('rejects symlinks even when removed in a later commit', async () => {
    await symlink('/etc/passwd', join(source, 'link'))
    commit()
    await rm(join(source, 'link'))
    await writeFile(join(source, 'link'), 'now regular')
    await expect(push(commit())).rejects.toThrow('proposal_special_file_forbidden')
    expect(await readKbRef(repository, proposalRef('alice'))).toBe(ZERO_OID)
  })

  it('bounds concurrent operations across independent callers and releases the lock on failure', async () => {
    await withKbLock(repository, async () => {
      await expect(withKbLock(repository, async () => undefined)).rejects.toThrow('kb_busy')
    })
    await expect(withKbLock(repository, async () => { throw new Error('failure') })).rejects.toThrow('failure')
    await expect(withKbLock(repository, async () => 'available')).resolves.toBe('available')
  })

  it('rolls back an unaudited proposal update without touching main', async () => {
    accepted.mockRejectedValueOnce(new Error('audit_unavailable'))
    await writeFile(join(source, 'note.md'), 'needs audit\n')
    await expect(push(commit())).rejects.toThrow('audit_unavailable')
    expect(await readKbRef(repository, proposalRef('alice'))).toBe(ZERO_OID)
    expect(await readKbRef(repository, 'refs/heads/main')).toBe(base)
  })
})

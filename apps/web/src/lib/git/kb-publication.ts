import { execFile } from 'node:child_process'
import { mkdir, rmdir } from 'node:fs/promises'
import { join } from 'node:path'

import { isValidKbPath } from '@/lib/learning/validation'
import { assertValidSlug } from '@/lib/validation/slug'
import { isProtectedWorkspacePath } from '@/lib/workspace-paths'

export const KB_MAIN_REF = 'refs/heads/main'
export const ZERO_OID = '0'.repeat(40)

export function proposalRef(slug: string): string {
  assertValidSlug(slug)
  return `refs/heads/proposals/${slug}/pending`
}

export function kbGit(repository: string, args: string[], input?: string | Buffer, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', [
      '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=always',
      '-c', 'protocol.ext.allow=never', '--git-dir', repository, ...args,
    ], {
      encoding: 'buffer', timeout: 60_000, maxBuffer: 64 * 1024 * 1024, signal,
      env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0' },
    }, (error, stdout) => error ? reject(new Error('kb_git_failed')) : resolve(stdout))
    child.stdin?.on('error', reject)
    child.stdin?.end(input)
  })
}

export async function readKbRef(repository: string, ref: string, signal?: AbortSignal): Promise<string> {
  const output = (await kbGit(repository, ['for-each-ref', '--format=%(objectname)', ref], undefined, signal)).toString().trim()
  if (!output) return ZERO_OID
  if (!/^[a-f0-9]{40}$/.test(output)) throw new Error('invalid_kb_ref')
  return output
}

export async function withKbLock<T>(repository: string, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const lock = join(repository, 'arche-publication.lock')
  try { await mkdir(lock, { mode: 0o700 }) } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new Error('kb_busy')
    throw error
  }
  try { return await action(AbortSignal.timeout(60_000)) } finally { await rmdir(lock) }
}

export type KbProposal = { slug: string; ref: string; commit: string; base: string; paths: string[]; diff: string }

export async function validateKbCommit(repository: string, commit: string, base: string, signal?: AbortSignal): Promise<string[]> {
  signal ??= AbortSignal.timeout(60_000)
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^[a-f0-9]{40}$/.test(base) || commit === ZERO_OID) throw new Error('invalid_commit')
  if (base !== ZERO_OID) await kbGit(repository, ['merge-base', '--is-ancestor', base, commit], undefined, signal)
  const commits = (await kbGit(repository, ['rev-list', '--max-count=129', commit, ...(base === ZERO_OID ? [] : [`^${base}`])], undefined, signal)).toString().trim().split('\n').filter(Boolean)
  if (commits.length > 128) throw new Error('proposal_too_many_commits')
  const paths = new Set<string>()
  const blobs = new Set<string>()
  let totalBytes = 0
  for (const revision of commits) {
    const entries = (await kbGit(repository, ['diff-tree', '--root', '--no-commit-id', '-r', '-m', '--no-renames', '--raw', '-z', revision], undefined, signal)).toString('utf8').split('\0')
    for (let index = 0; index + 1 < entries.length; index += 2) {
      const metadata = entries[index].split(' ')
      const path = entries[index + 1]
      const mode = metadata[1]
      if (!isValidKbPath(path) || /[\x00-\x1f\x7f]/.test(path) || path.split('/').some((part) => /^(hooks|node_modules)$/i.test(part)) || isProtectedWorkspacePath(path)) throw new Error('invalid_proposal_path')
      if (metadata[4] === 'D') throw new Error('proposal_deletes_forbidden')
      if (mode !== '100644' && mode !== '100755') throw new Error('proposal_special_file_forbidden')
      const bytes = Number((await kbGit(repository, ['cat-file', '-s', metadata[3]], undefined, signal)).toString())
      if (!Number.isSafeInteger(bytes) || bytes > 8 * 1024 * 1024) throw new Error('proposal_file_too_large')
      if (!blobs.has(metadata[3])) {
        blobs.add(metadata[3])
        totalBytes += bytes
        if (totalBytes > 32 * 1024 * 1024) throw new Error('proposal_content_too_large')
      }
      paths.add(path)
      if (paths.size > 256) throw new Error('proposal_too_many_files')
    }
  }
  return [...paths].sort()
}

export async function getKbProposal(repository: string, slug: string, signal = AbortSignal.timeout(60_000)): Promise<KbProposal | null> {
  const ref = proposalRef(slug)
  const commit = await readKbRef(repository, ref, signal)
  const base = await readKbRef(repository, KB_MAIN_REF, signal)
  if (commit === ZERO_OID || commit === base) return null
  if (base !== ZERO_OID) {
    const merged = (await kbGit(repository, ['merge-base', commit, base], undefined, signal)).toString().trim()
    if (merged === commit) return null
  }
  const paths = await validateKbCommit(repository, commit, base, signal)
  const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
  const diff = (await kbGit(repository, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', base === ZERO_OID ? emptyTree : base, commit], undefined, signal)).toString('utf8')
  if (Buffer.byteLength(diff) > 2 * 1024 * 1024) throw new Error('proposal_diff_too_large')
  return { slug, ref, commit, base, paths, diff }
}

export async function approveKbProposal(repository: string, slug: string, commit: string, base: string): Promise<KbProposal> {
  return withKbLock(repository, async (signal) => {
    const proposal = await getKbProposal(repository, slug, signal)
    if (!proposal || proposal.commit !== commit || proposal.base !== base) throw new Error('proposal_changed')
    await kbGit(repository, ['update-ref', '--stdin'], `start\nverify ${proposal.ref} ${commit}\nupdate ${KB_MAIN_REF} ${commit} ${base}\nprepare\ncommit\n`, signal)
    return proposal
  })
}

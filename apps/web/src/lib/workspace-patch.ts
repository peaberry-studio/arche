import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'

import { isProtectedWorkspacePath, normalizeWorkspacePath } from '@/lib/workspace-paths'

export async function isSafeWorkspacePatch(patch: string): Promise<boolean> {
  if (!patch || Buffer.byteLength(patch) > 2 * 1024 * 1024) return false
  if (/^(?:rename|copy) (?:from|to) /m.test(patch)) return false
  if (/^(?:new|old|deleted file|new file) mode (?:120000|160000)$/m.test(patch)) return false
  const paths = await new Promise<string | null>((resolve) => {
    const child = execFile('git', ['-c', 'core.hooksPath=/dev/null', 'apply', '--numstat', '-z', '--'], {
      cwd: tmpdir(), timeout: 5000, maxBuffer: 64 * 1024,
      env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    }, (error, stdout) => resolve(error ? null : stdout))
    child.stdin?.on('error', () => resolve(null))
    child.stdin?.end(patch)
  })
  if (!paths) return false
  return paths.split('\0').filter(Boolean).every((entry) => {
    const path = entry.split('\t').slice(2).join('\t')
    const normalized = normalizeWorkspacePath(path)
    return !!normalized && normalized === path && !normalized.split('/').includes('..') && !isProtectedWorkspacePath(normalized)
  })
}

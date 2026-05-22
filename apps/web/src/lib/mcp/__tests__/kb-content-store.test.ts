import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createKbArticle, readKbArticle, updateKbArticle } from '@/lib/mcp/kb-content-store'

const gitAvailable = isGitAvailable()
const originalE2eHooks = process.env.ARCHE_ENABLE_E2E_HOOKS
const originalKbContentHostPath = process.env.KB_CONTENT_HOST_PATH

let tempRoot: string | null = null
let outsidePath: string | null = null

describe.skipIf(!gitAvailable)('MCP KB content store', () => {
  beforeEach(async () => {
    const repo = await createBareContentRepo()
    tempRoot = repo.tempRoot
    outsidePath = repo.outsidePath
    process.env.ARCHE_ENABLE_E2E_HOOKS = '1'
    process.env.KB_CONTENT_HOST_PATH = repo.barePath
  })

  afterEach(async () => {
    if (originalE2eHooks === undefined) {
      delete process.env.ARCHE_ENABLE_E2E_HOOKS
    } else {
      process.env.ARCHE_ENABLE_E2E_HOOKS = originalE2eHooks
    }

    if (originalKbContentHostPath === undefined) {
      delete process.env.KB_CONTENT_HOST_PATH
    } else {
      process.env.KB_CONTENT_HOST_PATH = originalKbContentHostPath
    }

    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true })
      tempRoot = null
      outsidePath = null
    }
  })

  it('blocks traversal and symlink escape for reads and writes', async () => {
    await expect(readKbArticle({ path: '../outside.md' })).resolves.toEqual({ ok: false, error: 'invalid_path' })
    await expect(readKbArticle({ path: 'link.md' })).resolves.toEqual({ ok: false, error: 'invalid_path' })
    await expect(updateKbArticle({ path: 'link.md', content: 'changed' })).resolves.toEqual({ ok: false, error: 'invalid_path' })
    await expect(fs.readFile(String(outsidePath), 'utf-8')).resolves.toBe('outside')
  })

  it('creates markdown articles inside the KB sandbox', async () => {
    await expect(createKbArticle({ path: 'folder/new.md', content: '# New' })).resolves.toEqual({ ok: true, path: 'folder/new.md' })

    const readResult = await readKbArticle({ path: 'folder/new.md' })
    expect(readResult).toMatchObject({ ok: true, path: 'folder/new.md', content: '# New' })
  })
})

function isGitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

async function createBareContentRepo(): Promise<{ barePath: string; outsidePath: string; tempRoot: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arche-mcp-kb-test-'))
  const barePath = path.join(root, 'content.git')
  const workPath = path.join(root, 'work')
  const externalPath = path.join(root, 'outside.md')

  await fs.mkdir(workPath)
  await fs.writeFile(externalPath, 'outside', 'utf-8')

  runGit(['init', '--bare', barePath], root)
  runGit(['init'], workPath)
  runGit(['config', 'user.name', 'Test User'], workPath)
  runGit(['config', 'user.email', 'test@example.com'], workPath)

  await fs.writeFile(path.join(workPath, 'inside.md'), '# Inside', 'utf-8')
  await fs.symlink(externalPath, path.join(workPath, 'link.md'))

  runGit(['add', 'inside.md', 'link.md'], workPath)
  runGit(['commit', '-m', 'seed'], workPath)
  runGit(['branch', '-M', 'main'], workPath)
  runGit(['remote', 'add', 'origin', barePath], workPath)
  runGit(['push', 'origin', 'main'], workPath)
  runGit(['--git-dir', barePath, 'symbolic-ref', 'HEAD', 'refs/heads/main'], root)

  return { barePath, outsidePath: externalPath, tempRoot: root }
}

function runGit(args: string[], cwd: string): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_AUTHOR_NAME: 'Test User',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test User',
    },
  })
}

import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

import { getKbContentRoot } from '@/lib/runtime/paths'

const WORKSPACE_GIT_EXCLUDE_ENTRIES = ['opencode.json', 'AGENTS.md', 'node_modules/'] as const

function resolveWorkspaceExcludePath(workspaceDir: string): string | null {
  try {
    const output = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
      cwd: workspaceDir,
      encoding: 'utf-8',
    })
    const relativePath =
      typeof output === 'string'
        ? output.trim()
        : output instanceof Buffer
          ? output.toString('utf-8').trim()
          : ''

    if (!relativePath) {
      return null
    }

    return join(workspaceDir, relativePath)
  } catch {
    return null
  }
}

function ensureWorkspaceExcludes(workspaceDir: string): void {
  const excludePath = resolveWorkspaceExcludePath(workspaceDir)
  if (!excludePath) {
    return
  }

  mkdirSync(dirname(excludePath), { recursive: true })

  const existing = existsSync(excludePath) ? readFileSync(excludePath, 'utf-8') : ''
  const currentEntries = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  )

  let changed = false
  for (const entry of WORKSPACE_GIT_EXCLUDE_ENTRIES) {
    if (currentEntries.has(entry)) {
      continue
    }

    currentEntries.add(entry)
    changed = true
  }

  if (!changed) {
    return
  }

  const next = `${Array.from(currentEntries).join('\n')}\n`
  writeFileSync(excludePath, next, 'utf-8')
}

export function getArcheOpencodeDataDir(): string {
  const baseDir = process.env.ARCHE_OPENCODE_DATA_DIR || join(process.env.HOME || '', '.arche-opencode')
  const workspaceDir = join(baseDir, 'data')
  if (!existsSync(workspaceDir)) {
    mkdirSync(workspaceDir, { recursive: true })
  }
  return workspaceDir
}

export function getWorkspaceDir(slug: string): string {
  const baseDir = process.env.ARCHE_OPENCODE_DATA_DIR || join(process.env.HOME || '', '.arche-opencode')
  const workspaceDir = join(baseDir, 'workspaces', slug)
  if (!existsSync(workspaceDir)) {
    mkdirSync(workspaceDir, { recursive: true })
  }
  if (!existsSync(join(workspaceDir, '.git'))) {
    execFileSync('git', ['init', '-b', 'main', workspaceDir])
    execFileSync('git', ['commit', '--allow-empty', '-m', 'Initial commit'], { cwd: workspaceDir })
  }
  ensureWorkspaceExcludes(workspaceDir)
  // Ensure the kb remote points to the bare KB content repo
  const kbContentDir = getKbContentRoot()
  try {
    const currentUrl = execFileSync('git', ['remote', 'get-url', 'kb'], { cwd: workspaceDir, encoding: 'utf-8' }).trim()
    if (currentUrl !== kbContentDir) {
      execFileSync('git', ['remote', 'set-url', 'kb', kbContentDir], { cwd: workspaceDir })
    }
  } catch {
    execFileSync('git', ['remote', 'add', 'kb', kbContentDir], { cwd: workspaceDir })
  }
  return workspaceDir
}

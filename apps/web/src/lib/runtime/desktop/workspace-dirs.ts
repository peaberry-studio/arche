import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

import {
  DESKTOP_OPENCODE_RUNTIME_DIR_NAME,
  DESKTOP_RUNTIME_DIR_NAME,
  DESKTOP_WORKSPACE_DIR_NAME,
} from '@/lib/runtime/desktop/vault-layout-constants'

import { getKbContentRoot } from '@/lib/runtime/paths'
import { assertValidSlug } from '@/lib/validation/slug'

const WORKSPACE_GIT_EXCLUDE_ENTRIES = ['opencode.json', 'AGENTS.md', 'node_modules/'] as const

function getRequiredVaultRoot(): string {
  const vaultRoot = process.env.ARCHE_DATA_DIR?.trim()
  if (!vaultRoot) {
    throw new Error('Desktop workspace access requires ARCHE_DATA_DIR to be set')
  }

  return vaultRoot
}

function getRequiredOpencodeRuntimeDir(): string {
  return process.env.ARCHE_OPENCODE_DATA_DIR?.trim() || join(
    getRequiredVaultRoot(),
    DESKTOP_RUNTIME_DIR_NAME,
    DESKTOP_OPENCODE_RUNTIME_DIR_NAME,
  )
}

function resolveWorkspaceExcludePath(workspaceDir: string): string | null {
  try {
    const output = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
      cwd: workspaceDir,
      encoding: 'utf-8',
    })
    const relativePath = output.trim()

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

  writeFileSync(excludePath, `${Array.from(currentEntries).join('\n')}\n`, 'utf-8')
}

export function getArcheOpencodeDataDir(): string {
  const runtimeDir = getRequiredOpencodeRuntimeDir()
  if (!existsSync(runtimeDir)) {
    mkdirSync(runtimeDir, { recursive: true })
  }
  return runtimeDir
}

export function getWorkspaceDir(slug: string): string {
  assertValidSlug(slug)

  // Desktop keeps one shared git workspace per vault; the slug stays in the
  // signature to match the runtime interface used by web mode.

  const workspaceDir = join(getRequiredVaultRoot(), DESKTOP_WORKSPACE_DIR_NAME)
  if (!existsSync(workspaceDir)) {
    mkdirSync(workspaceDir, { recursive: true })
  }
  if (!existsSync(join(workspaceDir, '.git'))) {
    execFileSync('git', ['init', '-b', 'main', workspaceDir])
    execFileSync('git', ['commit', '--allow-empty', '-m', 'Initial commit'], { cwd: workspaceDir })
  }
  ensureWorkspaceExcludes(workspaceDir)

  const kbContentDir = getKbContentRoot()
  try {
    const currentUrl = execFileSync('git', ['remote', 'get-url', 'kb'], {
      cwd: workspaceDir,
      encoding: 'utf-8',
    }).trim()
    if (currentUrl !== kbContentDir) {
      execFileSync('git', ['remote', 'set-url', 'kb', kbContentDir], { cwd: workspaceDir })
    }
  } catch {
    execFileSync('git', ['remote', 'add', 'kb', kbContentDir], { cwd: workspaceDir })
  }
  return workspaceDir
}

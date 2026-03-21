import { execFileSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

import { getKbContentRoot } from '@/lib/runtime/paths'

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

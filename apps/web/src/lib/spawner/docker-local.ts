import { spawn } from 'child_process'
import { closeSync, existsSync, openSync } from 'fs'
import { chmod, copyFile, mkdir, readdir, readFile, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'

import { getUserDataHostPath, ensureUserDirectory } from '@/lib/user-data'
import { assertValidSlug } from '@/lib/validation/slug'

import {
  getKbContentHostPath,
  getLocalInstanceHost,
  getOpencodeBinPath,
  getOpencodePortForSlug,
  getWorkspaceAgentBinPath,
  getWorkspaceAgentPortForSlug,
} from './config'

const LOCAL_RUNTIME_PREFIX = 'local:'
const LOCAL_RUNTIME_DIR = '.runtime-local'
const LOCAL_META_FILE = 'container-meta.json'
const LOCAL_STATE_FILE = 'container-state.json'

const WORKSPACE_EDIT_DENY_RULES: Record<string, 'deny'> = {
  '.gitignore': 'deny',
  '.gitkeep': 'deny',
  '**/.gitkeep': 'deny',
  'opencode.json': 'deny',
  'AGENTS.md': 'deny',
  'agents.md': 'deny',
  'node_modules': 'deny',
  'node_modules/*': 'deny',
  '*/node_modules': 'deny',
  '*/node_modules/*': 'deny',
}

const WORKSPACE_BASH_DENY_RULES: Record<string, 'deny'> = {
  '*.gitignore*': 'deny',
  '*.gitkeep*': 'deny',
  '*opencode.json*': 'deny',
  '*AGENTS.md*': 'deny',
  '*agents.md*': 'deny',
  'npm install*': 'deny',
  'npm i*': 'deny',
  'npm ci*': 'deny',
  'npm init*': 'deny',
  'npm create*': 'deny',
  'pnpm install*': 'deny',
  'pnpm add*': 'deny',
  'pnpm init*': 'deny',
  'pnpm create*': 'deny',
  'yarn install*': 'deny',
  'yarn add*': 'deny',
  'yarn init*': 'deny',
  'yarn create*': 'deny',
  'bun install*': 'deny',
  'bun add*': 'deny',
  'bun init*': 'deny',
  'bun create*': 'deny',
}

type LocalContainerMeta = {
  slug: string
  password: string
  workspaceDir: string
  userDataPath: string
  gitAuthorName: string
  gitAuthorEmail: string
}

type LocalContainerState = {
  containerId: string
  slug: string
  opencodePid: number
  workspaceAgentPid: number
  opencodePort: number
  workspaceAgentPort: number
  workspaceDir: string
}

export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

function mergePermissionRule(
  current: unknown,
  enforced: Record<string, 'allow' | 'ask' | 'deny'>,
): Record<string, unknown> {
  if (typeof current === 'string') {
    return { '*': current, ...enforced }
  }

  if (current && typeof current === 'object') {
    return { ...(current as Record<string, unknown>), ...enforced }
  }

  return { ...enforced }
}

function withWorkspacePermissionGuards(config: Record<string, unknown>): Record<string, unknown> {
  const next = { ...config }
  const permission =
    next.permission && typeof next.permission === 'object'
      ? { ...(next.permission as Record<string, unknown>) }
      : {}

  permission.edit = mergePermissionRule(permission.edit, WORKSPACE_EDIT_DENY_RULES)
  permission.bash = mergePermissionRule(permission.bash, WORKSPACE_BASH_DENY_RULES)

  next.permission = permission
  return next
}

function getProviderGatewayConfig(): Record<string, unknown> {
  const baseUrl = process.env.ARCHE_PUBLIC_BASE_URL || 'http://127.0.0.1:3000'
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  return {
    provider: {
      anthropic: {
        options: {
          baseURL: `${normalizedBase}/api/internal/providers/anthropic`,
        },
      },
      opencode: {
        options: {
          baseURL: `${normalizedBase}/api/internal/providers/opencode`,
        },
      },
      openai: {
        options: {
          baseURL: `${normalizedBase}/api/internal/providers/openai`,
        },
      },
      openrouter: {
        options: {
          baseURL: `${normalizedBase}/api/internal/providers/openrouter`,
        },
      },
    },
  }
}

function toContainerId(slug: string): string {
  return `${LOCAL_RUNTIME_PREFIX}${slug}`
}

function parseSlugFromContainerId(containerId: string): string {
  if (!containerId.startsWith(LOCAL_RUNTIME_PREFIX)) {
    throw new Error(`invalid local container id: ${containerId}`)
  }

  const slug = containerId.slice(LOCAL_RUNTIME_PREFIX.length)
  assertValidSlug(slug)
  return slug
}

function getRuntimeDir(slug: string): string {
  return join(getUserDataHostPath(slug), LOCAL_RUNTIME_DIR)
}

function getMetaPath(slug: string): string {
  return join(getRuntimeDir(slug), LOCAL_META_FILE)
}

function getStatePath(slug: string): string {
  return join(getRuntimeDir(slug), LOCAL_STATE_FILE)
}

function processIsRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function stopProcess(pid: number): Promise<void> {
  if (!processIsRunning(pid)) return

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }

  for (let index = 0; index < 20; index += 1) {
    if (!processIsRunning(pid)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  if (!processIsRunning(pid)) return

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // ignore
  }
}

async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string
    env?: NodeJS.ProcessEnv
    timeout?: number
  } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })

    let timer: NodeJS.Timeout | null = null
    if (options.timeout && options.timeout > 0) {
      timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`command timed out after ${options.timeout}ms`))
      }, options.timeout)
    }

    child.on('error', (error) => {
      if (timer) clearTimeout(timer)
      reject(error)
    })

    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
      })
    })
  })
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
}

async function ensureBareRepo(path: string): Promise<void> {
  const result = await runCommand('git', ['--git-dir', path, 'rev-parse', '--is-bare-repository'])
  if (result.exitCode !== 0 || result.stdout.trim() !== 'true') {
    throw new Error(`KB repository at ${path} must be a bare Git repo`)
  }
}

async function configureWorkspaceIdentity(
  workspaceDir: string,
  name: string,
  email: string,
): Promise<void> {
  const emailResult = await runCommand('git', ['config', 'user.email', email], {
    cwd: workspaceDir,
  })
  if (emailResult.exitCode !== 0) {
    throw new Error(emailResult.stderr.trim() || 'failed to set workspace git email')
  }

  const nameResult = await runCommand('git', ['config', 'user.name', name], {
    cwd: workspaceDir,
  })
  if (nameResult.exitCode !== 0) {
    throw new Error(nameResult.stderr.trim() || 'failed to set workspace git name')
  }
}

async function ensureKbRemote(workspaceDir: string, kbContentPath: string): Promise<void> {
  const remoteCheck = await runCommand('git', ['remote', 'get-url', 'kb'], {
    cwd: workspaceDir,
  })
  if (remoteCheck.exitCode === 0) return

  const addRemote = await runCommand('git', ['remote', 'add', 'kb', kbContentPath], {
    cwd: workspaceDir,
  })
  if (addRemote.exitCode !== 0) {
    throw new Error(addRemote.stderr.trim() || 'failed to add kb remote')
  }
}

async function ensureWorkspaceExcludes(workspaceDir: string): Promise<void> {
  const excludePath = join(workspaceDir, '.git', 'info', 'exclude')
  await mkdir(join(workspaceDir, '.git', 'info'), { recursive: true })

  let existing = ''
  try {
    existing = await readFile(excludePath, 'utf-8')
  } catch {
    existing = ''
  }

  const rules = ['opencode.json', 'AGENTS.md', 'node_modules/']
  const missing = rules.filter((rule) => !existing.split('\n').includes(rule))
  if (missing.length === 0) return

  const next = existing.endsWith('\n') || existing.length === 0 ? existing : `${existing}\n`
  await writeFile(excludePath, `${next}${missing.join('\n')}\n`, 'utf-8')
}

async function initializeWorkspace(
  workspaceDir: string,
  kbContentPath: string,
  gitAuthor: { name: string; email: string },
): Promise<void> {
  await ensureBareRepo(kbContentPath)
  await mkdir(workspaceDir, { recursive: true, mode: 0o700 })

  const gitDir = join(workspaceDir, '.git')
  if (existsSync(gitDir)) {
    await ensureKbRemote(workspaceDir, kbContentPath)
    await configureWorkspaceIdentity(workspaceDir, gitAuthor.name, gitAuthor.email)
    await ensureWorkspaceExcludes(workspaceDir)
    return
  }

  const entries = await readdir(workspaceDir)
  if (entries.length > 0) {
    const initResult = await runCommand('git', ['init', '-b', 'main'], { cwd: workspaceDir })
    if (initResult.exitCode !== 0) {
      throw new Error(initResult.stderr.trim() || 'failed to initialize workspace repository')
    }
    await ensureKbRemote(workspaceDir, kbContentPath)
    await configureWorkspaceIdentity(workspaceDir, gitAuthor.name, gitAuthor.email)
    await ensureWorkspaceExcludes(workspaceDir)
    return
  }

  const cloneResult = await runCommand('git', ['clone', kbContentPath, workspaceDir])
  if (cloneResult.exitCode !== 0) {
    throw new Error(cloneResult.stderr.trim() || 'failed to clone kb into workspace')
  }

  const originCheck = await runCommand('git', ['remote', 'get-url', 'origin'], { cwd: workspaceDir })
  if (originCheck.exitCode === 0) {
    await runCommand('git', ['remote', 'rename', 'origin', 'kb'], { cwd: workspaceDir })
  }

  await ensureKbRemote(workspaceDir, kbContentPath)
  await configureWorkspaceIdentity(workspaceDir, gitAuthor.name, gitAuthor.email)
  await ensureWorkspaceExcludes(workspaceDir)
}

async function loadMeta(slug: string): Promise<LocalContainerMeta> {
  const meta = await readJsonFile<LocalContainerMeta>(getMetaPath(slug))
  if (!meta) {
    throw new Error(`missing local runtime metadata for ${slug}`)
  }
  return meta
}

async function loadState(slug: string): Promise<LocalContainerState | null> {
  return readJsonFile<LocalContainerState>(getStatePath(slug))
}

async function writeState(slug: string, state: LocalContainerState): Promise<void> {
  await writeJsonFile(getStatePath(slug), state)
}

async function removeState(slug: string): Promise<void> {
  await rm(getStatePath(slug), { force: true })
}

async function removeMeta(slug: string): Promise<void> {
  await rm(getMetaPath(slug), { force: true })
}

function createDetachedLogFd(path: string): number {
  return openSync(path, 'a')
}

function normalizeErrorMessage(result: ExecResult, fallback: string): string {
  const stderr = result.stderr.trim()
  if (stderr) return stderr
  const stdout = result.stdout.trim()
  if (stdout) return stdout
  return fallback
}

export async function createContainer(
  slug: string,
  password: string,
  opencodeConfigContent?: string,
  agentsMd?: string,
  gitAuthor?: { name: string; email?: string },
) {
  assertValidSlug(slug)
  const userDataPath = await ensureUserDirectory(slug)
  const runtimeDir = getRuntimeDir(slug)
  const logsDir = join(runtimeDir, 'logs')
  const workspaceDir = join(userDataPath, 'workspace')
  const kbContentPath = getKbContentHostPath()

  await mkdir(runtimeDir, { recursive: true, mode: 0o700 })
  await mkdir(logsDir, { recursive: true, mode: 0o700 })
  await mkdir(workspaceDir, { recursive: true, mode: 0o700 })

  const providerGatewayConfig = getProviderGatewayConfig()
  const baseConfig = opencodeConfigContent
    ? (JSON.parse(opencodeConfigContent) as Record<string, unknown>)
    : {}
  const mergedConfig = withWorkspacePermissionGuards({
    ...baseConfig,
    ...providerGatewayConfig,
  })

  const opencodeConfigPath = join(userDataPath, 'opencode-config.json')
  await writeFile(opencodeConfigPath, `${JSON.stringify(mergedConfig, null, 2)}\n`, 'utf-8')
  await chmod(opencodeConfigPath, 0o644)

  if (agentsMd) {
    const agentsPath = join(userDataPath, 'AGENTS.md')
    await writeFile(agentsPath, agentsMd, 'utf-8')
    await chmod(agentsPath, 0o644)
  } else {
    await rm(join(userDataPath, 'AGENTS.md'), { force: true })
  }

  const identity = {
    email: gitAuthor?.email ?? `${slug}@arche.local`,
    name: gitAuthor?.name ?? slug,
  }
  await initializeWorkspace(workspaceDir, kbContentPath, identity)

  const meta: LocalContainerMeta = {
    gitAuthorEmail: identity.email,
    gitAuthorName: identity.name,
    password,
    slug,
    userDataPath,
    workspaceDir,
  }
  await writeJsonFile(getMetaPath(slug), meta)

  return { id: toContainerId(slug) }
}

export async function startContainer(containerId: string): Promise<void> {
  const slug = parseSlugFromContainerId(containerId)
  const meta = await loadMeta(slug)
  const existing = await loadState(slug)
  if (existing) {
    await stopProcess(existing.workspaceAgentPid)
    await stopProcess(existing.opencodePid)
    await removeState(slug)
  }

  const host = getLocalInstanceHost()
  const opencodePort = getOpencodePortForSlug(slug)
  const workspaceAgentPort = getWorkspaceAgentPortForSlug(slug)
  const opencodeBin = getOpencodeBinPath()
  const workspaceAgentBin = getWorkspaceAgentBinPath()
  const runtimeDir = getRuntimeDir(slug)
  const logsDir = join(runtimeDir, 'logs')
  const homeDir = join(meta.userDataPath, 'home')
  const opencodeConfigPath = join(meta.userDataPath, 'opencode-config.json')
  const workspaceConfigPath = join(meta.workspaceDir, 'opencode.json')
  const userAgentsPath = join(meta.userDataPath, 'AGENTS.md')
  const workspaceAgentsPath = join(meta.workspaceDir, 'AGENTS.md')

  await mkdir(logsDir, { recursive: true, mode: 0o700 })
  await mkdir(homeDir, { recursive: true, mode: 0o700 })
  await copyFile(opencodeConfigPath, workspaceConfigPath)
  if (existsSync(userAgentsPath)) {
    await copyFile(userAgentsPath, workspaceAgentsPath)
  } else {
    await rm(workspaceAgentsPath, { force: true })
  }

  const opencodeLogFd = createDetachedLogFd(join(logsDir, 'opencode.log'))
  const workspaceAgentLogFd = createDetachedLogFd(join(logsDir, 'workspace-agent.log'))

  const commonEnv: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homeDir,
    WORKSPACE_DIR: meta.workspaceDir,
    XDG_DATA_HOME: join(homeDir, '.local', 'share'),
    XDG_STATE_HOME: join(homeDir, '.local', 'state'),
  }

  const opencodeProcess = spawn(
    opencodeBin,
    ['serve', '--hostname', host, '--port', String(opencodePort)],
    {
      cwd: meta.workspaceDir,
      detached: true,
      env: {
        ...commonEnv,
        OPENCODE_SERVER_PASSWORD: meta.password,
        OPENCODE_SERVER_USERNAME: 'opencode',
      },
      stdio: ['ignore', opencodeLogFd, opencodeLogFd],
    },
  )

  const workspaceAgentProcess = spawn(
    workspaceAgentBin,
    ['--addr', `${host}:${workspaceAgentPort}`, '--workspace', meta.workspaceDir],
    {
      cwd: meta.workspaceDir,
      detached: true,
      env: {
        ...commonEnv,
        WORKSPACE_AGENT_PASSWORD: meta.password,
        WORKSPACE_AGENT_USERNAME: 'opencode',
      },
      stdio: ['ignore', workspaceAgentLogFd, workspaceAgentLogFd],
    },
  )

  closeSync(opencodeLogFd)
  closeSync(workspaceAgentLogFd)

  if (!opencodeProcess.pid || !workspaceAgentProcess.pid) {
    throw new Error('failed to spawn local workspace processes')
  }

  opencodeProcess.unref()
  workspaceAgentProcess.unref()

  const state: LocalContainerState = {
    containerId,
    opencodePid: opencodeProcess.pid,
    opencodePort,
    slug,
    workspaceAgentPid: workspaceAgentProcess.pid,
    workspaceAgentPort,
    workspaceDir: meta.workspaceDir,
  }
  await writeState(slug, state)
}

export async function stopContainer(containerId: string): Promise<void> {
  const slug = parseSlugFromContainerId(containerId)
  const state = await loadState(slug)
  if (!state) return

  await stopProcess(state.workspaceAgentPid)
  await stopProcess(state.opencodePid)
  await removeState(slug)
}

export async function removeContainer(containerId: string): Promise<void> {
  const slug = parseSlugFromContainerId(containerId)
  await stopContainer(containerId)
  await removeState(slug)
  await removeMeta(slug)
}

export async function inspectContainer(containerId: string) {
  const slug = parseSlugFromContainerId(containerId)
  const state = await loadState(slug)
  const running = !!state && processIsRunning(state.opencodePid)
  return {
    Id: containerId,
    Name: `opencode-${slug}`,
    State: {
      Running: running,
    },
  }
}

export async function isContainerRunning(containerId: string): Promise<boolean> {
  const slug = parseSlugFromContainerId(containerId)
  const state = await loadState(slug)
  if (!state) return false
  return processIsRunning(state.opencodePid)
}

export async function isOpencodeHealthy(containerId: string): Promise<boolean> {
  const slug = parseSlugFromContainerId(containerId)
  const meta = await readJsonFile<LocalContainerMeta>(getMetaPath(slug))
  if (!meta) return false

  const url = `http://${getLocalInstanceHost()}:${getOpencodePortForSlug(slug)}/global/health`
  const authHeader = `Basic ${Buffer.from(`opencode:${meta.password}`).toString('base64')}`

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        Authorization: authHeader,
      },
    })
    if (!response.ok) return false
    const data = await response.json().catch(() => null)
    return data?.healthy === true
  } catch {
    return false
  }
}

export async function execInContainer(
  containerId: string,
  cmd: string[],
  options: { workingDir?: string; timeout?: number } = {},
): Promise<ExecResult> {
  const slug = parseSlugFromContainerId(containerId)
  const meta = await loadMeta(slug)
  const workingDir = options.workingDir || meta.workspaceDir

  if (cmd.length === 0) {
    return { exitCode: 0, stdout: '', stderr: '' }
  }

  const [command, ...args] = cmd
  const result = await runCommand(command, args, {
    cwd: workingDir,
    timeout: options.timeout,
  })
  return result
}

export function normalizeExecError(result: ExecResult): string {
  return normalizeErrorMessage(result, `exit code ${result.exitCode}`)
}

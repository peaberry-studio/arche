import { app, BrowserWindow, dialog, session, shell } from 'electron'
import { randomBytes } from 'crypto'
import { exec as dugiteExecRaw, resolveGitBinary } from 'dugite'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

import { ensureDesktopEncryptionKey } from './desktop-encryption-key'
import {
  getMissingPackagedRuntimeBinaries,
  getPackagedNodeBinaryPath,
  getRuntimeBinaryEnv,
} from './runtime-binaries'
import { findAvailablePort } from './runtime-network'
import { probeHttpServerReady, RuntimeSupervisor } from './runtime-supervisor'

const DEFAULT_DESKTOP_WEB_PORT = 3000
const LOOPBACK_HOST = '127.0.0.1'
const DESKTOP_TOKEN_HEADER = 'x-arche-desktop-token'
const DESKTOP_GIT_AUTHOR_NAME = 'Arche Workspace'
const DESKTOP_GIT_AUTHOR_EMAIL = 'workspace@arche.local'

let mainWindow: BrowserWindow | null = null
let nextSupervisor: RuntimeSupervisor | null = null
let nextPort = DEFAULT_DESKTOP_WEB_PORT
let runtimeShutdownRequested = false
let desktopApiToken = ''

function generateDesktopApiToken(): string {
  return randomBytes(32).toString('base64url')
}

function getPort(): number {
  return nextPort
}

function getNextUrl(): string {
  return `http://${LOOPBACK_HOST}:${getPort()}`
}

function getWebAppDir(): string {
  if (app.isPackaged) {
    // Next.js standalone output in a monorepo preserves the full directory
    // structure, so server.js lives under apps/web/ within the standalone tree.
    return join(process.resourcesPath, 'web', 'apps', 'web')
  }
  return join(__dirname, '..', '..', 'web')
}

function getDataDir(): string {
  return process.env.ARCHE_DATA_DIR || join(app.getPath('home'), '.arche')
}

function resolveDesktopOpencodeConfigDir(): string | null {
  const explicitPath = process.env.ARCHE_OPENCODE_CONFIG_DIR
  if (explicitPath && existsSync(explicitPath)) {
    return explicitPath
  }

  if (app.isPackaged) {
    const bundledPath = join(process.resourcesPath, 'opencode-config')
    if (existsSync(bundledPath)) {
      return bundledPath
    }
  }

  const devPath = join(__dirname, '..', '..', '..', 'infra', 'workspace-image', 'opencode-config')
  if (existsSync(devPath)) {
    return devPath
  }

  return null
}

function ensureIsolatedDesktopGitEnvironment(): void {
  const gitConfigDir = join(getDataDir(), 'git')
  if (!existsSync(gitConfigDir)) {
    mkdirSync(gitConfigDir, { recursive: true })
  }

  const gitConfigPath = join(gitConfigDir, 'config')
  const gitConfig = [
    '[user]',
    `\tname = ${DESKTOP_GIT_AUTHOR_NAME}`,
    `\temail = ${DESKTOP_GIT_AUTHOR_EMAIL}`,
    '[commit]',
    '\tgpgsign = false',
    '[tag]',
    '\tgpgSign = false',
    '',
  ].join('\n')

  writeFileSync(gitConfigPath, gitConfig, 'utf-8')

  process.env.GIT_CONFIG_GLOBAL = gitConfigPath
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  process.env.GIT_TERMINAL_PROMPT = '0'
}

function setDesktopEnv(): void {
  const dataDir = getDataDir()

  process.env.ARCHE_RUNTIME_MODE = 'desktop'
  process.env.ARCHE_DESKTOP_PLATFORM = process.platform
  if (app.isPackaged) {
    process.env.NODE_ENV = 'production'
  }
  if (!process.env.ARCHE_RELEASE_VERSION) {
    process.env.ARCHE_RELEASE_VERSION = app.getVersion()
  }
  process.env.ARCHE_DATA_DIR = dataDir
  process.env.ARCHE_DESKTOP_WEB_HOST = LOOPBACK_HOST

  const opencodeConfigDir = resolveDesktopOpencodeConfigDir()
  if (opencodeConfigDir) {
    process.env.ARCHE_OPENCODE_CONFIG_DIR = opencodeConfigDir
  } else {
    delete process.env.ARCHE_OPENCODE_CONFIG_DIR
  }

  ensureDesktopEncryptionKey({ dataDir })
  ensureIsolatedDesktopGitEnvironment()

  desktopApiToken = generateDesktopApiToken()
  process.env.ARCHE_DESKTOP_API_TOKEN = desktopApiToken
}

async function dugiteExec(args: string[], cwd: string): Promise<string> {
  const result = await dugiteExecRaw(args, cwd)
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args[0]} failed (exit ${result.exitCode}): ${result.stderr}`,
    )
  }
  return result.stdout
}

function injectBundledGitIntoPath(): void {
  const gitBinDir = dirname(resolveGitBinary())
  const sep = process.platform === 'win32' ? ';' : ':'
  process.env.PATH = `${gitBinDir}${sep}${process.env.PATH || ''}`
}

async function ensureDataDirectories(): Promise<void> {
  const dataDir = getDataDir()
  const dirs = [
    dataDir,
    join(dataDir, 'kb-config'),
    join(dataDir, 'kb-content'),
    join(dataDir, 'users'),
  ]

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  await ensureBareRepo(join(dataDir, 'kb-config'))
  await ensureBareRepo(join(dataDir, 'kb-content'))
}

async function ensureBareRepo(dir: string): Promise<void> {
  if (existsSync(join(dir, 'HEAD'))) {
    return
  }

  await dugiteExec(['init', '--bare', dir], '.')

  // Create an initial empty commit so the repo has a valid HEAD
  const tmpClone = join(mkdtempSync(join(tmpdir(), 'arche-init-')), 'repo')
  try {
    await dugiteExec(['clone', dir, tmpClone], '.')
    await dugiteExec(['commit', '--allow-empty', '-m', 'Initial commit'], tmpClone)
    await dugiteExec(['push', 'origin', 'HEAD:refs/heads/main'], tmpClone)
    await dugiteExec(['symbolic-ref', 'HEAD', 'refs/heads/main'], dir)
  } finally {
    rmSync(join(tmpClone, '..'), { recursive: true, force: true })
  }
}

function resetDesktopDevNextArtifacts(): void {
  if (app.isPackaged) {
    return
  }

  const desktopDistDir = join(getWebAppDir(), '.next-desktop')
  if (existsSync(desktopDistDir)) {
    rmSync(desktopDistDir, { recursive: true, force: true })
  }
}

function getRuntimeBinaryOptions() {
  return {
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    devBaseDir: __dirname,
    env: process.env,
    platform: process.platform,
  }
}

function getDesktopRuntimeEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...getRuntimeBinaryEnv(getRuntimeBinaryOptions()),
  }
}

function verifyPackagedRuntimeBinaries(): string[] {
  if (!app.isPackaged) {
    return []
  }

  return getMissingPackagedRuntimeBinaries(getRuntimeBinaryOptions())
}

async function startNextServer(): Promise<void> {
  if (!nextSupervisor) {
    nextSupervisor = createNextSupervisor()
  }

  await nextSupervisor.start()
}

function createNextSupervisor(): RuntimeSupervisor {
  return new RuntimeSupervisor({
    componentName: 'next',
    command: app.isPackaged ? getPackagedNodeBinaryPath(getRuntimeBinaryOptions()) : 'pnpm',
    args: app.isPackaged
      ? ['server.js']
      : ['exec', 'next', 'dev', '-H', LOOPBACK_HOST, '-p', String(getPort())],
    cwd: getWebAppDir(),
    env: {
      ...getDesktopRuntimeEnv(),
      ARCHE_RUNTIME_MODE: 'desktop',
      ARCHE_DESKTOP_NEXT_DIST_DIR: '.next-desktop',
      ARCHE_DESKTOP_WEB_PORT: String(getPort()),
      ARCHE_CONNECTOR_GATEWAY_BASE_URL: `http://${LOOPBACK_HOST}:${getPort()}/api/internal/mcp/connectors`,
      PORT: String(getPort()),
      HOSTNAME: LOOPBACK_HOST,
    },
    probeReadiness: () => probeHttpServerReady(getNextUrl()),
    restartOnCrash: true,
    maxRestarts: 3,
    log: (event) => {
      process.stdout.write(`[desktop-supervisor] ${JSON.stringify(event)}\n`)
    },
  })
}

async function initializeDesktopWebPort(): Promise<void> {
  nextPort = await findAvailablePort(DEFAULT_DESKTOP_WEB_PORT, LOOPBACK_HOST)
  process.env.ARCHE_DESKTOP_WEB_PORT = String(nextPort)
}

function installTokenHeaderInjection(): void {
  const nextOrigin = getNextUrl()
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`${nextOrigin}/*`] },
    (details, callback) => {
      details.requestHeaders[DESKTOP_TOKEN_HEADER] = desktopApiToken
      callback({ requestHeaders: details.requestHeaders })
    },
  )
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Arche',
    backgroundColor: '#f7f4ef',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 12 } : undefined,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.loadURL(getNextUrl())

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function shutdownDesktopRuntime(): Promise<void> {
  if (!nextSupervisor) {
    return
  }

  await nextSupervisor.stop()
}

app.whenReady().then(async () => {
  try {
    setDesktopEnv()
  } catch (error) {
    console.error('Failed to initialize desktop environment:', error)
    dialog.showErrorBox('Arche', 'Failed to initialize desktop security configuration.')
    app.quit()
    return
  }

  injectBundledGitIntoPath()
  await ensureDataDirectories()
  resetDesktopDevNextArtifacts()
  await initializeDesktopWebPort()

  const missingRuntimeBinaries = verifyPackagedRuntimeBinaries()
  if (missingRuntimeBinaries.length > 0) {
    dialog.showErrorBox(
      'Arche',
      `Missing packaged runtime resources: ${missingRuntimeBinaries.join(', ')}.`,
    )
    app.quit()
    return
  }

  try {
    await startNextServer()
  } catch (error) {
    console.error('Failed to start Next.js server:', error)
    dialog.showErrorBox('Arche', 'Failed to start the local desktop runtime.')
    app.quit()
    return
  }

  installTokenHeaderInjection()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (!runtimeShutdownRequested) {
    runtimeShutdownRequested = true
    event.preventDefault()
    void shutdownDesktopRuntime().finally(() => {
      app.quit()
    })
  }
})

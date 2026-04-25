import { spawn as spawnChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import { exec as dugiteExecRaw, resolveGitBinary } from 'dugite'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

import type { CreateVaultArgs, DesktopApiResult, DesktopVaultSummary } from './desktop-bridge-types'
import { ensureDesktopConnectorOAuthStateSecret } from './desktop-connector-oauth-secret'
import { ensureDesktopEncryptionKey } from './desktop-encryption-key'
import { buildDesktopLaunchEnv } from './desktop-launch-env'
import { createDesktopSmokeTestHarness } from './desktop-smoke-test'
import { createDesktopVault } from './create-vault'
import { getDesktopNextDistDirName } from './desktop-next-dist'
import {
  getMissingPackagedRuntimeBinaries,
  getPackagedNodeBinaryPath,
  getRuntimeBinaryEnv,
} from './runtime-binaries'
import { findAvailablePort } from './runtime-network'
import { startRuntimeWithPortRetries } from './runtime-start'
import { probeHttpServerReady, RuntimeSupervisor } from './runtime-supervisor'
import { buildLaunchArgs, resolveLaunchContext, type DesktopLaunchContext } from './vault-launch'
import {
  getDesktopKbConfigDir,
  getDesktopKbContentDir,
  getDesktopRuntimeDataDir,
  getDesktopSecretsDir,
  getDesktopUserDataDir,
  getDesktopWorkspaceAttachmentsDir,
  getDesktopWorkspaceDir,
} from './vault-layout'
import { LOCAL_DESKTOP_USER_SLUG } from './vault-layout-constants'
import { acquireVaultLock, getVaultLockState, type VaultLockHandle } from './vault-lock'
import {
  clearLastOpenedVault,
  getRecentVaults,
  readVaultRegistry,
  rememberVault,
  type RecentVaultEntry,
} from './vault-registry'
import { createVaultManifest, tryReadVault, type DesktopVault } from './vault-manifest'

const DEFAULT_DESKTOP_WEB_PORT = 3000
const DESKTOP_RUNTIME_READY_PATH = '/api/internal/desktop/runtime'
const MAX_NEXT_START_ATTEMPTS = 4
const NEXT_READY_TIMEOUT_MS = 30_000
const NEXT_RETRY_READY_TIMEOUT_MS = 20_000
const LOOPBACK_HOST = '127.0.0.1'
const DESKTOP_TOKEN_HEADER = 'x-arche-desktop-token'
const DESKTOP_GIT_AUTHOR_NAME = 'Arche Workspace'
const DESKTOP_GIT_AUTHOR_EMAIL = 'workspace@arche.local'

const smokeTest = createDesktopSmokeTestHarness({ app, dialog })

let mainWindow: BrowserWindow | null = null
let nextSupervisor: RuntimeSupervisor | null = null
let nextPort = DEFAULT_DESKTOP_WEB_PORT
let runtimeShutdownRequested = false
let desktopApiToken = ''
let gatewayTokenSecret = ''
let launchContext: DesktopLaunchContext = { mode: 'launcher', vaultPath: null }
let currentVault: DesktopVault | null = null
let vaultLock: VaultLockHandle | null = null

function generateDesktopApiToken(): string {
  return randomBytes(32).toString('base64url')
}

function generateDesktopGatewayTokenSecret(): string {
  return randomBytes(32).toString('base64url')
}

function getPort(): number {
  return nextPort
}

function getNextUrl(port = getPort()): string {
  return `http://${LOOPBACK_HOST}:${port}`
}

function getDesktopRuntimeReadyUrl(port = getPort()): string {
  return `${getNextUrl(port)}${DESKTOP_RUNTIME_READY_PATH}`
}

function isDesktopRuntimeReadyResponse(response: Response, bodyText: string): boolean {
  if (!response.ok) {
    return false
  }

  try {
    const payload = JSON.parse(bodyText) as Record<string, unknown>
    return payload.app === 'arche' && payload.runtime === 'desktop' && payload.status === 'ok'
  } catch {
    return false
  }
}

function getWebAppDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'web', 'apps', 'web')
  }
  return join(__dirname, '..', '..', 'web')
}

function getDesktopNextDistDirNameForCurrentProcess(): string {
  return getDesktopNextDistDirName({
    currentVaultId: currentVault?.id ?? null,
    isPackaged: app.isPackaged,
    launchContext,
  })
}

function getDesktopMetadataDir(): string {
  return app.getPath('userData')
}

function getCurrentVaultPath(): string | null {
  return currentVault?.path ?? null
}

function getCurrentVaultTitle(): string {
  return currentVault ? `Arche - ${currentVault.name}` : 'Arche'
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
  const gitConfigDir = join(getDesktopMetadataDir(), 'git')
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
  process.env.ARCHE_RUNTIME_MODE = 'desktop'
  process.env.ARCHE_DESKTOP_PLATFORM = process.platform
  process.env.ARCHE_DESKTOP_WEB_HOST = LOOPBACK_HOST
  if (app.isPackaged) {
    process.env.NODE_ENV = 'production'
  }
  if (!process.env.ARCHE_RELEASE_VERSION) {
    process.env.ARCHE_RELEASE_VERSION = app.getVersion()
  }

  const opencodeConfigDir = resolveDesktopOpencodeConfigDir()
  if (opencodeConfigDir) {
    process.env.ARCHE_OPENCODE_CONFIG_DIR = opencodeConfigDir
  } else {
    delete process.env.ARCHE_OPENCODE_CONFIG_DIR
  }

  if (currentVault) {
    process.env.ARCHE_DATA_DIR = currentVault.path
    process.env.ARCHE_OPENCODE_DATA_DIR = getDesktopRuntimeDataDir(currentVault.path)
    process.env.ARCHE_DESKTOP_VAULT_ID = currentVault.id
    process.env.ARCHE_DESKTOP_VAULT_NAME = currentVault.name
    process.env.ARCHE_DESKTOP_VAULT_PATH = currentVault.path
    ensureDesktopEncryptionKey({ dataDir: currentVault.path })
    ensureDesktopConnectorOAuthStateSecret({ dataDir: currentVault.path })
  } else {
    delete process.env.ARCHE_DATA_DIR
    delete process.env.ARCHE_OPENCODE_DATA_DIR
    delete process.env.ARCHE_DESKTOP_VAULT_ID
    delete process.env.ARCHE_DESKTOP_VAULT_NAME
    delete process.env.ARCHE_DESKTOP_VAULT_PATH
    delete process.env.ARCHE_ENCRYPTION_KEY
  }

  ensureIsolatedDesktopGitEnvironment()

  desktopApiToken = generateDesktopApiToken()
  process.env.ARCHE_DESKTOP_API_TOKEN = desktopApiToken

  gatewayTokenSecret = generateDesktopGatewayTokenSecret()
  process.env.ARCHE_GATEWAY_TOKEN_SECRET = gatewayTokenSecret
}

async function dugiteExec(args: string[], cwd: string): Promise<string> {
  const result = await dugiteExecRaw(args, cwd)
  if (result.exitCode !== 0) {
    throw new Error(`git ${args[0]} failed (exit ${result.exitCode}): ${result.stderr}`)
  }
  return result.stdout
}

function injectBundledGitIntoPath(): void {
  const gitBinDir = dirname(resolveGitBinary())
  const sep = process.platform === 'win32' ? ';' : ':'
  process.env.PATH = `${gitBinDir}${sep}${process.env.PATH || ''}`
}

async function ensureBareRepo(dir: string): Promise<void> {
  if (existsSync(join(dir, 'HEAD'))) {
    return
  }

  await dugiteExec(['init', '--bare', dir], '.')

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

async function ensureVaultDataDirectories(vault: DesktopVault): Promise<void> {
  const dirs = [
    vault.path,
    getDesktopKbConfigDir(vault.path),
    getDesktopKbContentDir(vault.path),
    getDesktopWorkspaceDir(vault.path),
    getDesktopUserDataDir(vault.path, LOCAL_DESKTOP_USER_SLUG),
    getDesktopRuntimeDataDir(vault.path),
    getDesktopSecretsDir(vault.path),
  ]

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  await ensureBareRepo(getDesktopKbConfigDir(vault.path))
  await ensureBareRepo(getDesktopKbContentDir(vault.path))
}

function resetDesktopDevNextArtifacts(): void {
  if (app.isPackaged) {
    return
  }

  const desktopDistDir = join(getWebAppDir(), getDesktopNextDistDirNameForCurrentProcess())
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
  await startRuntimeWithPortRetries({
    preferredPort: DEFAULT_DESKTOP_WEB_PORT,
    maxAttempts: MAX_NEXT_START_ATTEMPTS,
    acquirePort: async (preferredPort, excludedPorts) => {
      await initializeDesktopWebPort(preferredPort, excludedPorts)
      return getPort()
    },
    start: async (port, attempt) => {
      const readyTimeoutMs =
        attempt === MAX_NEXT_START_ATTEMPTS ? NEXT_READY_TIMEOUT_MS : NEXT_RETRY_READY_TIMEOUT_MS
      process.stdout.write(
        `[desktop-runtime] starting_next_start attempt=${String(attempt)}/${String(MAX_NEXT_START_ATTEMPTS)} port=${String(port)} ready_timeout_ms=${String(readyTimeoutMs)}\n`,
      )
      nextSupervisor = createNextSupervisor(port, readyTimeoutMs)

      try {
        await nextSupervisor.start()
      } catch (error) {
        nextSupervisor = null
        throw error
      }
    },
    onRetry: ({ attempt, previousPort, error }) => {
      const nextReadyTimeoutMs =
        attempt === MAX_NEXT_START_ATTEMPTS ? NEXT_READY_TIMEOUT_MS : NEXT_RETRY_READY_TIMEOUT_MS
      process.stdout.write(
        `[desktop-runtime] retrying_next_start attempt=${String(attempt)}/${String(MAX_NEXT_START_ATTEMPTS)} previous_port=${String(previousPort)} next_ready_timeout_ms=${String(nextReadyTimeoutMs)} error=${error instanceof Error ? error.message : String(error)}\n`,
      )
    },
  })
}

function createNextSupervisor(port: number, readyTimeoutMs: number): RuntimeSupervisor {
  return new RuntimeSupervisor({
    componentName: 'next',
    command: app.isPackaged ? getPackagedNodeBinaryPath(getRuntimeBinaryOptions()) : 'pnpm',
    args: app.isPackaged
      ? ['server.js']
      : ['exec', 'next', 'dev', '-H', LOOPBACK_HOST, '-p', String(port)],
    cwd: getWebAppDir(),
    env: {
      ...getDesktopRuntimeEnv(),
      ARCHE_RUNTIME_MODE: 'desktop',
      ARCHE_DESKTOP_NEXT_DIST_DIR: getDesktopNextDistDirNameForCurrentProcess(),
      ARCHE_DESKTOP_WEB_PORT: String(port),
      ARCHE_CONNECTOR_GATEWAY_BASE_URL: `http://${LOOPBACK_HOST}:${String(port)}/api/internal/mcp/connectors`,
      PORT: String(port),
      HOSTNAME: LOOPBACK_HOST,
    },
    readyTimeoutMs,
    probeReadiness: () =>
      probeHttpServerReady(getDesktopRuntimeReadyUrl(port), {
        headers: {
          [DESKTOP_TOKEN_HEADER]: desktopApiToken,
        },
        validateResponse: isDesktopRuntimeReadyResponse,
      }),
    restartOnCrash: true,
    maxRestarts: 3,
    log: (event) => {
      process.stdout.write(`[desktop-supervisor] ${JSON.stringify(event)}\n`)
    },
  })
}

async function initializeDesktopWebPort(
  preferredPort: number,
  excludedPorts: number[] = [],
): Promise<void> {
  nextPort = await findAvailablePort(preferredPort, LOOPBACK_HOST, excludedPorts)
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
  const isLauncher = currentVault === null

  mainWindow = new BrowserWindow({
    width: isLauncher ? 680 : 1280,
    height: isLauncher ? 680 : 800,
    minWidth: isLauncher ? 560 : 800,
    minHeight: isLauncher ? 560 : 600,
    title: getCurrentVaultTitle(),
    backgroundColor: '#f7f4ef',
    show: smokeTest.shouldShowWindow(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 12 } : undefined,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  smokeTest.installWindowHooks(mainWindow)

  void mainWindow.loadURL(getNextUrl())

  mainWindow.webContents.on('dom-ready', () => {
    void mainWindow?.webContents.executeJavaScript(`
      // Next's desktop renderer can surface transient BigInt serialization
      // errors during RSC hydration. Normalize them to strings in JSON paths.
      if (!BigInt.prototype.toJSON) {
        BigInt.prototype.toJSON = function() {
          return this.toString()
        }
      }

      void 0
    `)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
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

function toDesktopVaultSummary(vault: DesktopVault): DesktopVaultSummary {
  return {
    id: vault.id,
    name: vault.name,
    path: vault.path,
  }
}

function toRecentVaultSummary(entry: RecentVaultEntry): DesktopVaultSummary {
  return {
    id: entry.id,
    name: entry.name,
    path: entry.path,
    lastOpenedAt: entry.lastOpenedAt,
  }
}

function getRecentVaultSummaries(): DesktopVaultSummary[] {
  return getRecentVaults(getDesktopMetadataDir()).map(toRecentVaultSummary)
}

function getVaultAlreadyOpenError(vaultPath: string): string {
  const state = getVaultLockState(vaultPath)
  return state.locked ? 'vault_already_open' : 'vault_launch_failed'
}

function launchElectronProcess(nextContext: DesktopLaunchContext): DesktopApiResult {
  try {
    const args = buildLaunchArgs(process.argv.slice(1), nextContext)
    const child = spawnChildProcess(process.execPath, args, {
      detached: true,
      env: buildDesktopLaunchEnv(process.env),
      stdio: 'ignore',
    })
    child.unref()
    return { ok: true }
  } catch {
    return { ok: false, error: 'vault_launch_failed' }
  }
}

function launchVaultProcess(vaultPath: string): DesktopApiResult {
  const vault = tryReadVault(vaultPath)
  if (!vault) {
    return { ok: false, error: 'invalid_vault' }
  }

  if (vault.path === getCurrentVaultPath()) {
    return { ok: false, error: 'vault_already_open' }
  }

  if (getVaultLockState(vault.path).locked) {
    return { ok: false, error: getVaultAlreadyOpenError(vault.path) }
  }

  rememberVault(getDesktopMetadataDir(), vault)
  return launchElectronProcess({ mode: 'vault', vaultPath: vault.path })
}

async function applyKickstartToPreparedVault(vaultPath: string, kickstartPayload: unknown): Promise<DesktopApiResult> {
  try {
    const response = await fetch(`${getNextUrl()}/api/internal/desktop/kickstart/prepare-vault`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [DESKTOP_TOKEN_HEADER]: desktopApiToken,
      },
      body: JSON.stringify({ kickstartPayload, vaultPath }),
    })

    if (response.ok) {
      return { ok: true }
    }

    return { ok: false, error: 'vault_setup_failed' }
  } catch {
    return { ok: false, error: 'vault_setup_failed' }
  }
}

function openVaultLauncherProcess(): DesktopApiResult {
  return launchElectronProcess({ mode: 'launcher', vaultPath: null })
}

function quitLauncherProcess(): DesktopApiResult {
  if (currentVault) {
    return { ok: false, error: 'launcher_not_active' }
  }

  setTimeout(() => {
    app.quit()
  }, 0)

  return { ok: true }
}

async function revealAttachmentsDirectory(): Promise<DesktopApiResult> {
  if (!currentVault) {
    return { ok: false, error: 'vault_not_open' }
  }

  const attachmentsDir = getDesktopWorkspaceAttachmentsDir(currentVault.path)
  if (!existsSync(attachmentsDir)) {
    mkdirSync(attachmentsDir, { recursive: true })
  }

  const error = await shell.openPath(attachmentsDir)
  if (error) {
    return { ok: false, error: 'reveal_attachments_failed' }
  }

  return { ok: true }
}

async function pickDirectory(options: {
  title: string
  defaultPath?: string | null
  createDirectory?: boolean
}): Promise<string | null> {
  const dialogOptions = {
    title: options.title,
    defaultPath: options.defaultPath ?? undefined,
    properties: options.createDirectory ? ['openDirectory', 'createDirectory'] : ['openDirectory'],
  } satisfies Electron.OpenDialogOptions

  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions)

  if (result.canceled) {
    return null
  }

  return result.filePaths[0] ?? null
}

async function createVault(args: CreateVaultArgs): Promise<DesktopApiResult> {
  return createDesktopVault(args, {
    applyKickstartToPreparedVault,
    createVaultManifest,
    ensureVaultDataDirectories,
    getDesktopMetadataDir,
    launchVaultProcess: (vaultPath) => launchElectronProcess({ mode: 'vault', vaultPath }),
    rememberVault,
  })
}

async function openExistingVaultFromDialog(): Promise<DesktopApiResult> {
  const selectedPath = await pickDirectory({ title: 'Open Arche vault' })
  if (!selectedPath) {
    return { ok: false, error: 'cancelled' }
  }

  return launchVaultProcess(selectedPath)
}

function registerDesktopIpcHandlers(): void {
  ipcMain.handle('desktop:list-recent-vaults', () => getRecentVaultSummaries())
  ipcMain.handle('desktop:get-current-vault', () => (currentVault ? toDesktopVaultSummary(currentVault) : null))
  ipcMain.handle('desktop:pick-vault-parent-directory', async () => {
    return pickDirectory({
      title: 'Choose a location for the new vault',
      defaultPath: app.getPath('documents'),
      createDirectory: true,
    })
  })
  ipcMain.handle('desktop:create-vault', async (_event, args: CreateVaultArgs) => createVault(args))
  ipcMain.handle('desktop:open-existing-vault', async () => openExistingVaultFromDialog())
  ipcMain.handle('desktop:open-vault', async (_event, vaultPath: string) => launchVaultProcess(vaultPath))
  ipcMain.handle('desktop:open-vault-launcher', async () => openVaultLauncherProcess())
  ipcMain.handle('desktop:quit-launcher-process', async () => quitLauncherProcess())
  ipcMain.handle('desktop:reveal-attachments-directory', async () => revealAttachmentsDirectory())
}

function resolveStartupVault(): DesktopVault | null {
  const metadataDir = getDesktopMetadataDir()
  const registry = readVaultRegistry(metadataDir)
  launchContext = resolveLaunchContext(process.argv.slice(1), registry.lastOpenedVaultPath)

  smokeTest.reportLaunchContext(launchContext)

  if (launchContext.mode === 'launcher') {
    return null
  }

  const vault = tryReadVault(launchContext.vaultPath)
  if (!vault) {
    smokeTest.reportInvalidVault(launchContext.vaultPath)

    if (registry.lastOpenedVaultPath === launchContext.vaultPath) {
      clearLastOpenedVault(metadataDir, launchContext.vaultPath)
    }
    launchContext = { mode: 'launcher', vaultPath: null }
    return null
  }

  rememberVault(metadataDir, vault)
  return vault
}

app.whenReady().then(async () => {
  currentVault = resolveStartupVault()

  if (currentVault) {
    vaultLock = acquireVaultLock(currentVault.path)
    if (!vaultLock) {
      if (smokeTest.handleStartupFailure(
        'Arche',
        `The vault "${currentVault.name}" is already open in another Arche process.`,
      )) {
        return
      }
      currentVault = null
      launchContext = { mode: 'launcher', vaultPath: null }
    }
  }

  try {
    setDesktopEnv()
  } catch (error) {
    console.error('Failed to initialize desktop environment:', error)
    if (smokeTest.handleStartupFailure('Arche', 'Failed to initialize desktop security configuration.')) {
      return
    }
    app.quit()
    return
  }

  injectBundledGitIntoPath()

  if (currentVault) {
    try {
      await ensureVaultDataDirectories(currentVault)
    } catch (error) {
      console.error('Failed to initialize vault data directories:', error)
      if (smokeTest.handleStartupFailure('Arche', 'Failed to initialize the selected vault.')) {
        return
      }
      app.quit()
      return
    }
  }

  resetDesktopDevNextArtifacts()

  const missingRuntimeBinaries = verifyPackagedRuntimeBinaries()
  if (missingRuntimeBinaries.length > 0) {
    if (smokeTest.handleStartupFailure(
      'Arche',
      `Missing packaged runtime resources: ${missingRuntimeBinaries.join(', ')}.`,
    )) {
      return
    }
    app.quit()
    return
  }

  try {
    await startNextServer()
  } catch (error) {
    console.error('Failed to start Next.js server:', error)
    if (smokeTest.handleStartupFailure('Arche', 'Failed to start the local desktop runtime.')) {
      return
    }
    app.quit()
    return
  }

  installTokenHeaderInjection()
  registerDesktopIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // Each desktop window owns a vault-specific backend. Leaving the process
  // alive after the last window closes keeps that backend bound to the old
  // vault and can leak stale state into the next launch.
  app.quit()
})

app.on('before-quit', (event) => {
  if (!runtimeShutdownRequested) {
    runtimeShutdownRequested = true
    event.preventDefault()
    void shutdownDesktopRuntime().finally(() => {
      vaultLock?.release()
      vaultLock = null
      app.quit()
    })
  }
})

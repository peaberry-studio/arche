import { app, BrowserWindow, dialog, shell } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

import { probeHttpServerReady, RuntimeSupervisor } from './runtime-supervisor'

const DEV_PORT = 3000
const PROD_PORT = 3000

let mainWindow: BrowserWindow | null = null
let nextSupervisor: RuntimeSupervisor | null = null
let runtimeShutdownRequested = false

function getPort(): number {
  return app.isPackaged ? PROD_PORT : DEV_PORT
}

function getNextUrl(): string {
  return `http://127.0.0.1:${getPort()}`
}

function getWebAppDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'web')
  }
  return join(__dirname, '..', '..', 'web')
}

function getDataDir(): string {
  return process.env.ARCHE_DATA_DIR || join(app.getPath('home'), '.arche')
}

function setDesktopEnv(): void {
  process.env.ARCHE_RUNTIME_MODE = 'desktop'
  process.env.ARCHE_DESKTOP_PLATFORM = process.platform
  if (app.isPackaged) {
    process.env.NODE_ENV = 'production'
  }
  process.env.ARCHE_DATA_DIR = getDataDir()
}

function ensureDataDirectories(): void {
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
}

function getOpencodeBinaryPath(): string {
  if (process.env.ARCHE_OPENCODE_BIN) {
    return process.env.ARCHE_OPENCODE_BIN
  }

  if (app.isPackaged) {
    return join(process.resourcesPath, 'bin', 'opencode')
  }

  // Development: look in apps/desktop/bin/ first, then fall back to PATH
  const devBin = join(__dirname, '..', 'bin', 'opencode')
  if (existsSync(devBin)) {
    return devBin
  }

  return 'opencode'
}

function verifyOpencodeBinary(): boolean {
  const binary = getOpencodeBinaryPath()
  if (binary === 'opencode') return true // PATH lookup, assume available in dev
  return existsSync(binary)
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
    command: app.isPackaged ? 'node' : 'pnpm',
    args: app.isPackaged ? ['server.js'] : ['dev'],
    cwd: getWebAppDir(),
    env: {
      ...process.env,
      ARCHE_RUNTIME_MODE: 'desktop',
      PORT: String(getPort()),
      HOSTNAME: '127.0.0.1',
    },
    probeReadiness: () => probeHttpServerReady(getNextUrl()),
    log: (event) => {
      process.stdout.write(`[desktop-supervisor] ${JSON.stringify(event)}\n`)
    },
  })
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
  setDesktopEnv()
  ensureDataDirectories()

  if (!verifyOpencodeBinary()) {
    dialog.showErrorBox(
      'Arche',
      'OpenCode binary not found. The application may not have been packaged correctly.',
    )
  }

  try {
    await startNextServer()
  } catch (error) {
    console.error('Failed to start Next.js server:', error)
    dialog.showErrorBox('Arche', 'Failed to start the local desktop runtime.')
    app.quit()
    return
  }

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

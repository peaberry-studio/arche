import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { spawn, type ChildProcess } from 'child_process'

const WEB_APP_DIR = join(__dirname, '..', '..', 'web')
const DEV_PORT = 3000
const PROD_PORT = 3000

let mainWindow: BrowserWindow | null = null
let nextProcess: ChildProcess | null = null

function getPort(): number {
  return app.isPackaged ? PROD_PORT : DEV_PORT
}

function getNextUrl(): string {
  return `http://localhost:${getPort()}`
}

function setDesktopEnv(): void {
  process.env.ARCHE_RUNTIME_MODE = 'desktop'
  process.env.NODE_ENV = process.env.NODE_ENV || 'production'
}

async function startNextServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const port = getPort()
    const command = app.isPackaged ? 'start' : 'dev'

    nextProcess = spawn('pnpm', [command], {
      cwd: WEB_APP_DIR,
      env: {
        ...process.env,
        ARCHE_RUNTIME_MODE: 'desktop',
        PORT: String(port),
      },
      stdio: 'pipe',
      shell: true,
    })

    let started = false

    const onData = (data: Buffer): void => {
      const output = data.toString()
      process.stdout.write(`[next] ${output}`)

      if (!started && output.includes('Ready')) {
        started = true
        resolve()
      }
    }

    nextProcess.stdout?.on('data', onData)
    nextProcess.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(`[next:err] ${data.toString()}`)
    })

    nextProcess.on('error', (error) => {
      if (!started) reject(error)
    })

    nextProcess.on('exit', (code) => {
      if (!started) reject(new Error(`Next.js exited with code ${code}`))
      nextProcess = null
    })

    // Timeout: if Next.js hasn't started in 30s, resolve anyway
    // (the window will show a loading state)
    setTimeout(() => {
      if (!started) {
        started = true
        resolve()
      }
    }, 30_000)
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Arche',
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

function stopNextServer(): void {
  if (nextProcess && !nextProcess.killed) {
    nextProcess.kill('SIGTERM')
    nextProcess = null
  }
}

app.whenReady().then(async () => {
  setDesktopEnv()

  try {
    await startNextServer()
  } catch (error) {
    console.error('Failed to start Next.js server:', error)
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

app.on('before-quit', () => {
  stopNextServer()
})

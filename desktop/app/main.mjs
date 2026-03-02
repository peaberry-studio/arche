import { randomBytes, randomUUID, createHash } from 'crypto'
import { spawn } from 'child_process'
import { closeSync, existsSync, openSync } from 'fs'
import { appendFile, mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { createConnection } from 'net'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import argon2 from 'argon2'
import EmbeddedPostgres from 'embedded-postgres'
import electron from 'electron'
import { Pool } from 'pg'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const { app, BrowserWindow } = electron

const WEB_HOST = '127.0.0.1'
const WEB_PORT = 4510
const DB_PORT = 55432
const STARTUP_TIMEOUT_MS = 180_000

const DEFAULT_ADMIN_EMAIL = 'admin@example.com'
const DEFAULT_ADMIN_PASSWORD = 'change-me'
const DEFAULT_ADMIN_SLUG = 'admin'

let mainWindow = null
let webProcess = null
let postgres = null
let shuttingDown = false
let runtimeContext = null

function nowIso() {
  return new Date().toISOString()
}

function runtimeAssetsRoot() {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'runtime')
  }

  return join(__dirname, 'runtime')
}

function desktopLogPath() {
  if (!runtimeContext) return null
  return join(runtimeContext.paths.logsDir, 'desktop.log')
}

async function log(message) {
  const line = `[${nowIso()}] ${message}`
  console.log(line)

  const logPath = desktopLogPath()
  if (!logPath) return

  try {
    await appendFile(logPath, `${line}\n`, 'utf-8')
  } catch {
    // ignore logging failures
  }
}

function toBase64Secret(bytes = 32) {
  return randomBytes(bytes).toString('base64')
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true, mode: 0o700 })
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => reject(error))
    child.on('close', (code) => {
      resolve({
        code: typeof code === 'number' ? code : -1,
        stderr,
        stdout,
      })
    })
  })
}

async function ensureBareRepo(repoPath) {
  await ensureDir(dirname(repoPath))

  const init = await runCommand('git', ['init', '--bare', '--initial-branch=main', repoPath])
  if (init.code !== 0) {
    throw new Error(init.stderr.trim() || `Unable to initialize bare repo: ${repoPath}`)
  }

  const setHead = await runCommand('git', ['--git-dir', repoPath, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
  if (setHead.code !== 0) {
    throw new Error(setHead.stderr.trim() || `Unable to set default branch to main: ${repoPath}`)
  }

  const isBare = await runCommand('git', ['--git-dir', repoPath, 'rev-parse', '--is-bare-repository'])
  if (isBare.code !== 0 || isBare.stdout.trim() !== 'true') {
    throw new Error(`Path is not a bare git repo: ${repoPath}`)
  }
}

function ensureRuntimeAssets(paths) {
  const requiredPaths = [
    join(paths.assetsRoot, 'bin', 'opencode'),
    join(paths.assetsRoot, 'bin', 'workspace-agent'),
    join(paths.assetsRoot, 'web', 'standalone', 'server.js'),
    join(paths.assetsRoot, 'web', 'prisma', 'migrations'),
  ]

  for (const path of requiredPaths) {
    if (!existsSync(path)) {
      throw new Error(`Desktop runtime asset not found: ${path}`)
    }
  }
}

async function loadOrCreateSecrets(path) {
  if (existsSync(path)) {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw)
  }

  const secrets = {
    ARCHE_CONNECTOR_OAUTH_STATE_SECRET: toBase64Secret(32),
    ARCHE_ENCRYPTION_KEY: toBase64Secret(32),
    ARCHE_GATEWAY_TOKEN_SECRET: toBase64Secret(32),
    ARCHE_INTERNAL_TOKEN: toBase64Secret(32),
    ARCHE_SESSION_PEPPER: toBase64Secret(32),
  }

  await writeFile(path, `${JSON.stringify(secrets, null, 2)}\n`, 'utf-8')
  return secrets
}

async function createRuntimeContext() {
  const userRuntimeRoot = join(app.getPath('userData'), 'runtime')
  const paths = {
    assetsRoot: runtimeAssetsRoot(),
    kbConfigPath: join(userRuntimeRoot, 'kb-config'),
    kbContentPath: join(userRuntimeRoot, 'kb-content'),
    logsDir: join(userRuntimeRoot, 'logs'),
    postgresDir: join(userRuntimeRoot, 'postgres'),
    runtimeRoot: userRuntimeRoot,
    secretsPath: join(userRuntimeRoot, 'secrets.json'),
    usersPath: join(userRuntimeRoot, 'users'),
  }

  await ensureDir(paths.runtimeRoot)
  await ensureDir(paths.logsDir)
  await ensureDir(paths.usersPath)
  await ensureDir(paths.postgresDir)

  await ensureBareRepo(paths.kbContentPath)
  await ensureBareRepo(paths.kbConfigPath)
  ensureRuntimeAssets(paths)

  const secrets = await loadOrCreateSecrets(paths.secretsPath)
  return { paths, secrets }
}

async function ensureDatabase(url) {
  const adminUrl = `postgresql://postgres:postgres@${WEB_HOST}:${DB_PORT}/postgres`
  const adminPool = new Pool({ connectionString: adminUrl })

  try {
    const existing = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', ['arche'])
    if (existing.rowCount === 0) {
      await adminPool.query('CREATE DATABASE arche')
    }
  } finally {
    await adminPool.end()
  }

  const pool = new Pool({ connectionString: url })
  return pool
}

async function runMigrations(pool, migrationsDir) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS arche_desktop_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  const entries = await readdir(migrationsDir, { withFileTypes: true })
  const migrationDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  for (const migrationName of migrationDirs) {
    const migrationPath = join(migrationsDir, migrationName, 'migration.sql')
    if (!existsSync(migrationPath)) continue

    const sql = await readFile(migrationPath, 'utf-8')
    const checksum = createHash('sha256').update(sql).digest('hex')

    const applied = await pool.query(
      'SELECT 1 FROM arche_desktop_migrations WHERE name = $1 LIMIT 1',
      [migrationName],
    )
    if (applied.rowCount > 0) continue

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query(
        'INSERT INTO arche_desktop_migrations(name, checksum) VALUES ($1, $2)',
        [migrationName, checksum],
      )
      await client.query('COMMIT')
      await log(`Applied migration ${migrationName}`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

async function seedAdminUser(pool) {
  const email = (process.env.ARCHE_SEED_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase()
  const password = process.env.ARCHE_SEED_ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD
  const slug = (process.env.ARCHE_SEED_ADMIN_SLUG || DEFAULT_ADMIN_SLUG).trim().toLowerCase()

  const existing = await pool.query(
    'SELECT id FROM users WHERE email = $1 OR slug = $2 LIMIT 1',
    [email, slug],
  )
  if (existing.rowCount > 0) return

  const passwordHash = await argon2.hash(password)
  await pool.query(
    `INSERT INTO users (
      id,
      email,
      slug,
      role,
      password_hash,
      totp_enabled,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, 'ADMIN', $4, false, NOW(), NOW())`,
    [randomUUID(), email, slug, passwordHash],
  )

  await log(`Created seed admin user ${email}`)
}

function runtimeBinaryPath(name) {
  return join(runtimeContext.paths.assetsRoot, 'bin', name)
}

async function startEmbeddedPostgres() {
  postgres = new EmbeddedPostgres({
    authMethod: 'password',
    databaseDir: runtimeContext.paths.postgresDir,
    password: 'postgres',
    persistent: true,
    port: DB_PORT,
    user: 'postgres',
  })

  const pgVersionPath = join(runtimeContext.paths.postgresDir, 'PG_VERSION')
  const requiresInit = !existsSync(pgVersionPath)

  if (requiresInit) {
    await log('Initializing embedded PostgreSQL data directory')
    try {
      await postgres.initialise()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isExistingDataDir =
        message.includes('data directory might already exist') ||
        message.includes('already exist')

      if (!isExistingDataDir) {
        throw error
      }

      await log(`PostgreSQL init skipped: ${message}`)
    }
  } else {
    await log('Embedded PostgreSQL data directory already initialized')
  }

  await postgres.start()
  await log(`Embedded PostgreSQL started on ${WEB_HOST}:${DB_PORT}`)
}

async function isWebPortOpen() {
  return new Promise((resolve) => {
    const socket = createConnection({ host: WEB_HOST, port: WEB_PORT })

    const finish = (open) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(open)
    }

    socket.setTimeout(1000)
    socket.on('connect', () => finish(true))
    socket.on('timeout', () => finish(false))
    socket.on('error', () => finish(false))
  })
}

async function waitForWebServerReady() {
  const startedAt = Date.now()
  let attempts = 0

  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    attempts += 1

    if (await isWebPortOpen()) {
      return
    }

    if (attempts % 15 === 0) {
      await log(`Waiting for web server port ${WEB_HOST}:${WEB_PORT}...`)
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`Timed out waiting for web server port: ${WEB_HOST}:${WEB_PORT}`)
}

async function checkWebHealth() {
  const healthUrl = `http://${WEB_HOST}:${WEB_PORT}/api/health`

  try {
    const response = await fetch(healthUrl, { cache: 'no-store' })
    if (response.ok) return true

    const body = await response.text().catch(() => '')
    await log(`Web health endpoint returned ${response.status}: ${body.slice(0, 300)}`)
    return false
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await log(`Web health endpoint request failed: ${message}`)
    return false
  }
}

async function readWebLogsTail() {
  const logPath = join(runtimeContext.paths.logsDir, 'web.log')
  if (!existsSync(logPath)) {
    return 'No web logs found.'
  }

  const raw = await readFile(logPath, 'utf-8')
  const lines = raw.split(/\r?\n/)
  return lines.slice(-120).join('\n')
}

async function startWebServer(databaseUrl) {
  const standaloneDir = join(runtimeContext.paths.assetsRoot, 'web', 'standalone')
  const serverEntry = join(standaloneDir, 'server.js')
  if (!existsSync(serverEntry)) {
    throw new Error(`Missing bundled web server entrypoint: ${serverEntry}`)
  }

  const opencodeBin = runtimeBinaryPath('opencode')
  const workspaceAgentBin = runtimeBinaryPath('workspace-agent')

  if (!existsSync(opencodeBin)) {
    throw new Error(`Missing opencode binary: ${opencodeBin}`)
  }
  if (!existsSync(workspaceAgentBin)) {
    throw new Error(`Missing workspace-agent binary: ${workspaceAgentBin}`)
  }

  const webLogPath = join(runtimeContext.paths.logsDir, 'web.log')
  const logFd = openSync(webLogPath, 'a')

  const webEnv = {
    ...process.env,
    ARCHE_CONNECTOR_OAUTH_STATE_SECRET: runtimeContext.secrets.ARCHE_CONNECTOR_OAUTH_STATE_SECRET,
    ARCHE_DESKTOP_DEFAULT_USER_SLUG: DEFAULT_ADMIN_SLUG,
    ARCHE_DESKTOP_NO_AUTH: 'true',
    ARCHE_COOKIE_DOMAIN: '',
    ARCHE_COOKIE_SECURE: 'false',
    ARCHE_DOMAIN: 'localhost',
    ARCHE_ENCRYPTION_KEY: runtimeContext.secrets.ARCHE_ENCRYPTION_KEY,
    ARCHE_GATEWAY_BASE_URL: '',
    ARCHE_GATEWAY_TOKEN_SECRET: runtimeContext.secrets.ARCHE_GATEWAY_TOKEN_SECRET,
    ARCHE_INTERNAL_TOKEN: runtimeContext.secrets.ARCHE_INTERNAL_TOKEN,
    ARCHE_LOCAL_INSTANCE_HOST: WEB_HOST,
    ARCHE_LOCAL_OPENCODE_PORT_BASE: '42000',
    ARCHE_OPENCODE_BIN: opencodeBin,
    ARCHE_PUBLIC_BASE_URL: `http://${WEB_HOST}:${WEB_PORT}`,
    ARCHE_SESSION_PEPPER: runtimeContext.secrets.ARCHE_SESSION_PEPPER,
    ARCHE_SPAWNER_BACKEND: 'local',
    ARCHE_USERS_PATH: runtimeContext.paths.usersPath,
    ARCHE_WORKSPACE_AGENT_BIN: workspaceAgentBin,
    DATABASE_URL: databaseUrl,
    ELECTRON_RUN_AS_NODE: '1',
    HOSTNAME: WEB_HOST,
    KB_CONFIG_HOST_PATH: runtimeContext.paths.kbConfigPath,
    KB_CONTENT_HOST_PATH: runtimeContext.paths.kbContentPath,
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_ENV: 'production',
    PORT: String(WEB_PORT),
  }

  webProcess = spawn(process.execPath, [serverEntry], {
    cwd: standaloneDir,
    env: webEnv,
    stdio: ['ignore', logFd, logFd],
  })

  closeSync(logFd)

  const waitForReady = await new Promise((resolve, reject) => {
    const onError = (error) => {
      reject(
        new Error(
          `Failed to spawn web server (${serverEntry}) with cwd=${standaloneDir}: ${error.message}`,
        ),
      )
    }

    const onExit = (code, signal) => {
      reject(
        new Error(
          `Web process exited before healthcheck (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
        ),
      )
    }

    webProcess.once('error', onError)
    webProcess.once('exit', onExit)

    waitForWebServerReady()
      .then(() => {
        webProcess.off('error', onError)
        webProcess.off('exit', onExit)
        resolve()
      })
      .catch((error) => {
        webProcess.off('error', onError)
        webProcess.off('exit', onExit)
        reject(error)
      })
  })
  await waitForReady

  webProcess.on('exit', async (code, signal) => {
    await log(`Web process exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`)
  })

  const healthy = await checkWebHealth()
  if (healthy) {
    await log('Web server is healthy')
  } else {
    await log('Web server is reachable, but /api/health is not healthy yet')
  }
}

async function killProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }

  for (let index = 0; index < 20; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // ignore
  }
}

async function stopWorkspaceProcesses() {
  const usersPath = runtimeContext.paths.usersPath
  const users = await readdir(usersPath, { withFileTypes: true }).catch(() => [])

  for (const userEntry of users) {
    if (!userEntry.isDirectory()) continue

    const statePath = join(usersPath, userEntry.name, '.runtime-local', 'container-state.json')
    if (!existsSync(statePath)) continue

    try {
      const raw = await readFile(statePath, 'utf-8')
      const state = JSON.parse(raw)
      await killProcess(Number(state.workspaceAgentPid))
      await killProcess(Number(state.opencodePid))
    } catch {
      // ignore cleanup errors for individual users
    }
  }
}

async function stopWebServer() {
  if (!webProcess) return

  const processRef = webProcess
  webProcess = null

  if (!processRef.pid) {
    return
  }

  await killProcess(processRef.pid)
}

async function shutdownRuntime() {
  try {
    await stopWebServer()
    await stopWorkspaceProcesses()

    if (postgres) {
      await postgres.stop()
      postgres = null
    }
  } catch (error) {
    console.error(error)
  }
}

function renderStartupError(error, logs) {
  const title = 'Unable to start Arche Desktop'
  const detail = error instanceof Error ? error.message : String(error)
  const escapedDetail = detail.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const escapedLogs = logs.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Arche Desktop</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; margin: 0; }
      main { max-width: 880px; margin: 40px auto; padding: 0 24px; }
      h1 { margin: 0; font-size: 1.45rem; }
      p { color: #334155; }
      pre { margin-top: 16px; background: #0f172a; color: #e2e8f0; padding: 14px; border-radius: 10px; overflow: auto; max-height: 420px; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${escapedDetail}</p>
      <pre>${escapedLogs}</pre>
    </main>
  </body>
</html>`
}

async function bootstrapDesktop() {
  runtimeContext = await createRuntimeContext()
  await log('Runtime directories prepared')

  await startEmbeddedPostgres()

  const databaseUrl = `postgresql://postgres:postgres@${WEB_HOST}:${DB_PORT}/arche?schema=public`
  const pool = await ensureDatabase(databaseUrl)
  try {
    const migrationsDir = join(runtimeContext.paths.assetsRoot, 'web', 'prisma', 'migrations')
    await runMigrations(pool, migrationsDir)
    await seedAdminUser(pool)
  } finally {
    await pool.end()
  }

  await startWebServer(databaseUrl)
}

function createMainWindow() {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icons', 'icon.icns')
    : join(__dirname, 'icons', 'icon.icns')
  mainWindow = new BrowserWindow({
    backgroundColor: '#f3f6fc',
    height: 940,
    icon: existsSync(iconPath) ? iconPath : undefined,
    minHeight: 760,
    minWidth: 1180,
    show: false,
    title: 'Arche Desktop',
    width: 1460,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

async function startApp() {
  const window = createMainWindow()
  await window.loadFile(join(__dirname, 'splash.html'))
  window.show()

  try {
    await bootstrapDesktop()
    await window.loadURL(`http://${WEB_HOST}:${WEB_PORT}`)
  } catch (error) {
    const logs = await readWebLogsTail().catch(() => 'Failed to read web logs.')
    const html = renderStartupError(error, logs)
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await log(`Startup error: ${error instanceof Error ? error.stack || error.message : String(error)}`)
  }
}

app.whenReady().then(async () => {
  await startApp()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await startApp()
    }
  })
})

app.on('before-quit', (event) => {
  if (shuttingDown) return
  shuttingDown = true
  event.preventDefault()

  shutdownRuntime()
    .finally(() => {
      app.exit(0)
    })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

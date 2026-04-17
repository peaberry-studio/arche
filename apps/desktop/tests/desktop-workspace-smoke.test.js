const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync, spawn } = require('node:child_process')
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')

const electronPath = require('electron')

const { getDesktopKbConfigDir, getDesktopKbContentDir } = require('../dist/vault-layout.js')
const { createVaultManifest } = require('../dist/vault-manifest.js')

const APP_SMOKE_TIMEOUT_MS = 180_000
const TEST_TIMEOUT_MS = APP_SMOKE_TIMEOUT_MS + 30_000

async function withTempDir(run) {
  const root = mkdtempSync(join(tmpdir(), 'arche-desktop-smoke-'))
  try {
    return await run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function runGit(args, cwd) {
  execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
    stdio: 'pipe',
  })
}

function createBareRepoWithFiles(repoPath, files) {
  mkdirSync(repoPath, { recursive: true })
  runGit(['init', '--bare', '--initial-branch=main', repoPath], join(repoPath, '..'))

  const checkoutDir = mkdtempSync(join(tmpdir(), 'arche-desktop-smoke-repo-'))

  try {
    runGit(['clone', repoPath, checkoutDir], join(repoPath, '..'))

    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = join(checkoutDir, relativePath)
      mkdirSync(dirname(absolutePath), { recursive: true })
      writeFileSync(absolutePath, content, 'utf-8')
    }

    runGit(['add', '-A'], checkoutDir)
    runGit(
      [
        '-c',
        'user.name=Arche Smoke',
        '-c',
        'user.email=smoke@arche.local',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-m',
        'Initialize smoke vault',
      ],
      checkoutDir,
    )
    runGit(['push', 'origin', 'HEAD:refs/heads/main'], checkoutDir)
  } finally {
    rmSync(checkoutDir, { recursive: true, force: true })
  }
}

function createKickstartedVault(rootDir) {
  const vaultPath = join(rootDir, 'smoke-vault')
  mkdirSync(vaultPath, { recursive: true })
  createVaultManifest(vaultPath, 'smoke-vault')

  createBareRepoWithFiles(getDesktopKbConfigDir(vaultPath), {
    'AGENTS.md': '# Arche\n',
    'CommonWorkspaceConfig.json': `${JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        default_agent: 'assistant',
        agent: {
          assistant: {
            display_name: 'Assistant',
            mode: 'primary',
            model: 'openai/gpt-5.2',
            prompt: 'You are a helpful assistant.',
            tools: {
              bash: true,
              edit: true,
              write: true,
            },
          },
        },
      },
      null,
      2,
    )}\n`,
  })

  createBareRepoWithFiles(getDesktopKbContentDir(vaultPath), {
    'README.md': '# Smoke Test\n',
  })

  return vaultPath
}

test('opens the desktop workspace and accepts authenticated POST requests', { timeout: TEST_TIMEOUT_MS, skip: process.platform !== 'darwin' }, async (t) => {
  await withTempDir(async (rootDir) => {
    const vaultPath = createKickstartedVault(rootDir)
    const stdout = []
    const stderr = []
    const desktopDir = join(__dirname, '..')
    const mainEntry = join(desktopDir, 'dist', 'main.js')

    const child = spawn(electronPath, [mainEntry, `--vault-path=${vaultPath}`], {
      cwd: desktopDir,
      env: {
        ...process.env,
        ARCHE_DESKTOP_SMOKE_TEST: '1',
        ARCHE_DESKTOP_SMOKE_TEST_EXPECTED_PATH: '/w/local',
        ARCHE_DESKTOP_SMOKE_TEST_TIMEOUT_MS: String(APP_SMOKE_TIMEOUT_MS),
        ELECTRON_ENABLE_LOGGING: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    t.after(() => {
      if (!child.killed) {
        child.kill('SIGKILL')
      }
    })

    child.stdout.on('data', (chunk) => {
      stdout.push(chunk.toString())
    })

    child.stderr.on('data', (chunk) => {
      stderr.push(chunk.toString())
    })

    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for Electron workspace launch\n\n${stdout.join('')}${stderr.join('')}`))
      }, TEST_TIMEOUT_MS)

      child.once('error', reject)
      child.once('exit', (code, signal) => {
        clearTimeout(timeout)
        resolve({ code, signal })
      })
    })

    const output = `${stdout.join('')}${stderr.join('')}`

    assert.deepEqual(result, { code: 0, signal: null }, output)
    assert.match(output, /\[desktop-smoke\] success path=\/w\/local probe=400:invalid_json/)
  })
})

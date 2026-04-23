import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { ensureBareRepo, writeBareRepoFiles } from './lib/bare-repo.mjs'

const DEFAULT_VAULT_NAME = 'arche-e2e-vault'
const LOCAL_DESKTOP_USER_SLUG = 'local'

async function main() {
  const vaultParent = process.env.ARCHE_E2E_DESKTOP_VAULT_PARENT
    ? path.resolve(process.env.ARCHE_E2E_DESKTOP_VAULT_PARENT)
    : await mkdtemp(path.join(tmpdir(), 'arche-e2e-desktop-'))
  const vaultName = process.env.ARCHE_E2E_DESKTOP_VAULT_NAME ?? DEFAULT_VAULT_NAME
  const vaultPath = path.join(vaultParent, vaultName)
  const kbConfigRoot = path.join(vaultPath, '.kb-config')
  const kbContentRoot = path.join(vaultPath, '.kb-content')
  const runtimeRoot = path.join(vaultPath, '.runtime', 'opencode')
  const usersRoot = path.join(vaultPath, '.users', LOCAL_DESKTOP_USER_SLUG)
  const secretsRoot = path.join(vaultPath, '.secrets')
  const workspaceRoot = path.join(vaultPath, 'workspace')
  const attachmentsRoot = path.join(workspaceRoot, '.arche', 'attachments')

  await mkdir(vaultPath, { recursive: true })
  await mkdir(runtimeRoot, { recursive: true })
  await mkdir(usersRoot, { recursive: true })
  await mkdir(secretsRoot, { recursive: true })
  await mkdir(workspaceRoot, { recursive: true })
  await mkdir(attachmentsRoot, { recursive: true })

  await writeFile(
    path.join(vaultPath, '.arche-vault.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        id: randomUUID(),
        name: vaultName,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  await ensureBareRepo(kbConfigRoot)
  await ensureBareRepo(kbContentRoot)
  await writeBareRepoFiles(
    kbConfigRoot,
    {
      'CommonWorkspaceConfig.json': `${JSON.stringify({
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
      }, null, 2)}\n`,
      'AGENTS.md': '# Arche Desktop E2E\n\nPrepared vault for desktop Playwright tests.\n',
    },
    'Bootstrap desktop E2E config',
  )
  await writeBareRepoFiles(
    kbContentRoot,
    {
      'README.md': '# Arche Desktop E2E\n\nTracked content for kickstart readiness.\n',
    },
    'Bootstrap desktop E2E content',
  )
  await writeFile(path.join(workspaceRoot, 'README.md'), '# Arche Desktop Workspace\n', 'utf8')

  process.stdout.write(`${JSON.stringify({ ok: true, vaultPath, kbConfigRoot, kbContentRoot })}\n`)
}

await main()

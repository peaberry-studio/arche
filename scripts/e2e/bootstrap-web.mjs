import { createHash, createCipheriv, randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'

import { ensureBareRepo, writeBareRepoFiles } from './lib/bare-repo.mjs'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const webDir = path.join(repoRoot, 'apps', 'web')
const requireFromWeb = createRequire(path.join(webDir, 'package.json'))
const { Pool } = requireFromWeb('pg')
const argon2 = requireFromWeb('argon2')

// Keep mutable E2E data outside apps/web so Next dev HMR does not rebuild during tests.
const e2eRoot = process.env.ARCHE_E2E_ROOT?.trim() || path.join(process.env.RUNNER_TEMP ?? tmpdir(), 'arche-web-e2e')
const kbConfigRoot = process.env.KB_CONFIG_HOST_PATH ?? path.join(e2eRoot, 'kb-config')
const kbContentRoot = process.env.KB_CONTENT_HOST_PATH ?? path.join(e2eRoot, 'kb-content')
const usersRoot = process.env.ARCHE_USERS_PATH ?? path.join(e2eRoot, 'users')
// These defaults are only for ephemeral E2E bootstrap data.
const adminEmail = (process.env.ARCHE_SEED_ADMIN_EMAIL ?? 'admin-e2e@arche.local').trim().toLowerCase()
const adminPassword = process.env.ARCHE_SEED_ADMIN_PASSWORD ?? 'arche-e2e-admin'
const adminSlug = (process.env.ARCHE_SEED_ADMIN_SLUG ?? 'admin').trim().toLowerCase()
const runtimePassword = process.env.ARCHE_E2E_RUNTIME_PASSWORD ?? 'arche-e2e-runtime'
const isSmokeFake = (process.env.ARCHE_E2E_PROFILE?.trim() || 'smoke-fake') === 'smoke-fake'
const fakeProviderUrl = process.env.ARCHE_E2E_FAKE_PROVIDER_URL
const fakeProviderApiKey = process.env.ARCHE_E2E_FAKE_PROVIDER_API_KEY ?? 'sk-e2e-fake-provider'

function getEncryptionKey() {
  const key = process.env.ARCHE_ENCRYPTION_KEY
  if (key) {
    return Buffer.from(key, 'base64')
  }

  // Keep this fallback aligned with apps/web/src/lib/spawner/config.ts for local E2E runs.
  return Buffer.from('dev-insecure-key-32-bytes-long!!')
}

function encryptPassword(plaintext) {
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
}

async function ensureSchema() {
  await execFileAsync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: webDir,
    env: process.env,
  })
}

async function upsertAdmin() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required')
  }

  const pool = new Pool({ connectionString: databaseUrl })

  try {
    const passwordHash = await argon2.hash(adminPassword)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const existingUser = await client.query(
        'SELECT id FROM users WHERE slug = $1 OR email = $2 ORDER BY CASE WHEN slug = $1 THEN 0 ELSE 1 END LIMIT 1',
        [adminSlug, adminEmail],
      )

      let userId
      if (existingUser.rows[0]?.id) {
        userId = existingUser.rows[0].id
        await client.query(
          `UPDATE users
           SET email = $2,
               slug = $1,
               role = 'ADMIN',
               password_hash = $3,
               totp_enabled = false,
               totp_secret = NULL,
               totp_verified_at = NULL,
               totp_last_used_at = NULL,
               updated_at = NOW()
           WHERE id = $4`,
          [adminSlug, adminEmail, passwordHash, userId],
        )
      } else {
        const insertedUser = await client.query(
          `INSERT INTO users (id, email, slug, role, kind, password_hash, totp_enabled, created_at, updated_at)
           VALUES ($1, $2, $3, 'ADMIN', 'HUMAN', $4, false, NOW(), NOW())
           RETURNING id`,
          [randomUUID(), adminEmail, adminSlug, passwordHash],
        )
        userId = insertedUser.rows[0].id
      }

      await client.query('COMMIT')
      return { userId }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
}

async function upsertFakeInstance(configSha) {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required')
  }

  const pool = new Pool({ connectionString: databaseUrl })

  try {
    const encryptedPassword = encryptPassword(runtimePassword)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      await client.query(
        `INSERT INTO instances (
          id,
          slug,
          status,
          created_at,
          started_at,
          stopped_at,
          last_activity_at,
          container_id,
          server_password,
          applied_config_sha,
          provider_sync_hash,
          provider_synced_at
        ) VALUES (
          $1,
          $2,
          'running',
          NOW(),
          NOW(),
          NULL,
          NOW(),
          $3,
          $4,
          $5,
          NULL,
          NULL
        )
        ON CONFLICT (slug) DO UPDATE SET
          status = 'running',
          started_at = NOW(),
          stopped_at = NULL,
          last_activity_at = NOW(),
          container_id = EXCLUDED.container_id,
          server_password = EXCLUDED.server_password,
          applied_config_sha = EXCLUDED.applied_config_sha,
          provider_sync_hash = NULL,
          provider_synced_at = NULL`,
        [randomUUID(), adminSlug, 'e2e-fake-runtime', encryptedPassword, configSha],
      )

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
}

async function seedFakeOpenAiCredential(userId) {
  if (!fakeProviderUrl) {
    return
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required')
  }

  const secretJson = JSON.stringify({ apiKey: fakeProviderApiKey })
  const encryptedSecret = encryptPassword(secretJson)

  const pool = new Pool({ connectionString: databaseUrl })

  try {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const latest = await client.query(
        'SELECT version FROM provider_credentials WHERE user_id = $1 AND provider_id = $2 ORDER BY version DESC LIMIT 1',
        [userId, 'openai'],
      )
      const nextVersion = (latest.rows[0]?.version ?? 0) + 1

      await client.query(
        "UPDATE provider_credentials SET status = 'disabled' WHERE user_id = $1 AND provider_id = $2",
        [userId, 'openai'],
      )

      await client.query(
        `INSERT INTO provider_credentials (id, user_id, provider_id, type, status, version, secret, created_at, updated_at)
         VALUES ($1, $2, $3, 'api', 'enabled', $4, $5, NOW(), NOW())`,
        [randomUUID(), userId, 'openai', nextVersion, encryptedSecret],
      )

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
}

async function stopAdminInstanceIfRunning() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required')
  }

  const pool = new Pool({ connectionString: databaseUrl })

  try {
    const client = await pool.connect()
    try {
      await client.query(
        `UPDATE instances
         SET status = 'stopped',
             container_id = NULL,
             provider_sync_hash = NULL,
             provider_synced_at = NULL,
             stopped_at = NOW()
         WHERE slug = $1`,
        [adminSlug],
      )
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
}

async function main() {
  const commonWorkspaceConfig = `${JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    default_agent: 'assistant',
    agent: {
      assistant: {
        display_name: 'Assistant',
        description: 'General-purpose assistant for E2E',
        mode: 'primary',
        model: 'openai/gpt-5.2',
        temperature: 0.2,
        prompt: 'You are a helpful assistant.',
        tools: {
          bash: true,
          edit: true,
          write: true,
        },
      },
    },
  }, null, 2)}\n`
  const agentsMd = '# Arche E2E\n\nThis workspace is prepared for Playwright E2E bootstrapping.\n'
  const contentReadme = '# Arche E2E KB\n\nThis tracked file keeps kickstart status ready for E2E.\n'
  const configSha = createHash('sha256').update(commonWorkspaceConfig).digest('hex')

  await mkdir(e2eRoot, { recursive: true })
  await mkdir(usersRoot, { recursive: true })
  await mkdir(path.join(usersRoot, adminSlug), { recursive: true })

  await ensureBareRepo(kbConfigRoot)
  await ensureBareRepo(kbContentRoot)
  await writeBareRepoFiles(
    kbConfigRoot,
    {
      'CommonWorkspaceConfig.json': commonWorkspaceConfig,
      'AGENTS.md': agentsMd,
    },
    'Bootstrap E2E config',
  )
  await writeBareRepoFiles(
    kbContentRoot,
    {
      'README.md': contentReadme,
    },
    'Bootstrap E2E content',
  )

  await ensureSchema()
  const { userId } = await upsertAdmin()
  if (isSmokeFake) {
    await upsertFakeInstance(configSha)
  } else {
    await stopAdminInstanceIfRunning()
  }
  await seedFakeOpenAiCredential(userId)

  process.stdout.write(`${JSON.stringify({
    ok: true,
    adminEmail,
    adminSlug,
    userId,
    kbConfigRoot,
    kbContentRoot,
    usersRoot,
  })}\n`)
}

await main()

import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'

import { getKbConfigRoot } from '@/lib/runtime/paths'

function importRuntimeModule<T>(specifier: string): Promise<T> {
  if (process.env.VITEST) {
    return import(specifier) as Promise<T>
  }

  return Function('runtimeSpecifier', 'return import(runtimeSpecifier)')(specifier) as Promise<T>
}

/**
 * DDL statements to initialize the SQLite database schema.
 * Generated from prisma/schema.sqlite.prisma via:
 *   npx prisma migrate diff --from-empty --to-schema prisma/schema.sqlite.prisma --script --config prisma.config.desktop.ts
 *
 * IMPORTANT: If you modify schema.sqlite.prisma, regenerate these statements.
 */
const SCHEMA_DDL = [
  `CREATE TABLE IF NOT EXISTS "_arche_schema_meta" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "password_hash" TEXT NOT NULL,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "totp_secret" TEXT,
    "totp_verified_at" DATETIME,
    "totp_last_used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "instances" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'stopped',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" DATETIME,
    "stopped_at" DATETIME,
    "last_activity_at" DATETIME,
    "container_id" TEXT,
    "server_password" TEXT NOT NULL,
    "applied_config_sha" TEXT,
    CONSTRAINT "instances_slug_fkey" FOREIGN KEY ("slug") REFERENCES "users" ("slug") ON DELETE RESTRICT ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME NOT NULL,
    "revoked_at" DATETIME,
    "last_seen_at" DATETIME,
    "ip" TEXT,
    "user_agent" TEXT,
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "audit_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "connectors" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "connectors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "provider_credentials" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'enabled',
    "version" INTEGER NOT NULL,
    "secret" TEXT NOT NULL,
    "last_error" TEXT,
    "last_used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "provider_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "two_factor_recovery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "two_factor_recovery_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "users_slug_key" ON "users"("slug")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "instances_slug_key" ON "instances"("slug")`,
  `CREATE INDEX IF NOT EXISTS "instances_status_idx" ON "instances"("status")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_hash_key" ON "sessions"("token_hash")`,
  `CREATE INDEX IF NOT EXISTS "sessions_user_id_idx" ON "sessions"("user_id")`,
  `CREATE INDEX IF NOT EXISTS "sessions_expires_at_idx" ON "sessions"("expires_at")`,
  `CREATE INDEX IF NOT EXISTS "audit_events_actor_user_id_idx" ON "audit_events"("actor_user_id")`,
  `CREATE INDEX IF NOT EXISTS "audit_events_created_at_idx" ON "audit_events"("created_at")`,
  `CREATE INDEX IF NOT EXISTS "connectors_user_id_idx" ON "connectors"("user_id")`,
  `CREATE INDEX IF NOT EXISTS "provider_credentials_user_id_idx" ON "provider_credentials"("user_id")`,
  `CREATE INDEX IF NOT EXISTS "provider_credentials_provider_id_idx" ON "provider_credentials"("provider_id")`,
  `CREATE INDEX IF NOT EXISTS "two_factor_recovery_user_id_idx" ON "two_factor_recovery"("user_id")`,
]

const SCHEMA_VERSION = '1'

function getDesktopDatabasePath(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL.replace(/^file:/, '')
  }
  const root = getKbConfigRoot()
  return join(root, '..', 'arche.db')
}

function ensureDirectoryExists(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DesktopPrismaClient = any

let clientInstance: DesktopPrismaClient | null = null
let clientPromise: Promise<DesktopPrismaClient> | null = null

export async function initDesktopDatabase(): Promise<void> {
  const client = await getDesktopPrismaClient()

  await client.$executeRawUnsafe(SCHEMA_DDL[0])

  const result = await client.$queryRaw<{ value: string }[]>`
    SELECT value FROM _arche_schema_meta WHERE key = 'schema_version'
  `

  const storedVersion = result[0]?.value

  if (storedVersion === SCHEMA_VERSION) {
    return
  }

  for (let i = 1; i < SCHEMA_DDL.length; i++) {
    await client.$executeRawUnsafe(SCHEMA_DDL[i])
  }

  await client.$executeRaw`INSERT OR REPLACE INTO _arche_schema_meta (key, value) VALUES ('schema_version', ${SCHEMA_VERSION})`
}

export async function getDesktopPrismaClient(): Promise<DesktopPrismaClient> {
  if (clientInstance) return clientInstance

  if (!clientPromise) {
    clientPromise = createClient()
  }

  return clientPromise
}

async function createClient(): Promise<DesktopPrismaClient> {
  const dbPath = getDesktopDatabasePath()
  ensureDirectoryExists(dbPath)

  const { PrismaBetterSqlite3 } = await importRuntimeModule<typeof import('@prisma/adapter-better-sqlite3')>('@prisma/adapter-better-sqlite3')
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` })

  const { PrismaClient } = await import('@/generated/prisma-desktop') as unknown as {
    PrismaClient: new (opts: { adapter: unknown }) => DesktopPrismaClient
  }

  clientInstance = new PrismaClient({ adapter })

  return clientInstance
}

import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'

import { getDesktopVaultRuntimeContext } from '@/lib/runtime/desktop/context-store'
import { DESKTOP_DATABASE_FILE_NAME } from '@/lib/runtime/desktop/vault-layout-constants'

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
    "kind" TEXT NOT NULL DEFAULT 'HUMAN',
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
    "provider_sync_hash" TEXT,
    "provider_synced_at" DATETIME,
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
  `CREATE TABLE IF NOT EXISTS "message_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "opencode_session_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "message_run_locks" (
    "slug" TEXT NOT NULL,
    "opencode_session_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    PRIMARY KEY ("slug", "opencode_session_id"),
    CONSTRAINT "message_run_locks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "message_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "external_integrations" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "config" TEXT NOT NULL,
    "state" TEXT DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "slack_thread_bindings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel_id" TEXT NOT NULL,
    "thread_ts" TEXT NOT NULL,
    "opencode_session_id" TEXT NOT NULL,
    "execution_user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "slack_thread_bindings_execution_user_id_fkey" FOREIGN KEY ("execution_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "slack_event_receipts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "received_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "slack_user_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "slack_email" TEXT,
    "display_name" TEXT,
    "last_seen_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "slack_user_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "slack_dm_session_bindings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slack_team_id" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "execution_user_id" TEXT NOT NULL,
    "opencode_session_id" TEXT NOT NULL,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "slack_dm_session_bindings_execution_user_id_fkey" FOREIGN KEY ("execution_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "slack_pending_dm_decisions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source_event_id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "source_ts" TEXT NOT NULL,
    "message_text" TEXT NOT NULL,
    "previous_dm_session_binding_id" TEXT,
    "expires_at" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "slack_notification_channels" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slack_team_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "autopilot_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cron_expression" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "target_agent_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "slack_notification_config" TEXT,
    "next_run_at" DATETIME NOT NULL,
    "last_run_at" DATETIME,
    "lease_owner" TEXT,
    "lease_expires_at" DATETIME,
    "retry_attempt" INTEGER NOT NULL DEFAULT 0,
    "retry_scheduled_for" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "autopilot_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "autopilot_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "scheduled_for" DATETIME NOT NULL,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" DATETIME,
    "error" TEXT,
    "opencode_session_id" TEXT,
    "session_title" TEXT,
    "result_seen_at" DATETIME,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "autopilot_runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "autopilot_tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
  `CREATE INDEX IF NOT EXISTS "message_runs_slug_opencode_session_id_status_idx" ON "message_runs"("slug", "opencode_session_id", "status")`,
  `CREATE INDEX IF NOT EXISTS "message_runs_started_at_idx" ON "message_runs"("started_at")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "message_run_locks_run_id_key" ON "message_run_locks"("run_id")`,
  `CREATE INDEX IF NOT EXISTS "message_run_locks_run_id_idx" ON "message_run_locks"("run_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "slack_thread_bindings_channel_id_thread_ts_key" ON "slack_thread_bindings"("channel_id", "thread_ts")`,
  `CREATE INDEX IF NOT EXISTS "slack_thread_bindings_execution_user_id_idx" ON "slack_thread_bindings"("execution_user_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "slack_event_receipts_event_id_key" ON "slack_event_receipts"("event_id")`,
  `CREATE INDEX IF NOT EXISTS "slack_event_receipts_received_at_idx" ON "slack_event_receipts"("received_at")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "slack_user_links_slack_team_id_slack_user_id_key" ON "slack_user_links"("slack_team_id", "slack_user_id")`,
  `CREATE INDEX IF NOT EXISTS "slack_user_links_user_id_idx" ON "slack_user_links"("user_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "slack_dm_session_bindings_opencode_session_id_key" ON "slack_dm_session_bindings"("opencode_session_id")`,
  `CREATE INDEX IF NOT EXISTS "slack_dm_session_bindings_slack_team_id_slack_user_id_last_message_at_idx" ON "slack_dm_session_bindings"("slack_team_id", "slack_user_id", "last_message_at")`,
  `CREATE INDEX IF NOT EXISTS "slack_dm_session_bindings_execution_user_id_idx" ON "slack_dm_session_bindings"("execution_user_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "slack_pending_dm_decisions_source_event_id_key" ON "slack_pending_dm_decisions"("source_event_id")`,
  `CREATE INDEX IF NOT EXISTS "slack_pending_dm_decisions_expires_at_idx" ON "slack_pending_dm_decisions"("expires_at")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "slack_notification_channels_slack_team_id_channel_id_key" ON "slack_notification_channels"("slack_team_id", "channel_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "autopilot_tasks_user_id_name_key" ON "autopilot_tasks"("user_id", "name")`,
  `CREATE INDEX IF NOT EXISTS "autopilot_tasks_user_id_idx" ON "autopilot_tasks"("user_id")`,
  `CREATE INDEX IF NOT EXISTS "autopilot_tasks_enabled_next_run_at_idx" ON "autopilot_tasks"("enabled", "next_run_at")`,
  `CREATE INDEX IF NOT EXISTS "autopilot_tasks_lease_expires_at_idx" ON "autopilot_tasks"("lease_expires_at")`,
  `CREATE INDEX IF NOT EXISTS "autopilot_tasks_user_id_lease_expires_at_idx" ON "autopilot_tasks"("user_id", "lease_expires_at")`,
  `CREATE INDEX IF NOT EXISTS "autopilot_tasks_retry_scheduled_for_idx" ON "autopilot_tasks"("retry_scheduled_for")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "autopilot_runs_opencode_session_id_key" ON "autopilot_runs"("opencode_session_id")`,
  `CREATE INDEX IF NOT EXISTS "autopilot_runs_task_id_started_at_idx" ON "autopilot_runs"("task_id", "started_at")`,
  `CREATE INDEX IF NOT EXISTS "autopilot_runs_status_idx" ON "autopilot_runs"("status")`,
  `CREATE INDEX IF NOT EXISTS "autopilot_runs_scheduled_for_idx" ON "autopilot_runs"("scheduled_for")`,
  `CREATE INDEX IF NOT EXISTS "connectors_user_id_idx" ON "connectors"("user_id")`,
  `CREATE INDEX IF NOT EXISTS "provider_credentials_user_id_idx" ON "provider_credentials"("user_id")`,
  `CREATE INDEX IF NOT EXISTS "provider_credentials_provider_id_idx" ON "provider_credentials"("provider_id")`,
  `CREATE INDEX IF NOT EXISTS "two_factor_recovery_user_id_idx" ON "two_factor_recovery"("user_id")`,
]

const SCHEMA_VERSION = '7'

function isCreateIndexStatement(ddl: string): boolean {
  return /^CREATE (UNIQUE )?INDEX\b/.test(ddl.trim())
}

async function getTableColumnNames(client: DesktopPrismaClient, tableName: string): Promise<Set<string>> {
  const columns = await client.$queryRawUnsafe(`PRAGMA table_info("${tableName}")`) as Array<{ name?: string }>
  return new Set(columns.flatMap((column) => column.name ? [column.name] : []))
}

async function ensureColumn(
  client: DesktopPrismaClient,
  tableName: string,
  columnName: string,
  ddl: string,
): Promise<void> {
  const columns = await getTableColumnNames(client, tableName)
  if (!columns.has(columnName)) {
    await client.$executeRawUnsafe(ddl)
  }
}

async function ensureDesktopSchemaColumns(client: DesktopPrismaClient): Promise<void> {
  await ensureColumn(client, 'users', 'kind', 'ALTER TABLE "users" ADD COLUMN "kind" TEXT NOT NULL DEFAULT \'HUMAN\'')
  await ensureColumn(client, 'instances', 'provider_sync_hash', 'ALTER TABLE "instances" ADD COLUMN "provider_sync_hash" TEXT')
  await ensureColumn(client, 'instances', 'provider_synced_at', 'ALTER TABLE "instances" ADD COLUMN "provider_synced_at" DATETIME')
  await ensureColumn(client, 'autopilot_tasks', 'slack_notification_config', 'ALTER TABLE "autopilot_tasks" ADD COLUMN "slack_notification_config" TEXT')
  await ensureColumn(client, 'autopilot_tasks', 'retry_attempt', 'ALTER TABLE "autopilot_tasks" ADD COLUMN "retry_attempt" INTEGER NOT NULL DEFAULT 0')
  await ensureColumn(client, 'autopilot_tasks', 'retry_scheduled_for', 'ALTER TABLE "autopilot_tasks" ADD COLUMN "retry_scheduled_for" DATETIME')
  await ensureColumn(client, 'autopilot_runs', 'result_seen_at', 'ALTER TABLE "autopilot_runs" ADD COLUMN "result_seen_at" DATETIME')
  await ensureColumn(client, 'autopilot_runs', 'attempt', 'ALTER TABLE "autopilot_runs" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1')
}

function getDesktopDatabasePath(): string {
  const contextDatabaseUrl = getDesktopVaultRuntimeContext()?.databaseUrl?.trim()
  if (contextDatabaseUrl) {
    return contextDatabaseUrl.replace(/^file:/, '')
  }

  const vaultRoot = process.env.ARCHE_DATA_DIR?.trim()
  if (vaultRoot) {
    return join(vaultRoot, DESKTOP_DATABASE_FILE_NAME)
  }

  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL.replace(/^file:/, '')
  }

  throw new Error('Desktop database access requires ARCHE_DATA_DIR to point at the active vault')
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

  for (let i = 1; i < SCHEMA_DDL.length; i++) {
    const ddl = SCHEMA_DDL[i]
    if (!isCreateIndexStatement(ddl)) {
      await client.$executeRawUnsafe(ddl)
    }
  }

  await ensureDesktopSchemaColumns(client)

  for (let i = 1; i < SCHEMA_DDL.length; i++) {
    const ddl = SCHEMA_DDL[i]
    if (isCreateIndexStatement(ddl)) {
      await client.$executeRawUnsafe(ddl)
    }
  }

  if (storedVersion !== SCHEMA_VERSION) {
    await client.$executeRaw`INSERT OR REPLACE INTO _arche_schema_meta (key, value) VALUES ('schema_version', ${SCHEMA_VERSION})`
  }
}

export async function getDesktopPrismaClient(): Promise<DesktopPrismaClient> {
  const context = getDesktopVaultRuntimeContext()
  if (context?.prismaClient) {
    return context.prismaClient as DesktopPrismaClient
  }

  if (context?.prismaClientPromise) {
    return context.prismaClientPromise as Promise<DesktopPrismaClient>
  }

  if (context) {
    context.prismaClientPromise = createClient() as Promise<DesktopPrismaClient>

    return context.prismaClientPromise as Promise<DesktopPrismaClient>
  }

  if (clientInstance) return clientInstance

  if (!clientPromise) {
    clientPromise = createClient().then((client) => {
      clientInstance = client
      return client
    })
  }

  return clientPromise
}

async function createClient(): Promise<DesktopPrismaClient> {
  const dbPath = getDesktopDatabasePath()
  ensureDirectoryExists(dbPath)

  const { PrismaBetterSqlite3 } = await import('@prisma/adapter-better-sqlite3')
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` })

  const { PrismaClient } = await import('@/generated/prisma-desktop') as unknown as {
    PrismaClient: new (opts: { adapter: unknown }) => DesktopPrismaClient
  }

  return new PrismaClient({ adapter })
}

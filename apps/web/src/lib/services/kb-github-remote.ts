import { decryptConfig, encryptConfig } from '@/lib/connectors/crypto'
import { getInstallationToken } from '@/lib/git/github-app-auth'
import type {
  KbGithubRemoteIntegrationSummary,
  KbGithubRemoteSyncStatus,
  KbGithubRemoteWorkspaceConfig,
} from '@/lib/kb-github-remote/types'
import { findByKey, updateStateByKey, upsertByKey } from '@/lib/services/external-integrations'

export const KB_GITHUB_REMOTE_INTEGRATION_KEY = 'kb_github_remote'

type KbGithubRemoteConfig = {
  appId?: string
  appSlug?: string
  privateKey?: string
}

export type KbGithubRemoteState = {
  installationAccount: string | null
  installationId: number | null
  lastError: string | null
  lastSyncAt: string | null
  lastSyncStatus: KbGithubRemoteSyncStatus
  repoCloneUrl: string | null
  repoDefaultBranch: string | null
  repoFullName: string | null
}

export type KbGithubRemoteIntegrationRecord = {
  config: string
  configCorrupted: boolean
  createdAt: Date
  key: string
  state: KbGithubRemoteState
  updatedAt: Date
  version: number
}

const DEFAULT_STATE: KbGithubRemoteState = {
  installationAccount: null,
  installationId: null,
  lastError: null,
  lastSyncAt: null,
  lastSyncStatus: null,
  repoCloneUrl: null,
  repoDefaultBranch: null,
  repoFullName: null,
}

export async function findIntegration(): Promise<KbGithubRemoteIntegrationRecord | null> {
  const row = await findByKey(KB_GITHUB_REMOTE_INTEGRATION_KEY)
  if (!row) return null
  const config = safeDecryptConfig(row.config)

  return {
    config: row.config,
    configCorrupted: !config.ok,
    createdAt: row.createdAt,
    key: row.key,
    state: parseState(row.state),
    updatedAt: row.updatedAt,
    version: row.version,
  }
}

export function decryptIntegrationConfig(record: KbGithubRemoteIntegrationRecord | null): KbGithubRemoteConfig | null {
  if (!record) return null
  const result = safeDecryptConfig(record.config)
  return result.ok ? result.config : null
}

export async function saveAppConfig(args: {
  appId: string
  appSlug: string
  privateKey: string
}): Promise<KbGithubRemoteIntegrationRecord> {
  const row = await upsertByKey(
    KB_GITHUB_REMOTE_INTEGRATION_KEY,
    encryptConfig({
      appId: args.appId.trim(),
      appSlug: args.appSlug.trim(),
      privateKey: args.privateKey.trim(),
    }),
    DEFAULT_STATE,
  )

  return toRecord(row)
}

export async function saveInstallation(args: {
  account: string
  installationId: number
}): Promise<void> {
  const current = await getSyncState()
  const installationChanged = current.installationId !== null && current.installationId !== args.installationId

  await updateState({
    installationAccount: args.account,
    installationId: args.installationId,
    ...(installationChanged
      ? {
          lastError: null,
          lastSyncAt: null,
          lastSyncStatus: null,
          repoCloneUrl: null,
          repoDefaultBranch: null,
          repoFullName: null,
        }
      : {}),
  })
}

export async function saveSelectedRepo(args: {
  cloneUrl: string
  defaultBranch: string
  fullName: string
}): Promise<void> {
  await updateState({
    lastError: null,
    lastSyncStatus: null,
    repoCloneUrl: args.cloneUrl,
    repoDefaultBranch: args.defaultBranch,
    repoFullName: args.fullName,
  })
}

export async function clearIntegration(): Promise<KbGithubRemoteIntegrationRecord> {
  const row = await upsertByKey(
    KB_GITHUB_REMOTE_INTEGRATION_KEY,
    encryptConfig({}),
    DEFAULT_STATE,
  )

  return toRecord(row)
}

export async function updateSyncState(args: {
  lastError?: string | null
  lastSyncAt?: string | null
  lastSyncStatus?: KbGithubRemoteSyncStatus
}): Promise<void> {
  await updateState(args)
}

export async function getSyncState(): Promise<KbGithubRemoteState> {
  const record = await findIntegration()
  return record?.state ?? { ...DEFAULT_STATE }
}

export function toSummary(
  record: KbGithubRemoteIntegrationRecord | null,
  config: KbGithubRemoteConfig | null,
): KbGithubRemoteIntegrationSummary {
  const state = record?.state ?? DEFAULT_STATE
  const appConfigured = Boolean(config?.appId && config.privateKey)

  return {
    appConfigured,
    appId: config?.appId ?? null,
    appSlug: config?.appSlug ?? null,
    hasPrivateKey: Boolean(config?.privateKey),
    installationAccount: state.installationAccount,
    installationId: state.installationId,
    lastError: state.lastError,
    lastSyncAt: state.lastSyncAt,
    lastSyncStatus: state.lastSyncStatus,
    ready: Boolean(appConfigured && state.installationId && state.repoCloneUrl),
    repoDefaultBranch: state.repoDefaultBranch,
    repoFullName: state.repoFullName,
    updatedAt: record?.updatedAt.toISOString() ?? null,
    version: record?.version ?? 0,
  }
}

export async function createWorkspaceRemoteConfig(): Promise<
  | { ok: true; remote: KbGithubRemoteWorkspaceConfig | null }
  | { ok: false; error: string }
> {
  const record = await findIntegration()
  if (!record) return { ok: true, remote: null }

  const config = decryptIntegrationConfig(record)
  if (!config?.appId || !config.privateKey || !record.state.installationId || !record.state.repoCloneUrl) {
    return { ok: true, remote: null }
  }

  const tokenResult = await getInstallationToken(config.appId, config.privateKey, record.state.installationId)
  if (!tokenResult.ok) {
    await updateSyncState({
      lastError: tokenResult.message,
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: 'error',
    }).catch(() => undefined)
    return { ok: false, error: tokenResult.message }
  }

  return {
    ok: true,
    remote: {
      branch: record.state.repoDefaultBranch || 'main',
      repoCloneUrl: record.state.repoCloneUrl,
      token: tokenResult.token,
    },
  }
}

function parseState(raw: unknown): KbGithubRemoteState {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_STATE }
  }

  const state = raw as Record<string, unknown>
  const lastSyncStatus = state.lastSyncStatus

  return {
    installationAccount: typeof state.installationAccount === 'string' ? state.installationAccount : null,
    installationId: typeof state.installationId === 'number' ? state.installationId : null,
    lastError: typeof state.lastError === 'string' ? state.lastError : null,
    lastSyncAt: typeof state.lastSyncAt === 'string' ? state.lastSyncAt : null,
    lastSyncStatus: lastSyncStatus === 'success' || lastSyncStatus === 'error' || lastSyncStatus === 'conflicts'
      ? lastSyncStatus
      : null,
    repoCloneUrl: typeof state.repoCloneUrl === 'string' ? state.repoCloneUrl : null,
    repoDefaultBranch: typeof state.repoDefaultBranch === 'string' ? state.repoDefaultBranch : null,
    repoFullName: typeof state.repoFullName === 'string' ? state.repoFullName : null,
  }
}

function safeDecryptConfig(encryptedConfig: string): { ok: true; config: KbGithubRemoteConfig } | { ok: false } {
  try {
    return { ok: true, config: decryptConfig(encryptedConfig) as KbGithubRemoteConfig }
  } catch (error) {
    console.error('[kb-github-remote] Failed to decrypt integration config', error instanceof Error ? error.message : error)
    return { ok: false }
  }
}

function toRecord(row: {
  config: string
  createdAt: Date
  key: string
  state: unknown
  updatedAt: Date
  version: number
}): KbGithubRemoteIntegrationRecord {
  const config = safeDecryptConfig(row.config)
  return {
    config: row.config,
    configCorrupted: !config.ok,
    createdAt: row.createdAt,
    key: row.key,
    state: parseState(row.state),
    updatedAt: row.updatedAt,
    version: row.version,
  }
}

async function updateState(partial: Partial<KbGithubRemoteState>): Promise<void> {
  const current = await getSyncState()
  await updateStateByKey(KB_GITHUB_REMOTE_INTEGRATION_KEY, { ...current, ...partial })
}

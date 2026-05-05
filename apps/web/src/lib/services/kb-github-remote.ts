import { encryptConfig, decryptConfig } from '@/lib/connectors/crypto'
import { pushToGithub, pullFromGithub, type KbGithubSyncCredentials, type ConflictStrategy } from '@/lib/git/kb-github-sync'
import type { KbGithubRemoteIntegrationSummary } from '@/lib/kb-github-remote/types'

import { findByKey, upsertByKey, updateStateByKey } from './external-integrations'

export const KB_GITHUB_REMOTE_INTEGRATION_KEY = 'kb_github_remote'

export type KbGithubRemoteConfig = {
  appId?: string
  privateKey?: string
  appSlug?: string
}

export type KbGithubRemoteSyncState = {
  installationId: number | null
  repoFullName: string | null
  repoCloneUrl: string | null
  lastSyncAt: string | null
  lastSyncStatus: 'success' | 'error' | 'conflicts' | null
  lastError: string | null
  remoteBranch: string | null
  lastPushAt: string | null
  lastPullAt: string | null
}

export type KbGithubRemoteIntegrationRecord = {
  singletonKey: string
  config: string
  state: KbGithubRemoteSyncState
  version: number
  createdAt: Date
  updatedAt: Date
}

const DEFAULT_STATE: KbGithubRemoteSyncState = {
  installationId: null,
  repoFullName: null,
  repoCloneUrl: null,
  lastSyncAt: null,
  lastSyncStatus: null,
  lastError: null,
  remoteBranch: null,
  lastPushAt: null,
  lastPullAt: null,
}

function parseState(raw: unknown): KbGithubRemoteSyncState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STATE }
  const s = raw as Record<string, unknown>
  return {
    installationId: typeof s.installationId === 'number' ? s.installationId : null,
    repoFullName: typeof s.repoFullName === 'string' ? s.repoFullName : null,
    repoCloneUrl: typeof s.repoCloneUrl === 'string' ? s.repoCloneUrl : null,
    lastSyncAt: typeof s.lastSyncAt === 'string' ? s.lastSyncAt : null,
    lastSyncStatus:
      s.lastSyncStatus === 'success' || s.lastSyncStatus === 'error' || s.lastSyncStatus === 'conflicts'
        ? s.lastSyncStatus
        : null,
    lastError: typeof s.lastError === 'string' ? s.lastError : null,
    remoteBranch: typeof s.remoteBranch === 'string' ? s.remoteBranch : null,
    lastPushAt: typeof s.lastPushAt === 'string' ? s.lastPushAt : null,
    lastPullAt: typeof s.lastPullAt === 'string' ? s.lastPullAt : null,
  }
}

export async function findIntegration(): Promise<KbGithubRemoteIntegrationRecord | null> {
  const row = await findByKey(KB_GITHUB_REMOTE_INTEGRATION_KEY)
  if (!row) return null
  return {
    singletonKey: row.key,
    config: row.config,
    state: parseState(row.state),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function decryptIntegrationConfig(
  record: KbGithubRemoteIntegrationRecord | null,
): KbGithubRemoteConfig | null {
  if (!record) return null
  try {
    return decryptConfig(record.config) as KbGithubRemoteConfig
  } catch (error) {
    console.error('[kb-github-remote] Failed to decrypt integration config:', error)
    return null
  }
}

export async function saveIntegrationConfig(args: {
  appId: string
  privateKey?: string | null
  appSlug?: string | null
}): Promise<KbGithubRemoteIntegrationRecord> {
  const existing = await findIntegration()
  const existingConfig = existing ? decryptIntegrationConfig(existing) : null

  const nextConfig: KbGithubRemoteConfig = {
    appId: args.appId.trim(),
  }

  if (args.privateKey !== undefined && args.privateKey !== null && args.privateKey.trim()) {
    nextConfig.privateKey = args.privateKey.trim()
  } else if (existingConfig?.privateKey) {
    nextConfig.privateKey = existingConfig.privateKey
  }

  if (args.appSlug !== undefined && args.appSlug !== null && args.appSlug.trim()) {
    nextConfig.appSlug = args.appSlug.trim()
  } else if (existingConfig?.appSlug) {
    nextConfig.appSlug = existingConfig.appSlug
  }

  const state = existing ? existing.state : DEFAULT_STATE
  const row = await upsertByKey(KB_GITHUB_REMOTE_INTEGRATION_KEY, encryptConfig(nextConfig), state)
  return {
    singletonKey: row.key,
    config: row.config,
    state: parseState(row.state),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function clearIntegration(): Promise<KbGithubRemoteIntegrationRecord> {
  const row = await upsertByKey(KB_GITHUB_REMOTE_INTEGRATION_KEY, encryptConfig({}), DEFAULT_STATE)
  return {
    singletonKey: row.key,
    config: row.config,
    state: parseState(row.state),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function isConfigured(): Promise<boolean> {
  const record = await findIntegration()
  if (!record) return false
  const config = decryptIntegrationConfig(record)
  return Boolean(config?.appId && config.privateKey)
}

export function isFullyReady(
  config: KbGithubRemoteConfig | null,
  state: KbGithubRemoteSyncState,
): boolean {
  return Boolean(config?.appId && config.privateKey && state.installationId && state.repoCloneUrl)
}

export async function updateSyncState(
  partial: Partial<KbGithubRemoteSyncState>,
): Promise<void> {
  const record = await findIntegration()
  const current = record ? record.state : DEFAULT_STATE
  const next = { ...current, ...partial }
  await updateStateByKey(KB_GITHUB_REMOTE_INTEGRATION_KEY, next)
}

export async function getSyncState(): Promise<KbGithubRemoteSyncState> {
  const record = await findIntegration()
  return record ? record.state : { ...DEFAULT_STATE }
}

export async function getSyncCredentials(): Promise<KbGithubSyncCredentials | null> {
  const record = await findIntegration()
  if (!record) return null
  const config = decryptIntegrationConfig(record)
  if (!config?.appId || !config.privateKey) return null
  if (!record.state.installationId || !record.state.repoCloneUrl) return null
  return {
    appId: config.appId,
    privateKey: config.privateKey,
    installationId: record.state.installationId,
    repoCloneUrl: record.state.repoCloneUrl,
  }
}

export function toSummary(
  record: KbGithubRemoteIntegrationRecord | null,
  config: KbGithubRemoteConfig | null,
): KbGithubRemoteIntegrationSummary {
  const state = record?.state
  return {
    appId: config?.appId ?? null,
    appSlug: config?.appSlug ?? null,
    appConfigured: Boolean(config?.appId && config?.privateKey),
    hasPrivateKey: Boolean(config?.privateKey),
    installationId: state?.installationId ?? null,
    repoFullName: state?.repoFullName ?? null,
    ready: record ? isFullyReady(config ?? null, record.state) : false,
    lastSyncAt: state?.lastSyncAt ?? null,
    lastSyncStatus: state?.lastSyncStatus ?? null,
    lastError: state?.lastError ?? null,
    remoteBranch: state?.remoteBranch ?? null,
    version: record?.version ?? 0,
    updatedAt: record?.updatedAt?.toISOString() ?? null,
  }
}

export type PullBestEffortResult = {
  status: 'pulled' | 'resolved' | 'up_to_date' | 'conflicts' | 'error' | 'skipped'
}

export async function pullBestEffort(strategy?: ConflictStrategy): Promise<PullBestEffortResult> {
  try {
    const creds = await getSyncCredentials()
    if (!creds) return { status: 'skipped' }

    const result = await pullFromGithub(creds, strategy)

    const now = new Date().toISOString()
    await updateSyncState({
      lastSyncAt: now,
      lastPullAt: now,
      lastSyncStatus: result.ok ? 'success' : (
        !result.ok && result.status === 'conflicts' ? 'conflicts' : 'error'
      ),
      lastError: result.ok ? null : result.message,
      remoteBranch: result.ok && 'branch' in result ? result.branch : undefined,
    })

    return { status: result.ok ? result.status : result.status === 'conflicts' ? 'conflicts' : 'error' }
  } catch {
    return { status: 'error' }
  }
}

export async function pushBestEffort(): Promise<void> {
  try {
    const creds = await getSyncCredentials()
    if (!creds) return

    const result = await pushToGithub(creds)

    const now = new Date().toISOString()
    await updateSyncState({
      lastSyncAt: now,
      lastPushAt: now,
      lastSyncStatus: result.ok ? 'success' : 'error',
      lastError: result.ok ? null : result.message,
      remoteBranch: result.ok && 'branch' in result ? result.branch : undefined,
    })
  } catch {
    // Best-effort: don't block if GitHub is unreachable
  }
}

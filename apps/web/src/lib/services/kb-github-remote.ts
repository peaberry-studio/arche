import { encryptConfig, decryptConfig } from '@/lib/connectors/crypto'

import { findByKey, upsertByKey, updateStateByKey } from './external-integrations'

export const KB_GITHUB_REMOTE_INTEGRATION_KEY = 'kb_github_remote'

export type KbGithubRemoteConfig = {
  repoUrl?: string
  pat?: string
}

export type KbGithubRemoteSyncState = {
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
  configCorrupted?: boolean
}

const DEFAULT_STATE: KbGithubRemoteSyncState = {
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
  repoUrl: string
  pat?: string | null
}): Promise<KbGithubRemoteIntegrationRecord> {
  const existing = await findIntegration()
  const existingConfig = existing ? decryptIntegrationConfig(existing) : null

  const nextConfig: KbGithubRemoteConfig = {
    repoUrl: args.repoUrl.trim(),
  }

  if (args.pat !== undefined && args.pat !== null && args.pat.trim()) {
    nextConfig.pat = args.pat.trim()
  } else if (existingConfig?.pat) {
    nextConfig.pat = existingConfig.pat
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
  return Boolean(config?.repoUrl && config.pat)
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

import { encryptConfig, decryptConfig } from '@/lib/connectors/crypto'
import { getGoogleOAuthClientCredentials } from '@/lib/connectors/google-workspace'

import { findByKey, upsertByKey } from './external-integrations'

export const GOOGLE_WORKSPACE_INTEGRATION_KEY = 'google_workspace'

export type GoogleWorkspaceIntegrationRecord = {
  singletonKey: string
  config: string
  version: number
  createdAt: Date
  updatedAt: Date
}

export type GoogleWorkspaceIntegrationConfig = {
  clientId?: string
  clientSecret?: string
}

export async function findIntegration(): Promise<GoogleWorkspaceIntegrationRecord | null> {
  const row = await findByKey(GOOGLE_WORKSPACE_INTEGRATION_KEY)
  if (!row) return null
  return {
    singletonKey: row.key,
    config: row.config,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function decryptIntegrationConfig(
  record: GoogleWorkspaceIntegrationRecord | null,
): GoogleWorkspaceIntegrationConfig | null {
  if (!record) return null
  try {
    return decryptConfig(record.config) as GoogleWorkspaceIntegrationConfig
  } catch (error) {
    console.error('[google-workspace] Failed to decrypt integration config:', error)
    return null
  }
}

export async function ensureIntegrationSeededFromEnv(): Promise<GoogleWorkspaceIntegrationRecord | null> {
  const record = await findIntegration()
  if (record) {
    return record
  }

  const env = getGoogleOAuthClientCredentials(null)
  if (!env) {
    return null
  }

  const row = await upsertByKey(GOOGLE_WORKSPACE_INTEGRATION_KEY, encryptConfig(env))
  return {
    singletonKey: row.key,
    config: row.config,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function getResolvedCredentials(): Promise<
  { clientId: string; clientSecret: string } | null
> {
  const record = await ensureIntegrationSeededFromEnv()
  if (!record) {
    return null
  }

  const config = decryptIntegrationConfig(record)
  if (config?.clientId && config.clientSecret) {
    return {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    }
  }

  // Row exists but explicitly cleared or incomplete: do NOT fall back to env
  return null
}

export async function saveIntegrationConfig(args: {
  clientId: string
  clientSecret?: string | null
}): Promise<GoogleWorkspaceIntegrationRecord> {
  const existing = await findIntegration()
  const existingConfig = existing ? decryptIntegrationConfig(existing) : null

  const nextConfig: GoogleWorkspaceIntegrationConfig = {
    clientId: args.clientId.trim(),
  }

  if (args.clientSecret !== undefined && args.clientSecret !== null && args.clientSecret.trim()) {
    nextConfig.clientSecret = args.clientSecret.trim()
  } else if (existingConfig?.clientSecret) {
    nextConfig.clientSecret = existingConfig.clientSecret
  }

  const row = await upsertByKey(GOOGLE_WORKSPACE_INTEGRATION_KEY, encryptConfig(nextConfig))
  return {
    singletonKey: row.key,
    config: row.config,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function clearIntegration(): Promise<GoogleWorkspaceIntegrationRecord> {
  const row = await upsertByKey(GOOGLE_WORKSPACE_INTEGRATION_KEY, encryptConfig({}))
  return {
    singletonKey: row.key,
    config: row.config,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function isConfigured(): Promise<boolean> {
  const record = await findIntegration()
  if (!record) return false
  const config = decryptIntegrationConfig(record)
  return Boolean(config?.clientId && config.clientSecret)
}

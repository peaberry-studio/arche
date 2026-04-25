import { encryptConfig, decryptConfig } from '@/lib/connectors/crypto'
import { getGoogleOAuthClientCredentials } from '@/lib/connectors/google-workspace'
import { prisma } from '@/lib/prisma'

export const GOOGLE_WORKSPACE_INTEGRATION_SINGLETON_KEY = 'default'

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

export function findIntegration(): Promise<GoogleWorkspaceIntegrationRecord | null> {
  return prisma.googleWorkspaceIntegration.findUnique({
    where: { singletonKey: GOOGLE_WORKSPACE_INTEGRATION_SINGLETON_KEY },
  })
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

  return prisma.googleWorkspaceIntegration.upsert({
    where: { singletonKey: GOOGLE_WORKSPACE_INTEGRATION_SINGLETON_KEY },
    create: {
      singletonKey: GOOGLE_WORKSPACE_INTEGRATION_SINGLETON_KEY,
      config: encryptConfig(env),
    },
    update: {
      config: encryptConfig(env),
    },
  })
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

  return prisma.googleWorkspaceIntegration.upsert({
    where: { singletonKey: GOOGLE_WORKSPACE_INTEGRATION_SINGLETON_KEY },
    create: {
      singletonKey: GOOGLE_WORKSPACE_INTEGRATION_SINGLETON_KEY,
      config: encryptConfig(nextConfig),
    },
    update: {
      config: encryptConfig(nextConfig),
      version: { increment: 1 },
    },
  })
}

export async function clearIntegration(): Promise<GoogleWorkspaceIntegrationRecord> {
  return prisma.googleWorkspaceIntegration.upsert({
    where: { singletonKey: GOOGLE_WORKSPACE_INTEGRATION_SINGLETON_KEY },
    create: {
      singletonKey: GOOGLE_WORKSPACE_INTEGRATION_SINGLETON_KEY,
      config: encryptConfig({}),
    },
    update: {
      config: encryptConfig({}),
      version: { increment: 1 },
    },
  })
}

export async function isConfigured(): Promise<boolean> {
  const record = await findIntegration()
  if (!record) return false
  const config = decryptIntegrationConfig(record)
  return Boolean(config?.clientId && config.clientSecret)
}

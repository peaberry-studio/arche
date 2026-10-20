import { getE2eRuntimeConnection, isE2eFakeRuntimeEnabled } from '@/lib/e2e/runtime'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { instanceService } from '@/lib/services'
import { decryptPassword } from '@/lib/spawner/crypto'

const DEFAULT_OPENCODE_PORT = 4096
const DEFAULT_USERNAME = 'opencode'
const DESKTOP_LOOPBACK_HOST = '127.0.0.1'
const DESKTOP_OPENCODE_PORT_ENV = 'ARCHE_DESKTOP_OPENCODE_PORT'

type InstanceCredentials = {
  password: string
  username: string
}

type OpencodeConnection = {
  authHeader: string
  baseUrl: string
  password: string
  username: string
}

type OpencodeConnectionResolver = {
  resolveBaseUrl: (slug: string, overrideBaseUrl?: string) => string | null
  resolveCredentials: (slug: string) => Promise<InstanceCredentials | null>
}

function getDesktopOpencodePort(): number {
  const raw = process.env[DESKTOP_OPENCODE_PORT_ENV]
  const parsed = raw ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OPENCODE_PORT
}

function resolveRealBaseUrl(slug: string, overrideBaseUrl?: string): string {
  if (overrideBaseUrl) {
    return overrideBaseUrl
  }

  const caps = getRuntimeCapabilities()
  const host = caps.containers ? `opencode-${slug}` : DESKTOP_LOOPBACK_HOST
  const port = caps.containers ? DEFAULT_OPENCODE_PORT : getDesktopOpencodePort()
  return `http://${host}:${port}`
}

function resolveE2eBaseUrl(_slug: string, overrideBaseUrl?: string): string | null {
  return getE2eRuntimeConnection(overrideBaseUrl)?.baseUrl ?? null
}

async function findRunningInstance(slug: string) {
  const instance = await instanceService.findCredentialsBySlug(slug)

  if (!instance || !instance.serverPassword || instance.status !== 'running') {
    return null
  }

  return instance
}

async function resolveRealCredentials(slug: string): Promise<InstanceCredentials | null> {
  const instance = await findRunningInstance(slug)
  if (!instance) {
    return null
  }

  try {
    return {
      username: DEFAULT_USERNAME,
      password: decryptPassword(instance.serverPassword),
    }
  } catch {
    console.error(`[opencode/client] Failed to decrypt password for ${slug}`)
    return null
  }
}

async function resolveE2eCredentials(slug: string): Promise<InstanceCredentials | null> {
  const instance = await findRunningInstance(slug)
  if (!instance) {
    return null
  }

  const connection = getE2eRuntimeConnection()
  if (!connection) {
    return null
  }

  return {
    username: DEFAULT_USERNAME,
    password: connection.password,
  }
}

function makeAuthHeader(credentials: InstanceCredentials): string {
  return `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`
}

const realConnectionResolver: OpencodeConnectionResolver = {
  resolveBaseUrl: resolveRealBaseUrl,
  resolveCredentials: resolveRealCredentials,
}

const e2eConnectionResolver: OpencodeConnectionResolver = {
  resolveBaseUrl: resolveE2eBaseUrl,
  resolveCredentials: resolveE2eCredentials,
}

export function getOpencodeConnectionResolver(): OpencodeConnectionResolver {
  return isE2eFakeRuntimeEnabled() ? e2eConnectionResolver : realConnectionResolver
}

export function getInstanceUrl(slug: string, overrideBaseUrl?: string): string {
  const baseUrl = getOpencodeConnectionResolver().resolveBaseUrl(slug, overrideBaseUrl)
  return baseUrl ?? resolveRealBaseUrl(slug, overrideBaseUrl)
}

export async function resolveInstanceConnection(
  slug: string,
  overrideBaseUrl?: string,
): Promise<OpencodeConnection | null> {
  const resolver = getOpencodeConnectionResolver()
  const credentials = await resolver.resolveCredentials(slug)
  if (!credentials) {
    return null
  }

  const baseUrl = resolver.resolveBaseUrl(slug, overrideBaseUrl)
  if (!baseUrl) {
    return null
  }

  return {
    ...credentials,
    baseUrl,
    authHeader: makeAuthHeader(credentials),
  }
}

export async function getInstanceBasicAuth(
  slug: string,
): Promise<{ baseUrl: string; authHeader: string } | null> {
  const connection = await resolveInstanceConnection(slug)
  if (!connection) {
    return null
  }

  return {
    baseUrl: connection.baseUrl,
    authHeader: connection.authHeader,
  }
}

export type { OpencodeConnection, OpencodeConnectionResolver }

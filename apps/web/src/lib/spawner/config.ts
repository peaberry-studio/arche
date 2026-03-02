export function getEncryptionKey(): Buffer {
  const key = process.env.ARCHE_ENCRYPTION_KEY
  if (key) return Buffer.from(key, 'base64')
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ARCHE_ENCRYPTION_KEY is required in production')
  }
  return Buffer.from('dev-insecure-key-32-bytes-long!!')
}

export function getContainerSocketPath(): string | undefined {
  return process.env.CONTAINER_SOCKET_PATH || undefined
}

export function getSpawnerBackend(): 'container' | 'local' {
  const raw = process.env.ARCHE_SPAWNER_BACKEND?.trim().toLowerCase()
  if (raw === 'local') return 'local'
  return 'container'
}

export function getContainerProxyUrl(): string {
  const host = process.env.CONTAINER_PROXY_HOST || 'docker-socket-proxy'
  const port = process.env.CONTAINER_PROXY_PORT || '2375'
  return `http://${host}:${port}`
}

export function getOpencodeImage(): string {
  return process.env.OPENCODE_IMAGE || 'ghcr.io/peaberry-studio/arche/workspace:latest'
}

export function getOpencodeNetwork(): string {
  return process.env.OPENCODE_NETWORK || 'arche-internal'
}

export function getWorkspaceAgentPort(): number {
  const raw = process.env.WORKSPACE_AGENT_PORT
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4097
}

export function getLocalInstanceHost(): string {
  const value = process.env.ARCHE_LOCAL_INSTANCE_HOST?.trim()
  return value || '127.0.0.1'
}

function getLocalOpencodePortBase(): number {
  const raw = process.env.ARCHE_LOCAL_OPENCODE_PORT_BASE
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 42000
}

function hashSlug(slug: string): number {
  let hash = 0
  for (let index = 0; index < slug.length; index += 1) {
    hash = (hash * 31 + slug.charCodeAt(index)) >>> 0
  }

  return hash
}

export function getOpencodePortForSlug(slug: string): number {
  if (getSpawnerBackend() !== 'local') return 4096
  const base = getLocalOpencodePortBase()
  const offset = (hashSlug(slug) % 1000) * 2
  return base + offset
}

export function getWorkspaceAgentPortForSlug(slug: string): number {
  if (getSpawnerBackend() !== 'local') return getWorkspaceAgentPort()
  return getOpencodePortForSlug(slug) + 1
}

export function getOpencodeBinPath(): string {
  const value = process.env.ARCHE_OPENCODE_BIN?.trim()
  return value || 'opencode'
}

export function getWorkspaceAgentBinPath(): string {
  const value = process.env.ARCHE_WORKSPACE_AGENT_BIN?.trim()
  return value || 'workspace-agent'
}

export function getStartExpectedMs(): number {
  const raw = process.env.ARCHE_START_EXPECTED_MS
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15_000
}

export function getStartTimeoutMs(): number {
  const raw = process.env.ARCHE_START_TIMEOUT_MS
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000
}

export function getIdleTimeoutMinutes(): number {
  const raw = process.env.ARCHE_IDLE_TIMEOUT_MINUTES
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 30
}

export function getKbContentHostPath(): string {
  const value = process.env.KB_CONTENT_HOST_PATH?.trim()
  if (!value) {
    throw new Error('KB_CONTENT_HOST_PATH is required')
  }
  return value
}

export function getUsersBasePath(): string {
  return process.env.ARCHE_USERS_PATH || '/opt/arche/users'
}

export function getEncryptionKey(): Buffer {
  const key = process.env.ARCHE_ENCRYPTION_KEY
  if (key) return Buffer.from(key, 'base64')
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ARCHE_ENCRYPTION_KEY is required in production')
  }
  console.warn('[security] Using insecure development secret for encryption key. Set ARCHE_ENCRYPTION_KEY env var.')
  return Buffer.from('dev-insecure-key-32-bytes-long!!')
}

export function getContainerSocketPath(): string | undefined {
  return process.env.CONTAINER_SOCKET_PATH || undefined
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



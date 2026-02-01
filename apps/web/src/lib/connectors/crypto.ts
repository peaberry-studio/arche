import { encryptPassword, decryptPassword } from '@/lib/spawner/crypto'

const MAX_CONFIG_SIZE = 10 * 1024 // 10 KB

export function encryptConfig(config: Record<string, unknown>): string {
  const json = JSON.stringify(config)
  if (json.length > MAX_CONFIG_SIZE) {
    throw new Error('Connector configuration exceeds maximum size')
  }
  return encryptPassword(json)
}

export function decryptConfig(encrypted: string): Record<string, unknown> {
  try {
    return JSON.parse(decryptPassword(encrypted))
  } catch {
    throw new Error('Failed to decrypt connector configuration')
  }
}

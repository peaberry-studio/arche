import { randomBytes } from 'crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import { getDesktopSecretsDir } from './vault-layout'

const ENCRYPTION_KEY_ENV_NAME = 'ARCHE_ENCRYPTION_KEY'
const ENCRYPTION_KEY_MANAGED_ENV_NAME = 'ARCHE_DESKTOP_MANAGED_ENCRYPTION_KEY'
const ENCRYPTION_KEY_FILE_NAME = 'encryption.key'
const ENCRYPTION_KEY_BYTES = 32

type EnsureDesktopEncryptionKeyOptions = {
  dataDir: string
  env?: NodeJS.ProcessEnv
  generateKey?: () => string
}

function isValidEncryptionKey(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }

  const decoded = Buffer.from(trimmed, 'base64')
  return decoded.length === ENCRYPTION_KEY_BYTES
}

function getPersistedEncryptionKey(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null
  }

  const content = readFileSync(filePath, 'utf-8').trim()
  if (!isValidEncryptionKey(content)) {
    return null
  }

  return content
}

function createEncryptionKey(): string {
  return randomBytes(ENCRYPTION_KEY_BYTES).toString('base64')
}

export function ensureDesktopEncryptionKey(options: EnsureDesktopEncryptionKeyOptions): string {
  const env = options.env ?? process.env
  const configuredKey = env[ENCRYPTION_KEY_ENV_NAME]?.trim()

  if (configuredKey) {
    if (!isValidEncryptionKey(configuredKey)) {
      throw new Error(`${ENCRYPTION_KEY_ENV_NAME} must decode from base64 to exactly 32 bytes`)
    }

    delete env[ENCRYPTION_KEY_MANAGED_ENV_NAME]
    return configuredKey
  }

  const generateKey = options.generateKey ?? createEncryptionKey
  const keyDir = getDesktopSecretsDir(options.dataDir)
  const keyPath = join(keyDir, ENCRYPTION_KEY_FILE_NAME)
  const persistedKey = getPersistedEncryptionKey(keyPath)

  if (persistedKey) {
    env[ENCRYPTION_KEY_ENV_NAME] = persistedKey
    env[ENCRYPTION_KEY_MANAGED_ENV_NAME] = '1'
    return persistedKey
  }

  const generatedKey = generateKey().trim()
  if (!isValidEncryptionKey(generatedKey)) {
    throw new Error('Generated desktop encryption key is invalid')
  }

  mkdirSync(keyDir, { recursive: true })
  writeFileSync(keyPath, `${generatedKey}\n`, { encoding: 'utf-8', mode: 0o600 })
  chmodSync(keyPath, 0o600)

  env[ENCRYPTION_KEY_ENV_NAME] = generatedKey
  env[ENCRYPTION_KEY_MANAGED_ENV_NAME] = '1'
  return generatedKey
}

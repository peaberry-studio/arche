import { randomBytes } from 'crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import { getDesktopSecretsDir } from './vault-layout'

const OAUTH_STATE_SECRET_ENV_NAME = 'ARCHE_CONNECTOR_OAUTH_STATE_SECRET'
const OAUTH_STATE_SECRET_MANAGED_ENV_NAME = 'ARCHE_DESKTOP_MANAGED_CONNECTOR_OAUTH_STATE_SECRET'
const OAUTH_STATE_SECRET_FILE_NAME = 'connector-oauth-state-secret.key'
const OAUTH_STATE_SECRET_BYTES = 32

type EnsureDesktopConnectorOAuthStateSecretOptions = {
  dataDir: string
  env?: NodeJS.ProcessEnv
  generateSecret?: () => string
}

function isValidOAuthStateSecret(value: string): boolean {
  return value.trim().length > 0
}

function getPersistedOAuthStateSecret(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null
  }

  const content = readFileSync(filePath, 'utf-8').trim()
  if (!isValidOAuthStateSecret(content)) {
    return null
  }

  return content
}

function createOAuthStateSecret(): string {
  return randomBytes(OAUTH_STATE_SECRET_BYTES).toString('base64')
}

export function ensureDesktopConnectorOAuthStateSecret(
  options: EnsureDesktopConnectorOAuthStateSecretOptions,
): string {
  const env = options.env ?? process.env
  const configuredSecret = env[OAUTH_STATE_SECRET_ENV_NAME]?.trim()

  if (configuredSecret) {
    if (!isValidOAuthStateSecret(configuredSecret)) {
      throw new Error(`${OAUTH_STATE_SECRET_ENV_NAME} must be a non-empty string`)
    }

    delete env[OAUTH_STATE_SECRET_MANAGED_ENV_NAME]
    return configuredSecret
  }

  const generateSecret = options.generateSecret ?? createOAuthStateSecret
  const secretDir = getDesktopSecretsDir(options.dataDir)
  const secretPath = join(secretDir, OAUTH_STATE_SECRET_FILE_NAME)
  const persistedSecret = getPersistedOAuthStateSecret(secretPath)

  if (persistedSecret) {
    env[OAUTH_STATE_SECRET_ENV_NAME] = persistedSecret
    env[OAUTH_STATE_SECRET_MANAGED_ENV_NAME] = '1'
    return persistedSecret
  }

  const generatedSecret = generateSecret().trim()
  if (!isValidOAuthStateSecret(generatedSecret)) {
    throw new Error('Generated desktop connector OAuth state secret is invalid')
  }

  mkdirSync(secretDir, { recursive: true })
  writeFileSync(secretPath, `${generatedSecret}\n`, { encoding: 'utf-8', mode: 0o600 })
  chmodSync(secretPath, 0o600)

  env[OAUTH_STATE_SECRET_ENV_NAME] = generatedSecret
  env[OAUTH_STATE_SECRET_MANAGED_ENV_NAME] = '1'
  return generatedSecret
}

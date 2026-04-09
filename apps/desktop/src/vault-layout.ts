import { join } from 'path'

export const DEFAULT_NEW_VAULT_NAME = 'my-vault'

const DESKTOP_KB_CONFIG_DIR_NAME = '.kb-config'
const DESKTOP_KB_CONTENT_DIR_NAME = '.kb-content'
const DESKTOP_RUNTIME_DIR_NAME = '.runtime'
const DESKTOP_SECRETS_DIR_NAME = '.secrets'
const DESKTOP_USERS_DIR_NAME = '.users'
const DESKTOP_OPENCODE_RUNTIME_DIR_NAME = 'opencode'

export function getDesktopKbConfigDir(vaultPath: string): string {
  return join(vaultPath, DESKTOP_KB_CONFIG_DIR_NAME)
}

export function getDesktopKbContentDir(vaultPath: string): string {
  return join(vaultPath, DESKTOP_KB_CONTENT_DIR_NAME)
}

export function getDesktopRuntimeDir(vaultPath: string): string {
  return join(vaultPath, DESKTOP_RUNTIME_DIR_NAME)
}

export function getDesktopRuntimeDataDir(vaultPath: string): string {
  return join(getDesktopRuntimeDir(vaultPath), DESKTOP_OPENCODE_RUNTIME_DIR_NAME)
}

export function getDesktopSecretsDir(vaultPath: string): string {
  return join(vaultPath, DESKTOP_SECRETS_DIR_NAME)
}

export function getDesktopUsersDir(vaultPath: string): string {
  return join(vaultPath, DESKTOP_USERS_DIR_NAME)
}

export function getDesktopUserDataDir(vaultPath: string, slug: string): string {
  return join(getDesktopUsersDir(vaultPath), slug)
}

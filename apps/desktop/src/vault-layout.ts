import { join } from 'path'

import {
  DEFAULT_NEW_VAULT_NAME,
  DESKTOP_KB_CONFIG_DIR_NAME,
  DESKTOP_KB_CONTENT_DIR_NAME,
  DESKTOP_OPENCODE_RUNTIME_DIR_NAME,
  DESKTOP_RUNTIME_DIR_NAME,
  DESKTOP_SECRETS_DIR_NAME,
  DESKTOP_USERS_DIR_NAME,
  DESKTOP_WORKSPACE_DIR_NAME,
} from './vault-layout-constants'

export { DEFAULT_NEW_VAULT_NAME }

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

export function getDesktopWorkspaceDir(vaultPath: string): string {
  return join(vaultPath, DESKTOP_WORKSPACE_DIR_NAME)
}

export function getDesktopWorkspaceAttachmentsDir(vaultPath: string): string {
  return join(getDesktopWorkspaceDir(vaultPath), '.arche', 'attachments')
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

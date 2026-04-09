import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'

import type { CreateVaultArgs, DesktopApiResult } from './desktop-bridge-types'
import { DEFAULT_NEW_VAULT_NAME } from './vault-layout'
import type { DesktopVault } from './vault-manifest'

const MAX_VAULT_NAME_LENGTH = 255
const WINDOWS_RESERVED_VAULT_NAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

type CreateDesktopVaultDeps = {
  applyKickstartToPreparedVault: (vaultPath: string, kickstartPayload: unknown) => Promise<DesktopApiResult>
  createVaultManifest: (vaultPath: string, name: string) => DesktopVault
  ensureVaultDataDirectories: (vault: DesktopVault) => Promise<void>
  getDesktopMetadataDir: () => string
  launchVaultProcess: (vaultPath: string) => DesktopApiResult
  rememberVault: (metadataDir: string, vault: DesktopVault) => void
}

export function validateVaultName(rawName: string): string {
  const name = rawName.trim() || DEFAULT_NEW_VAULT_NAME
  if (name === '.' || name === '..') {
    throw new Error('Vault name is invalid')
  }
  if (/[\\/]/.test(name)) {
    throw new Error('Vault name cannot contain path separators')
  }
  if (/[<>:"|?*\u0000-\u001f]/.test(name)) {
    throw new Error('Vault name contains characters unsupported on Windows')
  }
  if (/[. ]$/.test(name)) {
    throw new Error('Vault name cannot end with a dot or space')
  }
  if (WINDOWS_RESERVED_VAULT_NAME_PATTERN.test(name)) {
    throw new Error('Vault name is reserved on Windows')
  }
  if (name.length > MAX_VAULT_NAME_LENGTH) {
    throw new Error('Vault name is too long')
  }
  return name
}

function clearDirectoryContents(dirPath: string): void {
  if (!existsSync(dirPath)) {
    return
  }

  for (const entry of readdirSync(dirPath)) {
    rmSync(join(dirPath, entry), { recursive: true, force: true })
  }
}

function cleanupFailedVaultCreation(vaultPath: string, removeVaultDirectory: boolean): void {
  if (!existsSync(vaultPath)) {
    return
  }

  if (removeVaultDirectory) {
    rmSync(vaultPath, { recursive: true, force: true })
    return
  }

  clearDirectoryContents(vaultPath)
}

export async function createDesktopVault(
  args: CreateVaultArgs,
  deps: CreateDesktopVaultDeps,
): Promise<DesktopApiResult> {
  const parentPath = args.parentPath.trim()
  if (!parentPath || !existsSync(parentPath)) {
    return { ok: false, error: 'parent_directory_not_found' }
  }

  let name: string
  try {
    name = validateVaultName(args.name)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'invalid_vault_name' }
  }

  const vaultPath = join(parentPath, name)
  let createdVaultDir = false
  if (existsSync(vaultPath)) {
    const entries = readdirSync(vaultPath)
    if (entries.length > 0) {
      return { ok: false, error: 'vault_directory_exists' }
    }
  } else {
    mkdirSync(vaultPath)
    createdVaultDir = true
  }

  try {
    const vault = deps.createVaultManifest(vaultPath, name)
    await deps.ensureVaultDataDirectories(vault)

    const kickstartResult = await deps.applyKickstartToPreparedVault(vault.path, args.kickstartPayload)
    if (!kickstartResult.ok) {
      cleanupFailedVaultCreation(vaultPath, createdVaultDir)
      return kickstartResult
    }

    deps.rememberVault(deps.getDesktopMetadataDir(), vault)
    return deps.launchVaultProcess(vault.path)
  } catch {
    cleanupFailedVaultCreation(vaultPath, createdVaultDir)
    return { ok: false, error: 'vault_create_failed' }
  }
}

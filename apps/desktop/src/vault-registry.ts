import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import type { DesktopVault } from './vault-manifest'
import { tryReadVault } from './vault-manifest'

const VAULT_REGISTRY_FILE_NAME = 'vault-registry.json'

export type RecentVaultEntry = {
  id: string
  name: string
  path: string
  lastOpenedAt: string
}

type VaultRegistryFile = {
  lastOpenedVaultPath: string | null
  recentVaults: RecentVaultEntry[]
}

export type VaultRegistry = VaultRegistryFile

const DEFAULT_REGISTRY: VaultRegistry = {
  lastOpenedVaultPath: null,
  recentVaults: [],
}

function isRecentVaultEntry(value: unknown): value is RecentVaultEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const entry = value as Record<string, unknown>
  return [entry.id, entry.name, entry.path, entry.lastOpenedAt].every(
    (field) => typeof field === 'string' && field.trim().length > 0,
  )
}

function getRegistryPath(metadataDir: string): string {
  return join(metadataDir, VAULT_REGISTRY_FILE_NAME)
}

function normalizeRegistry(value: unknown): VaultRegistry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_REGISTRY
  }

  const parsed = value as {
    lastOpenedVaultPath?: unknown
    recentVaults?: unknown
  }

  const recentVaults = Array.isArray(parsed.recentVaults)
    ? parsed.recentVaults.filter(isRecentVaultEntry)
    : []

  return {
    lastOpenedVaultPath:
      typeof parsed.lastOpenedVaultPath === 'string' && parsed.lastOpenedVaultPath.trim().length > 0
        ? parsed.lastOpenedVaultPath
        : null,
    recentVaults,
  }
}

function writeRegistry(metadataDir: string, registry: VaultRegistry): void {
  mkdirSync(metadataDir, { recursive: true })
  writeFileSync(getRegistryPath(metadataDir), `${JSON.stringify(registry, null, 2)}\n`, 'utf-8')
}

export function readVaultRegistry(metadataDir: string): VaultRegistry {
  const registryPath = getRegistryPath(metadataDir)
  if (!existsSync(registryPath)) {
    return DEFAULT_REGISTRY
  }

  try {
    return normalizeRegistry(JSON.parse(readFileSync(registryPath, 'utf-8')))
  } catch {
    return DEFAULT_REGISTRY
  }
}

export function rememberVault(metadataDir: string, vault: DesktopVault): VaultRegistry {
  const now = new Date().toISOString()
  const current = readVaultRegistry(metadataDir)
  const next: VaultRegistry = {
    lastOpenedVaultPath: vault.path,
    recentVaults: [
      {
        id: vault.id,
        name: vault.name,
        path: vault.path,
        lastOpenedAt: now,
      },
      ...current.recentVaults.filter((entry) => entry.path !== vault.path),
    ].slice(0, 20),
  }

  writeRegistry(metadataDir, next)
  return next
}

export function clearLastOpenedVault(metadataDir: string, vaultPath?: string): VaultRegistry {
  const current = readVaultRegistry(metadataDir)
  const next: VaultRegistry = {
    lastOpenedVaultPath:
      vaultPath && current.lastOpenedVaultPath === vaultPath ? null : current.lastOpenedVaultPath,
    recentVaults: current.recentVaults,
  }

  writeRegistry(metadataDir, next)
  return next
}

export function getRecentVaults(metadataDir: string): RecentVaultEntry[] {
  const registry = readVaultRegistry(metadataDir)
  const validVaults: RecentVaultEntry[] = []
  let mutated = false

  for (const entry of registry.recentVaults) {
    const vault = tryReadVault(entry.path)
    if (!vault) {
      mutated = true
      continue
    }

    validVaults.push({
      id: vault.id,
      name: vault.name,
      path: vault.path,
      lastOpenedAt: entry.lastOpenedAt,
    })
  }

  if (mutated) {
    writeRegistry(metadataDir, {
      lastOpenedVaultPath:
        registry.lastOpenedVaultPath && validVaults.some((entry) => entry.path === registry.lastOpenedVaultPath)
          ? registry.lastOpenedVaultPath
          : null,
      recentVaults: validVaults,
    })
  }

  return validVaults
}

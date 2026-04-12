import { randomUUID } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'

import { DESKTOP_MANIFEST_FILE_NAME } from './vault-layout-constants'

export const VAULT_MANIFEST_FILE_NAME = DESKTOP_MANIFEST_FILE_NAME
export const VAULT_SCHEMA_VERSION = 1

export type DesktopVaultManifest = {
  schemaVersion: number
  id: string
  name: string
  createdAt: string
}

export type DesktopVault = DesktopVaultManifest & {
  path: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseManifestJson(content: string, vaultPath: string): DesktopVaultManifest {
  const parsed = JSON.parse(content) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Vault manifest must be a JSON object')
  }

  const manifest = parsed as Record<string, unknown>
  const expectedName = basename(vaultPath)

  // Bumping the schema version requires an explicit migration path for existing vaults.
  if (manifest.schemaVersion !== VAULT_SCHEMA_VERSION) {
    throw new Error(`Unsupported vault schema version: ${String(manifest.schemaVersion)}`)
  }

  if (!isNonEmptyString(manifest.id)) {
    throw new Error('Vault manifest is missing a valid id')
  }

  if (!isNonEmptyString(manifest.name)) {
    throw new Error('Vault manifest is missing a valid name')
  }

  if (manifest.name !== expectedName) {
    throw new Error('Vault manifest name must match the folder name')
  }

  if (!isNonEmptyString(manifest.createdAt)) {
    throw new Error('Vault manifest is missing a valid createdAt timestamp')
  }

  const createdAt = new Date(manifest.createdAt)
  if (Number.isNaN(createdAt.getTime())) {
    throw new Error('Vault manifest createdAt timestamp is invalid')
  }

  return {
    schemaVersion: VAULT_SCHEMA_VERSION,
    id: manifest.id,
    name: manifest.name,
    createdAt: createdAt.toISOString(),
  }
}

export function getVaultManifestPath(vaultPath: string): string {
  return join(vaultPath, VAULT_MANIFEST_FILE_NAME)
}

export function readVaultManifest(vaultPath: string): DesktopVaultManifest {
  const manifestPath = getVaultManifestPath(vaultPath)
  if (!existsSync(manifestPath)) {
    throw new Error('Vault manifest not found')
  }

  return parseManifestJson(readFileSync(manifestPath, 'utf-8'), vaultPath)
}

export function tryReadVault(vaultPath: string): DesktopVault | null {
  try {
    return {
      path: vaultPath,
      ...readVaultManifest(vaultPath),
    }
  } catch {
    return null
  }
}

export function createVaultManifest(vaultPath: string, name: string): DesktopVault {
  const manifest: DesktopVaultManifest = {
    schemaVersion: VAULT_SCHEMA_VERSION,
    id: randomUUID(),
    name,
    createdAt: new Date().toISOString(),
  }

  writeFileSync(getVaultManifestPath(vaultPath), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')

  return {
    path: vaultPath,
    ...manifest,
  }
}

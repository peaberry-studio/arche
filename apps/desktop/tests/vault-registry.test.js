const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdirSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const { createVaultManifest } = require('../dist/vault-manifest.js')
const {
  getRecentVaults,
  readVaultRegistry,
  rememberVault,
} = require('../dist/vault-registry.js')

function withTempDir(run) {
  const root = join(tmpdir(), `arche-vault-registry-${Date.now()}-${Math.random()}`)
  mkdirSync(root, { recursive: true })
  try {
    return run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function createVault(root, name) {
  const vaultPath = join(root, name)
  mkdirSync(vaultPath, { recursive: true })
  return createVaultManifest(vaultPath, name)
}

test('stores recent vaults with the last opened vault first', () => {
  withTempDir((root) => {
    const metadataDir = join(root, 'metadata')
    const vaultA = createVault(root, 'Arche')
    const vaultB = createVault(root, 'Ideas')

    rememberVault(metadataDir, vaultA)
    rememberVault(metadataDir, vaultB)

    const registry = readVaultRegistry(metadataDir)
    const recentVaults = getRecentVaults(metadataDir)

    assert.equal(registry.lastOpenedVaultPath, vaultB.path)
    assert.deepEqual(recentVaults.map((vault) => vault.name), ['Ideas', 'Arche'])
  })
})

test('filters out invalid recent vault entries', () => {
  withTempDir((root) => {
    const metadataDir = join(root, 'metadata')
    const vault = createVault(root, 'Arche')
    rememberVault(metadataDir, vault)

    rmSync(vault.path, { recursive: true, force: true })

    assert.deepEqual(getRecentVaults(metadataDir), [])
  })
})

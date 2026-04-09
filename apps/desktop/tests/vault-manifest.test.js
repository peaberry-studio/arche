const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdirSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const {
  createVaultManifest,
  readVaultManifest,
  tryReadVault,
} = require('../dist/vault-manifest.js')

function withTempDir(run) {
  const root = join(tmpdir(), `arche-vault-manifest-${Date.now()}-${Math.random()}`)
  mkdirSync(root, { recursive: true })
  try {
    return run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('creates and reads a vault manifest', () => {
  withTempDir((root) => {
    const vaultPath = join(root, 'Arche')
    mkdirSync(vaultPath)

    const created = createVaultManifest(vaultPath, 'Arche')
    const manifest = readVaultManifest(vaultPath)
    const resolved = tryReadVault(vaultPath)

    assert.equal(manifest.name, 'Arche')
    assert.equal(created.id, manifest.id)
    assert.equal(resolved.path, vaultPath)
  })
})

test('rejects manifests whose name does not match the folder name', () => {
  withTempDir((root) => {
    const vaultPath = join(root, 'Arche')
    mkdirSync(vaultPath)
    createVaultManifest(vaultPath, 'Arche')

    const wrongPath = join(root, 'Other')
    mkdirSync(wrongPath)
    const fs = require('node:fs')
    fs.copyFileSync(join(vaultPath, '.arche-vault.json'), join(wrongPath, '.arche-vault.json'))

    assert.equal(tryReadVault(wrongPath), null)
  })
})

const test = require('node:test')
const assert = require('node:assert/strict')
const { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } = require('fs')
const { tmpdir } = require('os')
const { join } = require('path')

const { createDesktopVault, validateVaultName } = require('../dist/create-vault.js')
const {
  DESKTOP_DATABASE_FILE_NAME,
  LOCAL_DESKTOP_USER_SLUG,
} = require('../dist/vault-layout-constants.js')
const {
  getDesktopKbConfigDir,
  getDesktopKbContentDir,
  getDesktopRuntimeDataDir,
  getDesktopSecretsDir,
  getDesktopUserDataDir,
  getDesktopWorkspaceDir,
} = require('../dist/vault-layout.js')
const { createVaultManifest, getVaultManifestPath } = require('../dist/vault-manifest.js')

async function withTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), 'arche-create-vault-test-'))
  try {
    return await run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function createPartialVaultArtifacts(vault) {
  mkdirSync(getDesktopKbConfigDir(vault.path), { recursive: true })
  mkdirSync(getDesktopKbContentDir(vault.path), { recursive: true })
  mkdirSync(getDesktopWorkspaceDir(vault.path), { recursive: true })
  mkdirSync(getDesktopUserDataDir(vault.path, LOCAL_DESKTOP_USER_SLUG), { recursive: true })
  mkdirSync(getDesktopRuntimeDataDir(vault.path), { recursive: true })
  mkdirSync(getDesktopSecretsDir(vault.path), { recursive: true })
  writeFileSync(join(vault.path, DESKTOP_DATABASE_FILE_NAME), '')
}

test('validateVaultName applies cheap cross-platform safeguards', () => {
  assert.equal(validateVaultName('  '), 'my-vault')
  assert.equal(validateVaultName('product-specs'), 'product-specs')

  assert.throws(() => validateVaultName('my/vault'), /path separators/)
  assert.throws(() => validateVaultName('sales:*'), /unsupported on Windows/)
  assert.throws(() => validateVaultName('vault. '), /dot or space/)
  assert.throws(() => validateVaultName('CON'), /reserved on Windows/)
  assert.throws(() => validateVaultName('a'.repeat(256)), /too long/)
})

test('removes a newly created vault directory when kickstart setup fails', async () => {
  await withTempDir(async (rootDir) => {
    const metadataDir = join(rootDir, 'metadata')
    const rememberVaultCalls = []
    const launchVaultCalls = []

    const result = await createDesktopVault(
      {
        kickstartPayload: { templateId: 'blank' },
        parentPath: rootDir,
        name: 'my-vault',
      },
      {
        applyKickstartToPreparedVault: async () => ({ ok: false, error: 'vault_setup_failed' }),
        createVaultManifest,
        ensureVaultDataDirectories: async (vault) => {
          createPartialVaultArtifacts(vault)
        },
        getDesktopMetadataDir: () => metadataDir,
        launchVaultProcess: (vaultPath) => {
          launchVaultCalls.push(vaultPath)
          return { ok: true }
        },
        rememberVault: (nextMetadataDir, vault) => {
          rememberVaultCalls.push({ nextMetadataDir, vaultPath: vault.path })
        },
      },
    )

    assert.deepEqual(result, { ok: false, error: 'vault_setup_failed' })
    assert.equal(existsSync(join(rootDir, 'my-vault')), false)
    assert.deepEqual(rememberVaultCalls, [])
    assert.deepEqual(launchVaultCalls, [])
  })
})

test('clears a reused empty vault directory when kickstart setup fails', async () => {
  await withTempDir(async (rootDir) => {
    const metadataDir = join(rootDir, 'metadata')
    const vaultPath = join(rootDir, 'my-vault')
    mkdirSync(vaultPath)

    const result = await createDesktopVault(
      {
        kickstartPayload: { templateId: 'blank' },
        parentPath: rootDir,
        name: 'my-vault',
      },
      {
        applyKickstartToPreparedVault: async () => ({ ok: false, error: 'vault_setup_failed' }),
        createVaultManifest,
        ensureVaultDataDirectories: async (vault) => {
          createPartialVaultArtifacts(vault)
        },
        getDesktopMetadataDir: () => metadataDir,
        launchVaultProcess: () => ({ ok: true }),
        rememberVault: () => undefined,
      },
    )

    assert.deepEqual(result, { ok: false, error: 'vault_setup_failed' })
    assert.equal(existsSync(vaultPath), true)
    assert.deepEqual(readdirSync(vaultPath), [])
    assert.equal(existsSync(getVaultManifestPath(vaultPath)), false)
  })
})

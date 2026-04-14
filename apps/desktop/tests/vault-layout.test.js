const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdirSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const {
  DEFAULT_NEW_VAULT_NAME,
  getDesktopKbConfigDir,
  getDesktopKbContentDir,
  getDesktopRuntimeDir,
  getDesktopSecretsDir,
  getDesktopUsersDir,
  getDesktopWorkspaceAttachmentsDir,
} = require('../dist/vault-layout.js')

function withTempDir(run) {
  const root = join(tmpdir(), `arche-vault-layout-${Date.now()}-${Math.random()}`)
  mkdirSync(root, { recursive: true })
  try {
    return run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('returns hidden desktop vault paths', () => {
  withTempDir((root) => {
    const vaultPath = join(root, 'Arche')
    assert.equal(DEFAULT_NEW_VAULT_NAME, 'my-vault')
    assert.equal(getDesktopKbConfigDir(vaultPath), join(vaultPath, '.kb-config'))
    assert.equal(getDesktopKbContentDir(vaultPath), join(vaultPath, '.kb-content'))
    assert.equal(getDesktopRuntimeDir(vaultPath), join(vaultPath, '.runtime'))
    assert.equal(getDesktopSecretsDir(vaultPath), join(vaultPath, '.secrets'))
    assert.equal(getDesktopUsersDir(vaultPath), join(vaultPath, '.users'))
    assert.equal(getDesktopWorkspaceAttachmentsDir(vaultPath), join(vaultPath, 'workspace', '.arche', 'attachments'))
  })
})

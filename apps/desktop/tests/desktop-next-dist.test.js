const test = require('node:test')
const assert = require('node:assert/strict')

const { getDesktopNextDistDirName } = require('../dist/desktop-next-dist.js')

test('returns a stable packaged dist directory', () => {
  assert.equal(
    getDesktopNextDistDirName({
      currentVaultId: 'vault-1',
      isPackaged: true,
      launchContext: { mode: 'vault', vaultPath: '/tmp/vault-1' },
    }),
    '.next-desktop',
  )
})

test('isolates launcher and vault dist directories in development', () => {
  assert.equal(
    getDesktopNextDistDirName({
      currentVaultId: null,
      isPackaged: false,
      launchContext: { mode: 'launcher', vaultPath: null },
    }),
    '.next-desktop-launcher',
  )

  assert.equal(
    getDesktopNextDistDirName({
      currentVaultId: 'vault-123',
      isPackaged: false,
      launchContext: { mode: 'vault', vaultPath: '/tmp/vault-123' },
    }),
    '.next-desktop-vault-vault-123',
  )
})

test('sanitizes vault ids for development dist directories', () => {
  assert.equal(
    getDesktopNextDistDirName({
      currentVaultId: 'vault id/with spaces',
      isPackaged: false,
      launchContext: { mode: 'vault', vaultPath: '/tmp/vault-unsafe' },
    }),
    '.next-desktop-vault-vault-id-with-spaces',
  )
})

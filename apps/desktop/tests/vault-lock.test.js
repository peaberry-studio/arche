const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdirSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const { acquireVaultLock, getVaultLockState } = require('../dist/vault-lock.js')

function withTempDir(run) {
  const root = join(tmpdir(), `arche-vault-lock-${Date.now()}-${Math.random()}`)
  mkdirSync(root, { recursive: true })
  try {
    return run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('acquires and releases a vault lock', () => {
  withTempDir((root) => {
    const vaultPath = join(root, 'Arche')
    mkdirSync(vaultPath)

    const lock = acquireVaultLock(vaultPath)
    assert.ok(lock)
    assert.deepEqual(getVaultLockState(vaultPath), { locked: true, pid: process.pid })

    lock.release()
    assert.deepEqual(getVaultLockState(vaultPath), { locked: false, pid: null })
  })
})

test('clears stale vault lock files', () => {
  withTempDir((root) => {
    const vaultPath = join(root, 'Arche')
    mkdirSync(join(vaultPath, '.runtime'), { recursive: true })
    writeFileSync(
      join(vaultPath, '.runtime', 'vault.lock'),
      JSON.stringify({ pid: 999999, acquiredAt: new Date().toISOString() }),
      'utf-8',
    )

    assert.deepEqual(getVaultLockState(vaultPath), { locked: false, pid: null })
  })
})

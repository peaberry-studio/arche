const test = require('node:test')
const assert = require('node:assert/strict')
const { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const { ensureDesktopEncryptionKey } = require('../dist/desktop-encryption-key.js')

function withTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), 'arche-desktop-key-'))
  try {
    return run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('uses ARCHE_ENCRYPTION_KEY from env when valid', () => {
  withTempDir((dataDir) => {
    const key = Buffer.alloc(32, 7).toString('base64')
    const env = { ARCHE_ENCRYPTION_KEY: key }

    const resolved = ensureDesktopEncryptionKey({
      dataDir,
      env,
      generateKey: () => {
        throw new Error('generateKey should not be called when env key exists')
      },
    })

    assert.equal(resolved, key)
    assert.equal(env.ARCHE_ENCRYPTION_KEY, key)
    assert.equal(env.ARCHE_DESKTOP_MANAGED_ENCRYPTION_KEY, undefined)
  })
})

test('loads persisted key when env key is missing', () => {
  withTempDir((dataDir) => {
    const persisted = Buffer.alloc(32, 11).toString('base64')
    const keyDir = join(dataDir, '.secrets')
    const keyPath = join(keyDir, 'encryption.key')
    mkdirSync(keyDir, { recursive: true })
    writeFileSync(keyPath, `${persisted}\n`, 'utf-8')

    const env = {}
    const resolved = ensureDesktopEncryptionKey({
      dataDir,
      env,
      generateKey: () => {
        throw new Error('generateKey should not be called when key file exists')
      },
    })

    assert.equal(resolved, persisted)
    assert.equal(env.ARCHE_ENCRYPTION_KEY, persisted)
    assert.equal(env.ARCHE_DESKTOP_MANAGED_ENCRYPTION_KEY, '1')
  })
})

test('creates and persists a key when no env or key file exists', () => {
  withTempDir((dataDir) => {
    const generated = Buffer.alloc(32, 23).toString('base64')
    const env = {}

    const resolved = ensureDesktopEncryptionKey({
      dataDir,
      env,
      generateKey: () => generated,
    })

    const keyPath = join(dataDir, '.secrets', 'encryption.key')
    assert.equal(resolved, generated)
    assert.equal(env.ARCHE_ENCRYPTION_KEY, generated)
    assert.equal(env.ARCHE_DESKTOP_MANAGED_ENCRYPTION_KEY, '1')
    assert.equal(readFileSync(keyPath, 'utf-8').trim(), generated)
    assert.equal(statSync(keyPath).mode & 0o777, 0o600)
  })
})

test('replaces an invalid persisted key', () => {
  withTempDir((dataDir) => {
    const keyDir = join(dataDir, '.secrets')
    const keyPath = join(keyDir, 'encryption.key')
    mkdirSync(keyDir, { recursive: true })
    writeFileSync(keyPath, 'invalid-key\n', 'utf-8')
    chmodSync(keyPath, 0o644)

    const generated = Buffer.alloc(32, 31).toString('base64')
    const env = {}
    const resolved = ensureDesktopEncryptionKey({
      dataDir,
      env,
      generateKey: () => generated,
    })

    assert.equal(resolved, generated)
    assert.equal(env.ARCHE_ENCRYPTION_KEY, generated)
    assert.equal(env.ARCHE_DESKTOP_MANAGED_ENCRYPTION_KEY, '1')
    assert.equal(readFileSync(keyPath, 'utf-8').trim(), generated)
    assert.equal(statSync(keyPath).mode & 0o777, 0o600)
  })
})

test('throws when ARCHE_ENCRYPTION_KEY from env is invalid', () => {
  withTempDir((dataDir) => {
    const env = { ARCHE_ENCRYPTION_KEY: 'invalid-key' }

    assert.throws(
      () => ensureDesktopEncryptionKey({ dataDir, env }),
      /ARCHE_ENCRYPTION_KEY must decode from base64 to exactly 32 bytes/,
    )
  })
})

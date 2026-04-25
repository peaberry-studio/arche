const test = require('node:test')
const assert = require('node:assert/strict')
const { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const { ensureDesktopConnectorOAuthStateSecret } = require('../dist/desktop-connector-oauth-secret.js')

function withTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), 'arche-desktop-oauth-'))
  try {
    return run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('uses ARCHE_CONNECTOR_OAUTH_STATE_SECRET from env when valid', () => {
  withTempDir((dataDir) => {
    const secret = 'my-oauth-state-secret-from-env'
    const env = { ARCHE_CONNECTOR_OAUTH_STATE_SECRET: secret }

    const resolved = ensureDesktopConnectorOAuthStateSecret({
      dataDir,
      env,
      generateSecret: () => {
        throw new Error('generateSecret should not be called when env secret exists')
      },
    })

    assert.equal(resolved, secret)
    assert.equal(env.ARCHE_CONNECTOR_OAUTH_STATE_SECRET, secret)
    assert.equal(env.ARCHE_DESKTOP_MANAGED_CONNECTOR_OAUTH_STATE_SECRET, undefined)
  })
})

test('loads persisted secret when env secret is missing', () => {
  withTempDir((dataDir) => {
    const persisted = 'my-persisted-oauth-state-secret'
    const secretDir = join(dataDir, '.secrets')
    const secretPath = join(secretDir, 'connector-oauth-state-secret.key')
    mkdirSync(secretDir, { recursive: true })
    writeFileSync(secretPath, `${persisted}\n`, 'utf-8')

    const env = {}
    const resolved = ensureDesktopConnectorOAuthStateSecret({
      dataDir,
      env,
      generateSecret: () => {
        throw new Error('generateSecret should not be called when secret file exists')
      },
    })

    assert.equal(resolved, persisted)
    assert.equal(env.ARCHE_CONNECTOR_OAUTH_STATE_SECRET, persisted)
    assert.equal(env.ARCHE_DESKTOP_MANAGED_CONNECTOR_OAUTH_STATE_SECRET, '1')
  })
})

test('creates and persists a secret when no env or secret file exists', () => {
  withTempDir((dataDir) => {
    const generated = 'freshly-generated-oauth-state-secret'
    const env = {}

    const resolved = ensureDesktopConnectorOAuthStateSecret({
      dataDir,
      env,
      generateSecret: () => generated,
    })

    const secretPath = join(dataDir, '.secrets', 'connector-oauth-state-secret.key')
    assert.equal(resolved, generated)
    assert.equal(env.ARCHE_CONNECTOR_OAUTH_STATE_SECRET, generated)
    assert.equal(env.ARCHE_DESKTOP_MANAGED_CONNECTOR_OAUTH_STATE_SECRET, '1')
    assert.equal(readFileSync(secretPath, 'utf-8').trim(), generated)
    assert.equal(statSync(secretPath).mode & 0o777, 0o600)
  })
})

test('replaces an invalid persisted secret', () => {
  withTempDir((dataDir) => {
    const secretDir = join(dataDir, '.secrets')
    const secretPath = join(secretDir, 'connector-oauth-state-secret.key')
    mkdirSync(secretDir, { recursive: true })
    writeFileSync(secretPath, '\n', 'utf-8')
    chmodSync(secretPath, 0o644)

    const generated = 'new-generated-oauth-state-secret'
    const env = {}
    const resolved = ensureDesktopConnectorOAuthStateSecret({
      dataDir,
      env,
      generateSecret: () => generated,
    })

    assert.equal(resolved, generated)
    assert.equal(env.ARCHE_CONNECTOR_OAUTH_STATE_SECRET, generated)
    assert.equal(env.ARCHE_DESKTOP_MANAGED_CONNECTOR_OAUTH_STATE_SECRET, '1')
    assert.equal(readFileSync(secretPath, 'utf-8').trim(), generated)
    assert.equal(statSync(secretPath).mode & 0o777, 0o600)
  })
})

test('falls back to generating a secret when env value is empty whitespace', () => {
  withTempDir((dataDir) => {
    const generated = 'fallback-generated-secret'
    const env = { ARCHE_CONNECTOR_OAUTH_STATE_SECRET: '   ' }

    const resolved = ensureDesktopConnectorOAuthStateSecret({
      dataDir,
      env,
      generateSecret: () => generated,
    })

    const secretPath = join(dataDir, '.secrets', 'connector-oauth-state-secret.key')
    assert.equal(resolved, generated)
    assert.equal(env.ARCHE_CONNECTOR_OAUTH_STATE_SECRET, generated)
    assert.equal(env.ARCHE_DESKTOP_MANAGED_CONNECTOR_OAUTH_STATE_SECRET, '1')
    assert.equal(readFileSync(secretPath, 'utf-8').trim(), generated)
  })
})

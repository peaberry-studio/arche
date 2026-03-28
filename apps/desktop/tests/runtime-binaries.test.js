const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const {
  resolveRuntimeBinaryPath,
  resolveRuntimeConfigDirPath,
  getRuntimeBinaryEnv,
  getPackagedNodeBinaryPath,
  getMissingPackagedRuntimeBinaries,
} = require('../dist/runtime-binaries.js')

test('resolves bundled development binaries from apps/desktop/bin', () => {
  const originalExistsSync = fs.existsSync
  fs.existsSync = (target) => target.endsWith('/bin/opencode') || target.endsWith('/bin/workspace-agent')

  try {
    const options = {
      isPackaged: false,
      devBaseDir: '/repo/apps/desktop/dist',
      env: {},
      platform: 'darwin',
    }

    assert.equal(resolveRuntimeBinaryPath('opencode', options), '/repo/apps/desktop/bin/opencode')
    assert.equal(
      resolveRuntimeBinaryPath('workspace-agent', options),
      '/repo/apps/desktop/bin/workspace-agent',
    )
  } finally {
    fs.existsSync = originalExistsSync
  }
})

test('prefers explicit env overrides in development mode', () => {
  const options = {
    isPackaged: false,
    devBaseDir: '/repo/apps/desktop/dist',
    env: {
      ARCHE_OPENCODE_BIN: '/custom/opencode',
      ARCHE_OPENCODE_CONFIG_DIR: '/custom/opencode-config',
      ARCHE_WORKSPACE_AGENT_BIN: '/custom/workspace-agent',
      ARCHE_NODE_BIN: '/custom/node',
    },
    platform: 'darwin',
  }

  assert.equal(resolveRuntimeBinaryPath('opencode', options), '/custom/opencode')
  assert.equal(resolveRuntimeConfigDirPath(options), '/custom/opencode-config')
  assert.equal(resolveRuntimeBinaryPath('workspace-agent', options), '/custom/workspace-agent')
  assert.equal(resolveRuntimeBinaryPath('node', options), '/custom/node')
})

test('ignores env overrides in packaged builds', () => {
  const originalExistsSync = fs.existsSync
  fs.existsSync = (target) => target.includes('/Resources/bin/')

  try {
    const options = {
      isPackaged: true,
      resourcesPath: '/Applications/Arche.app/Contents/Resources',
      devBaseDir: '/repo/apps/desktop/dist',
      env: {
        ARCHE_OPENCODE_BIN: '/custom/opencode',
        ARCHE_WORKSPACE_AGENT_BIN: '/custom/workspace-agent',
        ARCHE_NODE_BIN: '/custom/node',
      },
      platform: 'darwin',
    }

    // Should resolve to bundled paths, not env overrides
    assert.equal(
      resolveRuntimeBinaryPath('opencode', options),
      '/Applications/Arche.app/Contents/Resources/bin/opencode',
    )
    assert.equal(
      resolveRuntimeBinaryPath('node', options),
      '/Applications/Arche.app/Contents/Resources/bin/node',
    )
  } finally {
    fs.existsSync = originalExistsSync
  }
})

test('returns missing packaged runtime binaries when bundle is incomplete', () => {
  const originalExistsSync = fs.existsSync
  fs.existsSync = (target) => target.endsWith('/bin/opencode')

  try {
    const options = {
      isPackaged: true,
      resourcesPath: '/Applications/Arche.app/Contents/Resources',
      devBaseDir: '/repo/apps/desktop/dist',
      env: {},
      platform: 'darwin',
    }

    assert.deepEqual(getMissingPackagedRuntimeBinaries(options), ['node', 'workspace-agent', 'opencode-config'])
  } finally {
    fs.existsSync = originalExistsSync
  }
})

test('resolves bundled OpenCode config directory in packaged builds', () => {
  const originalExistsSync = fs.existsSync
  fs.existsSync = (target) => target.endsWith('/bin/opencode-config')

  try {
    const options = {
      isPackaged: true,
      resourcesPath: '/Applications/Arche.app/Contents/Resources',
      devBaseDir: '/repo/apps/desktop/dist',
      env: {},
      platform: 'darwin',
    }

    assert.equal(
      resolveRuntimeConfigDirPath(options),
      '/Applications/Arche.app/Contents/Resources/bin/opencode-config',
    )
  } finally {
    fs.existsSync = originalExistsSync
  }
})

test('injects runtime env vars only for binaries that exist', () => {
  const originalExistsSync = fs.existsSync
  fs.existsSync =
    (target) => target.endsWith('/bin/opencode') || target.endsWith('/bin/opencode-config')

  try {
    const env = getRuntimeBinaryEnv({
      isPackaged: false,
      devBaseDir: '/repo/apps/desktop/dist',
      env: {},
      platform: 'darwin',
    })

    assert.deepEqual(env, {
      ARCHE_OPENCODE_BIN: '/repo/apps/desktop/bin/opencode',
      ARCHE_OPENCODE_CONFIG_DIR: '/repo/apps/desktop/bin/opencode-config',
    })
  } finally {
    fs.existsSync = originalExistsSync
  }
})

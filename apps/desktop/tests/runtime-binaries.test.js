const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const {
  resolveRuntimeBinaryPath,
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

test('prefers explicit env overrides for runtime binaries', () => {
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

  assert.equal(resolveRuntimeBinaryPath('opencode', options), '/custom/opencode')
  assert.equal(resolveRuntimeBinaryPath('workspace-agent', options), '/custom/workspace-agent')
  assert.equal(getPackagedNodeBinaryPath(options), '/custom/node')
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

    assert.deepEqual(getMissingPackagedRuntimeBinaries(options), ['node', 'workspace-agent'])
  } finally {
    fs.existsSync = originalExistsSync
  }
})

test('injects runtime env vars only for binaries that exist', () => {
  const originalExistsSync = fs.existsSync
  fs.existsSync = (target) => target.endsWith('/bin/opencode')

  try {
    const env = getRuntimeBinaryEnv({
      isPackaged: false,
      devBaseDir: '/repo/apps/desktop/dist',
      env: {},
      platform: 'darwin',
    })

    assert.deepEqual(env, {
      ARCHE_OPENCODE_BIN: '/repo/apps/desktop/bin/opencode',
    })
  } finally {
    fs.existsSync = originalExistsSync
  }
})

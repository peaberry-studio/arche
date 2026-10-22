const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const {
  resolveRuntimeBinaryPath,
  resolveRuntimeToolsDirPath,
  getRuntimeBinaryEnv,
  getPackagedNodeBinaryPath,
  getMissingPackagedRuntimeBinaries,
} = require('@arche/desktop-runtime/binaries')

test('resolves bundled development binaries from apps/desktop/bin', () => {
  const originalExistsSync = fs.existsSync
  fs.existsSync = (target) => target.endsWith('/bin/opencode') || target.endsWith('/bin/opencode-v1') || target.endsWith('/bin/workspace-agent')

  try {
    const options = {
      isPackaged: false,
      devBaseDir: '/repo/apps/desktop/dist',
      env: {},
      platform: 'darwin',
    }

    assert.equal(resolveRuntimeBinaryPath('opencode', options), '/repo/apps/desktop/bin/opencode')
    assert.equal(resolveRuntimeBinaryPath('opencode-v1', options), '/repo/apps/desktop/bin/opencode-v1')
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
      ARCHE_OPENCODE_V1_BIN: '/custom/opencode-v1',
      ARCHE_TOOLS_DIR: '/custom/arche-tools',
      ARCHE_WORKSPACE_AGENT_BIN: '/custom/workspace-agent',
      ARCHE_NODE_BIN: '/custom/node',
    },
    platform: 'darwin',
  }

  assert.equal(resolveRuntimeBinaryPath('opencode', options), '/custom/opencode')
  assert.equal(resolveRuntimeBinaryPath('opencode-v1', options), '/custom/opencode-v1')
  assert.equal(resolveRuntimeToolsDirPath(options), '/custom/arche-tools')
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
        ARCHE_OPENCODE_V1_BIN: '/custom/opencode-v1',
        ARCHE_WORKSPACE_AGENT_BIN: '/custom/workspace-agent',
        ARCHE_NODE_BIN: '/custom/node',
        ARCHE_TOOLS_DIR: '/custom/arche-tools',
      },
      platform: 'darwin',
    }

    // Should resolve to bundled paths, not env overrides
    assert.equal(
      resolveRuntimeBinaryPath('opencode', options),
      '/Applications/Arche.app/Contents/Resources/bin/opencode',
    )
    assert.equal(
      resolveRuntimeBinaryPath('opencode-v1', options),
      '/Applications/Arche.app/Contents/Resources/bin/opencode-v1',
    )
    assert.equal(
      resolveRuntimeBinaryPath('node', options),
      '/Applications/Arche.app/Contents/Resources/bin/node',
    )
    assert.equal(
      resolveRuntimeToolsDirPath(options),
      '/Applications/Arche.app/Contents/Resources/bin/arche-tools',
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

    assert.deepEqual(getMissingPackagedRuntimeBinaries(options), ['node', 'opencode-v1', 'workspace-agent', 'arche-tools'])
  } finally {
    fs.existsSync = originalExistsSync
  }
})

test('resolves bundled Arche tools directory in packaged builds', () => {
  const originalExistsSync = fs.existsSync
  fs.existsSync = (target) => target.endsWith('/bin/arche-tools/server.js')

  try {
    const options = {
      isPackaged: true,
      resourcesPath: '/Applications/Arche.app/Contents/Resources',
      devBaseDir: '/repo/apps/desktop/dist',
      env: {},
      platform: 'darwin',
    }

    assert.equal(
      resolveRuntimeToolsDirPath(options),
      '/Applications/Arche.app/Contents/Resources/bin/arche-tools',
    )
  } finally {
    fs.existsSync = originalExistsSync
  }
})

test('injects runtime env vars only for binaries that exist', () => {
  const originalExistsSync = fs.existsSync
  fs.existsSync =
    (target) => target.endsWith('/bin/opencode') || target.endsWith('/bin/opencode-v1') || target.endsWith('/bin/arche-tools/server.js') || target.endsWith('/bin/node')

  try {
    const env = getRuntimeBinaryEnv({
      isPackaged: false,
      devBaseDir: '/repo/apps/desktop/dist',
      env: {},
      platform: 'darwin',
    })

    assert.deepEqual(env, {
      ARCHE_OPENCODE_BIN: '/repo/apps/desktop/bin/opencode',
      ARCHE_OPENCODE_V1_BIN: '/repo/apps/desktop/bin/opencode-v1',
      ARCHE_NODE_BIN: '/repo/apps/desktop/bin/node',
      ARCHE_TOOLS_DIR: '/repo/apps/desktop/bin/arche-tools',
    })
  } finally {
    fs.existsSync = originalExistsSync
  }
})

test('rejects an Arche tools bundle without its server entrypoint', () => {
  const originalExistsSync = fs.existsSync
  fs.existsSync = (target) => !target.endsWith('/server.js')

  try {
    const options = {
      isPackaged: true,
      resourcesPath: '/Applications/Arche.app/Contents/Resources',
      devBaseDir: '/repo/apps/desktop/dist',
      env: {},
    }

    assert.deepEqual(getMissingPackagedRuntimeBinaries(options), ['arche-tools'])
  } finally {
    fs.existsSync = originalExistsSync
  }
})

test('packages one prepared Arche tools bundle instead of plugin config sources', () => {
  const { extraResources } = require('../electron-builder.config')
  const toolsResources = extraResources.filter((resource) => resource.to.includes('arche-tools'))

  assert.deepEqual(toolsResources, [
    { from: 'bin/arche-tools', to: 'bin/arche-tools', filter: ['**/*'] },
  ])
  assert.equal(extraResources.some((resource) => resource.to.includes('opencode-config')), false)
})

test('packages both current and legacy OpenCode binaries', () => {
  const { extraResources } = require('../electron-builder.config')
  assert.deepEqual(extraResources.filter((resource) => resource.to.startsWith('bin/opencode')), [
    { from: 'bin/opencode', to: 'bin/opencode' },
    { from: 'bin/opencode-v1', to: 'bin/opencode-v1' },
  ])
})

test('resolves both Windows OpenCode executable names', () => {
  const originalExistsSync = fs.existsSync
  fs.existsSync = (target) => target.endsWith('.exe')

  try {
    const options = {
      isPackaged: true,
      resourcesPath: '/packaged',
      devBaseDir: '/repo/apps/desktop/dist',
      platform: 'win32',
    }
    assert.equal(resolveRuntimeBinaryPath('opencode', options), '/packaged/bin/opencode.exe')
    assert.equal(resolveRuntimeBinaryPath('opencode-v1', options), '/packaged/bin/opencode-v1.exe')
  } finally {
    fs.existsSync = originalExistsSync
  }
})

test('does not use the current binary override for the legacy binary', () => {
  const originalExistsSync = fs.existsSync
  fs.existsSync = () => false

  try {
    const options = {
      isPackaged: false,
      devBaseDir: '/repo/apps/desktop/dist',
      env: { ARCHE_OPENCODE_BIN: '/custom/opencode' },
    }
    assert.equal(resolveRuntimeBinaryPath('opencode-v1', options), null)
    assert.deepEqual(getRuntimeBinaryEnv(options), { ARCHE_OPENCODE_BIN: '/custom/opencode' })
  } finally {
    fs.existsSync = originalExistsSync
  }
})

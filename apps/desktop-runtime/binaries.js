'use strict'

const fs = require('fs')
const { join } = require('path')

const ENV_VAR_BY_RESOURCE = {
  node: 'ARCHE_NODE_BIN',
  opencode: 'ARCHE_OPENCODE_BIN',
  'workspace-agent': 'ARCHE_WORKSPACE_AGENT_BIN',
  'opencode-config': 'ARCHE_OPENCODE_CONFIG_DIR',
}

function getBundledResourcesBaseDir(options) {
  return options.isPackaged
    ? join(options.resourcesPath ?? '', 'bin')
    : join(options.devBaseDir, '..', 'bin')
}

function getBinaryFileName(binaryName, platform) {
  const extension = platform === 'win32' ? '.exe' : ''
  if (binaryName === 'workspace-agent') {
    return `workspace-agent${extension}`
  }
  if (binaryName === 'opencode') {
    return `opencode${extension}`
  }
  return `node${extension}`
}

function getRuntimeResourceCandidate(resourceName, options) {
  const baseDir = getBundledResourcesBaseDir(options)
  if (resourceName === 'opencode-config') {
    return join(baseDir, 'opencode-config')
  }

  return join(baseDir, getBinaryFileName(resourceName, options.platform ?? process.platform))
}

function resolveRuntimeResourcePath(resourceName, options) {
  if (!options.isPackaged) {
    const envValue = options.env?.[ENV_VAR_BY_RESOURCE[resourceName]]
    if (envValue) {
      return envValue
    }
  }

  const bundledCandidate = getRuntimeResourceCandidate(resourceName, options)
  if (fs.existsSync(bundledCandidate)) {
    return bundledCandidate
  }

  return null
}

function resolveRuntimeBinaryPath(binaryName, options) {
  return resolveRuntimeResourcePath(binaryName, options)
}

function resolveRuntimeConfigDirPath(options) {
  return resolveRuntimeResourcePath('opencode-config', options)
}

function getRuntimeBinaryEnv(options) {
  const opencode = resolveRuntimeBinaryPath('opencode', options)
  const opencodeConfigDir = resolveRuntimeConfigDirPath(options)
  const workspaceAgent = resolveRuntimeBinaryPath('workspace-agent', options)

  return {
    ...(opencode ? { ARCHE_OPENCODE_BIN: opencode } : {}),
    ...(opencodeConfigDir ? { ARCHE_OPENCODE_CONFIG_DIR: opencodeConfigDir } : {}),
    ...(workspaceAgent ? { ARCHE_WORKSPACE_AGENT_BIN: workspaceAgent } : {}),
  }
}

function getPackagedNodeBinaryPath(options) {
  const nodeBinary = resolveRuntimeBinaryPath('node', options)
  if (!nodeBinary) {
    throw new Error('Bundled Node.js runtime not found')
  }
  return nodeBinary
}

function getMissingPackagedRuntimeBinaries(options) {
  const runtimeResources = ['node', 'opencode', 'workspace-agent', 'opencode-config']
  return runtimeResources.filter((resourceName) => !resolveRuntimeResourcePath(resourceName, options))
}

module.exports = {
  getMissingPackagedRuntimeBinaries,
  getPackagedNodeBinaryPath,
  getRuntimeBinaryEnv,
  getRuntimeResourceCandidate,
  resolveRuntimeBinaryPath,
  resolveRuntimeConfigDirPath,
  resolveRuntimeResourcePath,
}

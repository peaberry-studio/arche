'use strict'

const fs = require('fs')
const { join } = require('path')

const ENV_VAR_BY_RESOURCE = {
  node: 'ARCHE_NODE_BIN',
  opencode: 'ARCHE_OPENCODE_BIN',
  'opencode-v1': 'ARCHE_OPENCODE_V1_BIN',
  'workspace-agent': 'ARCHE_WORKSPACE_AGENT_BIN',
  'arche-tools': 'ARCHE_TOOLS_DIR',
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
  if (binaryName === 'opencode' || binaryName === 'opencode-v1') {
    return `${binaryName}${extension}`
  }
  return `node${extension}`
}

function getRuntimeResourceCandidate(resourceName, options) {
  const baseDir = getBundledResourcesBaseDir(options)
  if (resourceName === 'arche-tools') {
    return join(baseDir, 'arche-tools')
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
  if (fs.existsSync(resourceName === 'arche-tools' ? join(bundledCandidate, 'server.js') : bundledCandidate)) {
    return bundledCandidate
  }

  return null
}

function resolveRuntimeBinaryPath(binaryName, options) {
  return resolveRuntimeResourcePath(binaryName, options)
}

function resolveRuntimeToolsDirPath(options) {
  return resolveRuntimeResourcePath('arche-tools', options)
}

function getRuntimeBinaryEnv(options) {
  const opencode = resolveRuntimeBinaryPath('opencode', options)
  const opencodeV1 = resolveRuntimeBinaryPath('opencode-v1', options)
  const node = resolveRuntimeBinaryPath('node', options)
  const archeToolsDir = resolveRuntimeToolsDirPath(options)
  const workspaceAgent = resolveRuntimeBinaryPath('workspace-agent', options)

  return {
    ...(opencode ? { ARCHE_OPENCODE_BIN: opencode } : {}),
    ...(opencodeV1 ? { ARCHE_OPENCODE_V1_BIN: opencodeV1 } : {}),
    ...(node ? { ARCHE_NODE_BIN: node } : {}),
    ...(archeToolsDir ? { ARCHE_TOOLS_DIR: archeToolsDir } : {}),
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
  const runtimeResources = ['node', 'opencode', 'opencode-v1', 'workspace-agent', 'arche-tools']
  return runtimeResources.filter((resourceName) => !resolveRuntimeResourcePath(resourceName, options))
}

module.exports = {
  getMissingPackagedRuntimeBinaries,
  getPackagedNodeBinaryPath,
  getRuntimeBinaryEnv,
  getRuntimeResourceCandidate,
  resolveRuntimeBinaryPath,
  resolveRuntimeToolsDirPath,
  resolveRuntimeResourcePath,
}

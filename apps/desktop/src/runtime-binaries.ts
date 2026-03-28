import { existsSync } from 'fs'
import { join } from 'path'

type RuntimeBinaryName = 'node' | 'opencode' | 'workspace-agent'
type RuntimeResourceName = RuntimeBinaryName | 'opencode-config'

type RuntimeBinaryOptions = {
  isPackaged: boolean
  resourcesPath?: string
  devBaseDir: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

const ENV_VAR_BY_RESOURCE: Record<RuntimeResourceName, string> = {
  node: 'ARCHE_NODE_BIN',
  opencode: 'ARCHE_OPENCODE_BIN',
  'workspace-agent': 'ARCHE_WORKSPACE_AGENT_BIN',
  'opencode-config': 'ARCHE_OPENCODE_CONFIG_DIR',
}

function getBundledResourcesBaseDir(options: RuntimeBinaryOptions): string {
  return options.isPackaged
    ? join(options.resourcesPath ?? '', 'bin')
    : join(options.devBaseDir, '..', 'bin')
}

function getBinaryFileName(binaryName: RuntimeBinaryName, platform: NodeJS.Platform): string {
  const extension = platform === 'win32' ? '.exe' : ''
  if (binaryName === 'workspace-agent') {
    return `workspace-agent${extension}`
  }
  if (binaryName === 'opencode') {
    return `opencode${extension}`
  }
  return `node${extension}`
}

function getBundledResourceCandidate(
  resourceName: RuntimeResourceName,
  options: RuntimeBinaryOptions,
): string {
  const baseDir = getBundledResourcesBaseDir(options)
  if (resourceName === 'opencode-config') {
    return join(baseDir, 'opencode-config')
  }

  return join(baseDir, getBinaryFileName(resourceName, options.platform ?? process.platform))
}

export function resolveRuntimeResourcePath(
  resourceName: RuntimeResourceName,
  options: RuntimeBinaryOptions,
): string | null {
  if (!options.isPackaged) {
    const envValue = options.env?.[ENV_VAR_BY_RESOURCE[resourceName]]
    if (envValue) {
      return envValue
    }
  }

  const bundledCandidate = getBundledResourceCandidate(resourceName, options)
  if (existsSync(bundledCandidate)) {
    return bundledCandidate
  }

  return null
}

export function resolveRuntimeBinaryPath(
  binaryName: RuntimeBinaryName,
  options: RuntimeBinaryOptions,
): string | null {
  return resolveRuntimeResourcePath(binaryName, options)
}

export function resolveRuntimeConfigDirPath(options: RuntimeBinaryOptions): string | null {
  return resolveRuntimeResourcePath('opencode-config', options)
}

export function getRuntimeBinaryEnv(options: RuntimeBinaryOptions): Partial<NodeJS.ProcessEnv> {
  const opencode = resolveRuntimeBinaryPath('opencode', options)
  const opencodeConfigDir = resolveRuntimeConfigDirPath(options)
  const workspaceAgent = resolveRuntimeBinaryPath('workspace-agent', options)

  return {
    ...(opencode ? { ARCHE_OPENCODE_BIN: opencode } : {}),
    ...(opencodeConfigDir ? { ARCHE_OPENCODE_CONFIG_DIR: opencodeConfigDir } : {}),
    ...(workspaceAgent ? { ARCHE_WORKSPACE_AGENT_BIN: workspaceAgent } : {}),
  }
}

export function getPackagedNodeBinaryPath(options: RuntimeBinaryOptions): string {
  const nodeBinary = resolveRuntimeBinaryPath('node', options)
  if (!nodeBinary) {
    throw new Error('Bundled Node.js runtime not found')
  }
  return nodeBinary
}

export function getMissingPackagedRuntimeBinaries(options: RuntimeBinaryOptions): RuntimeResourceName[] {
  const runtimeResources: RuntimeResourceName[] = ['node', 'opencode', 'workspace-agent', 'opencode-config']
  return runtimeResources.filter((resourceName) => !resolveRuntimeResourcePath(resourceName, options))
}

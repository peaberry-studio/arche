import { existsSync } from 'fs'
import { join } from 'path'

type RuntimeBinaryName = 'node' | 'opencode' | 'workspace-agent'

type RuntimeBinaryOptions = {
  isPackaged: boolean
  resourcesPath?: string
  devBaseDir: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

const ENV_VAR_BY_BINARY: Record<RuntimeBinaryName, string> = {
  node: 'ARCHE_NODE_BIN',
  opencode: 'ARCHE_OPENCODE_BIN',
  'workspace-agent': 'ARCHE_WORKSPACE_AGENT_BIN',
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

function getBundledBinaryCandidate(binaryName: RuntimeBinaryName, options: RuntimeBinaryOptions): string {
  const baseDir = options.isPackaged
    ? join(options.resourcesPath ?? '', 'bin')
    : join(options.devBaseDir, '..', 'bin')

  return join(baseDir, getBinaryFileName(binaryName, options.platform ?? process.platform))
}

export function resolveRuntimeBinaryPath(
  binaryName: RuntimeBinaryName,
  options: RuntimeBinaryOptions,
): string | null {
  if (!options.isPackaged) {
    const envValue = options.env?.[ENV_VAR_BY_BINARY[binaryName]]
    if (envValue) {
      return envValue
    }
  }

  const bundledCandidate = getBundledBinaryCandidate(binaryName, options)
  if (existsSync(bundledCandidate)) {
    return bundledCandidate
  }

  return null
}

export function getRuntimeBinaryEnv(options: RuntimeBinaryOptions): Partial<NodeJS.ProcessEnv> {
  const opencode = resolveRuntimeBinaryPath('opencode', options)
  const workspaceAgent = resolveRuntimeBinaryPath('workspace-agent', options)

  return {
    ...(opencode ? { ARCHE_OPENCODE_BIN: opencode } : {}),
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

export function getMissingPackagedRuntimeBinaries(options: RuntimeBinaryOptions): RuntimeBinaryName[] {
  const runtimeBinaries: RuntimeBinaryName[] = ['node', 'opencode', 'workspace-agent']
  return runtimeBinaries.filter((binaryName) => !resolveRuntimeBinaryPath(binaryName, options))
}

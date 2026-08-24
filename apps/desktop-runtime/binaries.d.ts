export type RuntimeBinaryName = 'node' | 'opencode' | 'workspace-agent'
export type RuntimeResourceName = RuntimeBinaryName | 'opencode-config'

export type RuntimeBinaryOptions = {
  isPackaged: boolean
  resourcesPath?: string
  devBaseDir: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

export declare function getRuntimeResourceCandidate(
  resourceName: RuntimeResourceName,
  options: RuntimeBinaryOptions,
): string
export declare function resolveRuntimeResourcePath(
  resourceName: RuntimeResourceName,
  options: RuntimeBinaryOptions,
): string | null
export declare function resolveRuntimeBinaryPath(
  binaryName: RuntimeBinaryName,
  options: RuntimeBinaryOptions,
): string | null
export declare function resolveRuntimeConfigDirPath(options: RuntimeBinaryOptions): string | null
export declare function getRuntimeBinaryEnv(options: RuntimeBinaryOptions): Partial<NodeJS.ProcessEnv>
export declare function getPackagedNodeBinaryPath(options: RuntimeBinaryOptions): string
export declare function getMissingPackagedRuntimeBinaries(options: RuntimeBinaryOptions): RuntimeResourceName[]

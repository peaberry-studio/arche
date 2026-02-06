import Docker from 'dockerode'
import { getContainerSocketPath, getContainerProxyUrl, getOpencodeImage, getOpencodeNetwork, getKbHostPath, getWorkspaceAgentPort } from './config'
import { getUserDataHostPath, ensureUserDirectory } from '@/lib/user-data'

function getContainerClient(): Docker {
  const socketPath = getContainerSocketPath()
  if (socketPath) {
    return new Docker({ socketPath })
  }
  const url = new URL(getContainerProxyUrl())
  return new Docker({
    host: url.hostname,
    port: parseInt(url.port),
  })
}

export async function createContainer(slug: string, password: string, opencodeConfigContent?: string) {
  const docker = getContainerClient()
  const containerName = `opencode-${slug}`
  const volumeName = `arche-workspace-${slug}`

  // Configure provider base URLs to route through Arche's internal gateway.
  // Auth is still managed at runtime via the OpenCode /auth endpoints.
  const providerGatewayConfig = {
    provider: {
      openai: { options: { baseURL: 'http://web:3000/api/internal/providers/openai' } },
      anthropic: { options: { baseURL: 'http://web:3000/api/internal/providers/anthropic' } },
      openrouter: { options: { baseURL: 'http://web:3000/api/internal/providers/openrouter' } },
    },
  }

  // Merge passed-in config (e.g. MCP) with provider gateway config
  const mergedConfigContent = JSON.stringify(
    opencodeConfigContent
      ? { ...JSON.parse(opencodeConfigContent), ...providerGatewayConfig }
      : providerGatewayConfig
  )

  // Ensure volume exists for persistent workspace
  try {
    await docker.createVolume({ Name: volumeName })
  } catch {
    // Volume might already exist, ignore error
  }

  // Build binds array: always mount workspace, optionally mount KB and user data
  const binds = [`${volumeName}:/workspace`]
  const kbHostPath = getKbHostPath()
  if (kbHostPath) {
    // Mount KB repo so workspaces can pull/push via git
    binds.push(`${kbHostPath}:/kb`)
  }

  // Mount user data directory
  const userDataPath = getUserDataHostPath(slug)
  await ensureUserDirectory(slug)
  binds.push(`${userDataPath}:/user-data`)

  const env = [
    `OPENCODE_SERVER_PASSWORD=${password}`,
    `OPENCODE_SERVER_USERNAME=opencode`,
    `WORKSPACE_AGENT_PORT=${getWorkspaceAgentPort()}`,
  ]

  env.push(`OPENCODE_CONFIG_CONTENT=${mergedConfigContent}`)

  return docker.createContainer({
    Image: getOpencodeImage(),
    name: containerName,
    WorkingDir: '/workspace',
    // La imagen arche-workspace tiene entrypoint wrapper que inicializa el workspace
    Cmd: ['serve', '--hostname', '0.0.0.0', '--port', '4096'],
    Env: env,
    HostConfig: {
      NetworkMode: getOpencodeNetwork(),
      RestartPolicy: { Name: 'unless-stopped' },
      Binds: binds,
    },
    Labels: {
      'arche.managed': 'true',
      'arche.user.slug': slug,
    },
  })
}

export async function startContainer(containerId: string): Promise<void> {
  const docker = getContainerClient()
  const container = docker.getContainer(containerId)
  await container.start()
}

export async function stopContainer(containerId: string): Promise<void> {
  const docker = getContainerClient()
  const container = docker.getContainer(containerId)
  await container.stop({ t: 10 })
}

export async function removeContainer(containerId: string): Promise<void> {
  const docker = getContainerClient()
  const container = docker.getContainer(containerId)
  await container.remove({ force: true })
}

export async function inspectContainer(containerId: string) {
  const docker = getContainerClient()
  const container = docker.getContainer(containerId)
  return container.inspect()
}

export async function isContainerRunning(containerId: string): Promise<boolean> {
  try {
    const info = await inspectContainer(containerId)
    return info.State.Running
  } catch {
    return false
  }
}

/**
 * Check if OpenCode inside the container is healthy and responding.
 * This verifies the actual service, not just the container state.
 */
export async function isOpencodeHealthy(containerId: string): Promise<boolean> {
  try {
    const result = await execInContainer(containerId, [
      'wget', '-q', '-O', '-', '--timeout=2', 'http://localhost:4096/global/health'
    ], { timeout: 5000 })

    if (result.exitCode !== 0) return false

    // Parse the health response
    const data = JSON.parse(result.stdout)
    return data.healthy === true
  } catch {
    return false
  }
}

export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Execute a command inside a running container.
 * Returns stdout, stderr, and exit code.
 */
export async function execInContainer(
  containerId: string,
  cmd: string[],
  options: { workingDir?: string; timeout?: number } = {}
): Promise<ExecResult> {
  const docker = getContainerClient()
  const container = docker.getContainer(containerId)

  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: options.workingDir || '/workspace',
  })

  return new Promise((resolve, reject) => {
    const timeout = options.timeout || 30000

    const timer = setTimeout(() => {
      reject(new Error(`Exec timed out after ${timeout}ms`))
    }, timeout)

    exec.start({ hijack: true, stdin: false }, (err, stream) => {
      if (err) {
        clearTimeout(timer)
        return reject(err)
      }

      if (!stream) {
        clearTimeout(timer)
        return reject(new Error('No stream returned from exec'))
      }

      let stdout = ''
      let stderr = ''

      // Docker multiplexes stdout/stderr in a single stream with headers.
      // Chunks may split frames, so we must buffer across 'data' events.
      // Format: [type (1 byte)][0][0][0][size (4 bytes big-endian)][payload]
      // type: 1 = stdout, 2 = stderr
      let pending: Buffer = Buffer.alloc(0)
      stream.on('data', (chunk: Buffer) => {
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk

        while (pending.length >= 8) {
          const type = pending[0]
          const size = pending.readUInt32BE(4)
          const frameSize = 8 + size

          if (pending.length < frameSize) break

          const payload = pending.subarray(8, frameSize).toString('utf8')
          if (type === 1) stdout += payload
          else if (type === 2) stderr += payload

          pending = pending.subarray(frameSize)
        }
      })

      stream.on('end', async () => {
        clearTimeout(timer)
        try {
          const inspectData = await exec.inspect()
          resolve({
            exitCode: inspectData.ExitCode ?? 0,
            stdout,
            stderr,
          })
        } catch {
          // If we can't inspect, assume success if we got output
          resolve({ exitCode: 0, stdout, stderr })
        }
      })

      stream.on('error', (streamErr: Error) => {
        clearTimeout(timer)
        reject(streamErr)
      })
    })
  })
}

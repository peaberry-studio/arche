import Docker from 'dockerode'
import { getContainerSocketPath, getContainerProxyUrl, getOpencodeImage, getOpencodeNetwork, getKbHostPath } from './config'

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

export async function createContainer(slug: string, password: string) {
  const docker = getContainerClient()
  const containerName = `opencode-${slug}`
  const volumeName = `arche-workspace-${slug}`

  // Ensure volume exists for persistent workspace
  try {
    await docker.createVolume({ Name: volumeName })
  } catch {
    // Volume might already exist, ignore error
  }

  // Build binds array: always mount workspace, optionally mount KB
  const binds = [`${volumeName}:/workspace`]
  const kbHostPath = getKbHostPath()
  if (kbHostPath) {
    // Mount KB as read-only so init script can copy from it
    binds.push(`${kbHostPath}:/kb:ro`)
  }

  return docker.createContainer({
    Image: getOpencodeImage(),
    name: containerName,
    WorkingDir: '/workspace',
    // La imagen arche-workspace tiene entrypoint wrapper que inicializa el workspace
    Cmd: ['serve', '--hostname', '0.0.0.0', '--port', '4096'],
    Env: [
      `OPENCODE_SERVER_PASSWORD=${password}`,
      `OPENCODE_SERVER_USERNAME=opencode`,
    ],
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

      // Container runtime multiplexes stdout/stderr in a single stream with headers
      // Format: [type (1 byte)][0][0][0][size (4 bytes big-endian)][payload]
      // type: 1 = stdout, 2 = stderr
      stream.on('data', (chunk: Buffer) => {
        let offset = 0
        while (offset < chunk.length) {
          if (offset + 8 > chunk.length) break

          const type = chunk[offset]
          const size = chunk.readUInt32BE(offset + 4)

          if (offset + 8 + size > chunk.length) break

          const payload = chunk.slice(offset + 8, offset + 8 + size).toString('utf8')

          if (type === 1) {
            stdout += payload
          } else if (type === 2) {
            stderr += payload
          }

          offset += 8 + size
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

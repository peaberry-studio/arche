import Docker from 'dockerode'
import { getDockerSocketPath, getDockerProxyUrl, getOpencodeImage, getOpencodeNetwork } from './config'

function getDockerClient(): Docker {
  const socketPath = getDockerSocketPath()
  if (socketPath) {
    return new Docker({ socketPath })
  }
  const url = new URL(getDockerProxyUrl())
  return new Docker({
    host: url.hostname,
    port: parseInt(url.port),
  })
}

export async function createContainer(slug: string, password: string) {
  const docker = getDockerClient()
  const containerName = `opencode-${slug}`

  return docker.createContainer({
    Image: getOpencodeImage(),
    name: containerName,
    Cmd: ['opencode', 'serve', '--hostname', '0.0.0.0', '--port', '4096'],
    Env: [
      `OPENCODE_SERVER_PASSWORD=${password}`,
      `OPENCODE_SERVER_USERNAME=opencode`,
    ],
    HostConfig: {
      NetworkMode: getOpencodeNetwork(),
      RestartPolicy: { Name: 'unless-stopped' },
    },
    Labels: {
      'arche.managed': 'true',
      'arche.user.slug': slug,
    },
  })
}

export async function startContainer(containerId: string): Promise<void> {
  const docker = getDockerClient()
  const container = docker.getContainer(containerId)
  await container.start()
}

export async function stopContainer(containerId: string): Promise<void> {
  const docker = getDockerClient()
  const container = docker.getContainer(containerId)
  await container.stop({ t: 10 })
}

export async function removeContainer(containerId: string): Promise<void> {
  const docker = getDockerClient()
  const container = docker.getContainer(containerId)
  await container.remove({ force: true })
}

export async function inspectContainer(containerId: string) {
  const docker = getDockerClient()
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

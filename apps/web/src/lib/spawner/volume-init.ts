import type Docker from 'dockerode'

const VOLUME_INIT_TIMEOUT_MS = 120_000

export async function prepareWorkspaceVolumes(docker: Docker, slug: string, image: string, volumes: string[]): Promise<void> {
  const running = await docker.listContainers()
  if (running.some((container) => container.Mounts.some((mount) => mount.Name && volumes.includes(mount.Name)))) {
    throw new Error('workspace_volume_in_use')
  }

  const name = `arche-volume-init-${slug}`
  const previous = docker.getContainer(name)
  try {
    const info = await previous.inspect()
    if (info.State.Running || info.Config.Labels?.['arche.volume-init'] !== slug) {
      throw new Error('workspace_volume_init_conflict')
    }
    await previous.remove()
  } catch (error) {
    if (!error || typeof error !== 'object' || !('statusCode' in error) || error.statusCode !== 404) throw error
  }

  const helper = await docker.createContainer({
    name,
    Image: image,
    User: '0:0',
    WorkingDir: '/',
    Entrypoint: ['/usr/local/bin/prepare-workspace-volumes'],
    Cmd: [],
    Env: [],
    Labels: { 'arche.volume-init': slug },
    HostConfig: {
      NetworkMode: 'none',
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      CapAdd: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER'],
      SecurityOpt: ['no-new-privileges'],
      PidsLimit: 32,
      Memory: 128 * 1024 * 1024,
      MemorySwap: 128 * 1024 * 1024,
      NanoCpus: 1_000_000_000,
      Binds: volumes.map((volume, index) => `${volume}:/volumes/${index}`),
    },
  })
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await helper.start()
    const result: { StatusCode: number } = await Promise.race([
      helper.wait(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('workspace_volume_init_timeout')), VOLUME_INIT_TIMEOUT_MS)
      }),
    ])
    if (result.StatusCode !== 0) throw new Error('workspace_volume_init_failed')
  } finally {
    clearTimeout(timeout)
    await helper.remove({ force: true })
  }
}

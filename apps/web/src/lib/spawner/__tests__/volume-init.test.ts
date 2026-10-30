import Docker from 'dockerode'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { prepareWorkspaceVolumes } from '@/lib/spawner/volume-init'

describe('workspace volume ownership migration', () => {
  const docker = new Docker()
  const helper = docker.getContainer('helper')
  const previous = docker.getContainer('previous')
  const volumes = ['work', 'share', 'state']

  beforeEach(() => {
    vi.spyOn(docker, 'listContainers').mockResolvedValue([])
    vi.spyOn(docker, 'getContainer').mockReturnValue(previous)
    vi.spyOn(previous, 'inspect').mockRejectedValue({ statusCode: 404 })
    vi.spyOn(previous, 'remove').mockResolvedValue(undefined)
    vi.spyOn(docker, 'createContainer').mockResolvedValue(helper)
    vi.spyOn(helper, 'start').mockResolvedValue(undefined)
    vi.spyOn(helper, 'wait').mockResolvedValue({ StatusCode: 0 })
    vi.spyOn(helper, 'remove').mockResolvedValue(undefined)
  })

  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

  it('uses only the requested volumes with no network or credentials and removes the helper', async () => {
    await prepareWorkspaceVolumes(docker, 'alice', 'workspace:image', volumes)
    const options = vi.mocked(docker.createContainer).mock.calls[0][0]
    expect(options).toMatchObject({
      Image: 'workspace:image', User: '0:0', Env: [],
      Entrypoint: ['/usr/local/bin/prepare-workspace-volumes'],
      HostConfig: {
        NetworkMode: 'none', ReadonlyRootfs: true, CapDrop: ['ALL'],
        CapAdd: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER'], SecurityOpt: ['no-new-privileges'],
        Binds: ['work:/volumes/0', 'share:/volumes/1', 'state:/volumes/2'],
      },
    })
    expect(helper.remove).toHaveBeenCalledWith({ force: true })
  })

  it('refuses to change ownership while another process has a volume mounted', async () => {
    const container = { Id: 'running', Mounts: [{ Name: 'work' }] }
    vi.mocked(docker.listContainers).mockResolvedValue([container as Docker.ContainerInfo])
    await expect(prepareWorkspaceVolumes(docker, 'alice', 'image', volumes)).rejects.toThrow('workspace_volume_in_use')
    expect(docker.createContainer).not.toHaveBeenCalled()
  })

  it('fails closed when container inventory is unavailable', async () => {
    vi.mocked(docker.listContainers).mockRejectedValue(new Error('unavailable'))
    await expect(prepareWorkspaceVolumes(docker, 'alice', 'image', volumes)).rejects.toThrow('unavailable')
    expect(docker.createContainer).not.toHaveBeenCalled()
  })

  it('does not launch a workspace after a failed migration', async () => {
    vi.mocked(helper.wait).mockResolvedValue({ StatusCode: 1 })
    await expect(prepareWorkspaceVolumes(docker, 'alice', 'image', volumes)).rejects.toThrow('workspace_volume_init_failed')
    expect(helper.remove).toHaveBeenCalledWith({ force: true })
  })

  it('kills a migration that exceeds its deadline', async () => {
    vi.useFakeTimers()
    vi.mocked(helper.wait).mockReturnValue(new Promise(() => {}))
    const result = expect(prepareWorkspaceVolumes(docker, 'alice', 'image', volumes)).rejects.toThrow('workspace_volume_init_timeout')
    await vi.advanceTimersByTimeAsync(120_000)
    await result
    expect(helper.remove).toHaveBeenCalledWith({ force: true })
  })
})

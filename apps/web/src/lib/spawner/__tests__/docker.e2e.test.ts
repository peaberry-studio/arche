/**
 * E2E test for container runtime integration.
 *
 * Requires:
 * - Podman running locally
 * - CONTAINER_SOCKET_PATH env var pointing to the socket
 * - Network `arche-internal` created
 * - Image `ghcr.io/anomalyco/opencode:1.1.45` pulled
 *
 * Run: CONTAINER_SOCKET_PATH=/path/to/podman.sock pnpm test -- --testPathPattern e2e
 */
import { describe, it, expect, afterAll } from 'vitest'
import Docker from 'dockerode'
import {
  createContainer,
  startContainer,
  stopContainer,
  removeContainer,
  isContainerRunning,
  inspectContainer,
} from '../docker'

const SOCKET_PATH = process.env.CONTAINER_SOCKET_PATH
const TEST_SLUG = `e2e-test-${Date.now()}`

describe.runIf(!!SOCKET_PATH)('docker e2e', () => {
  let containerId: string | null = null

  afterAll(async () => {
    // Cleanup: remove test container if it exists
    if (containerId) {
      try {
        await stopContainer(containerId).catch(() => {})
        await removeContainer(containerId).catch(() => {})
      } catch {
        // best-effort cleanup
      }
    }
  })

  it('connects to the Docker/Podman daemon', async () => {
    const docker = new Docker({ socketPath: SOCKET_PATH })
    const info = await docker.info()
    expect(info).toBeDefined()
    expect(info.ID).toBeDefined()
  })

  it('creates and starts a container', async () => {
    const configContent = '{"$schema":"https://opencode.ai/config.json","mcp":{}}'
    const container = await createContainer(TEST_SLUG, 'test-password-123', configContent)
    containerId = container.id
    expect(containerId).toBeTruthy()

    await startContainer(containerId)

    // Give it a moment to start
    await new Promise(r => setTimeout(r, 2000))

    const running = await isContainerRunning(containerId)
    expect(running).toBe(true)
  })

  it('inspects the running container', async () => {
    expect(containerId).toBeTruthy()
    const info = await inspectContainer(containerId!)
    expect(info.State.Running).toBe(true)
    expect(info.Name).toBe(`/opencode-${TEST_SLUG}`)
  })

  it('stops the container', async () => {
    expect(containerId).toBeTruthy()
    await stopContainer(containerId!)

    await new Promise(r => setTimeout(r, 1000))

    const running = await isContainerRunning(containerId!)
    expect(running).toBe(false)
  })

  it('removes the container', async () => {
    expect(containerId).toBeTruthy()
    await removeContainer(containerId!)

    const running = await isContainerRunning(containerId!)
    expect(running).toBe(false)

    containerId = null // prevent afterAll cleanup
  })
})

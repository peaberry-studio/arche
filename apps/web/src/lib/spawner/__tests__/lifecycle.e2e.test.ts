/**
 * E2E lifecycle test: start → running → idle → reaped
 *
 * Requires:
 * - Podman running with CONTAINER_SOCKET_PATH set
 * - PostgreSQL running with DATABASE_URL set
 * - Network `arche-internal` created
 * - Image pulled
 *
 * Run:
 *   CONTAINER_SOCKET_PATH=... DATABASE_URL=... pnpm test -- src/lib/spawner/__tests__/lifecycle.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const SOCKET_PATH = process.env.CONTAINER_SOCKET_PATH
const DATABASE_URL = process.env.DATABASE_URL
const SKIP = !SOCKET_PATH || !DATABASE_URL

const TEST_SLUG = `e2e-lifecycle-${Date.now()}`
const TEST_USER_ID = 'e2e-test-user'

// All modules are dynamically imported to avoid failures when env vars are not set
type CoreModule = typeof import('../core')
type ReaperModule = typeof import('../reaper')
type DockerModule = typeof import('../docker')
type PrismaModule = typeof import('@/lib/prisma')

let core: CoreModule
let reaper: ReaperModule
let docker: DockerModule
let prismaModule: PrismaModule

describe.runIf(!SKIP)('spawner lifecycle e2e', () => {
  beforeAll(async () => {
    // Dynamic imports to avoid module load failures
    ;[core, reaper, docker, prismaModule] = await Promise.all([
      import('../core'),
      import('../reaper'),
      import('../docker'),
      import('@/lib/prisma'),
    ])

    // Create a test user for the instance relation
    await prismaModule.prisma.user.upsert({
      where: { slug: TEST_SLUG },
      create: {
        email: `${TEST_SLUG}@test.local`,
        slug: TEST_SLUG,
        passwordHash: 'not-a-real-hash',
      },
      update: {},
    })
  })

  afterAll(async () => {
    // Cleanup: remove instance and container if they exist
    const instance = await prismaModule.prisma.instance.findUnique({ where: { slug: TEST_SLUG } })
    if (instance?.containerId) {
      await docker.removeContainer(instance.containerId).catch(() => {})
    }
    await prismaModule.prisma.instance.deleteMany({ where: { slug: TEST_SLUG } })
    await prismaModule.prisma.user.deleteMany({ where: { slug: TEST_SLUG } })
  })

  it('starts an instance and creates a real container', async () => {
    const result = await core.startInstance(TEST_SLUG, TEST_USER_ID)

    expect(result).toEqual({ ok: true, status: 'running' })

    const status = await core.getInstanceStatus(TEST_SLUG)
    expect(status?.status).toBe('running')
    expect(status?.lastActivityAt).toBeTruthy()
  })

  it('returns already_running when trying to start again', async () => {
    const result = await core.startInstance(TEST_SLUG, TEST_USER_ID)

    expect(result).toEqual({ ok: false, error: 'already_running' })
  })

  it('does not reap an active instance', async () => {
    // lastActivityAt was just set, so it should not be reaped
    const reaped = await reaper.reapIdleInstances()
    expect(reaped).toBe(0)

    const status = await core.getInstanceStatus(TEST_SLUG)
    expect(status?.status).toBe('running')
  })

  it('reaps an idle instance', async () => {
    // Simulate idle by setting lastActivityAt far in the past
    await prismaModule.prisma.instance.update({
      where: { slug: TEST_SLUG },
      data: { lastActivityAt: new Date(Date.now() - 60 * 60 * 1000) }, // 1h ago
    })

    const reaped = await reaper.reapIdleInstances()
    expect(reaped).toBe(1)

    const status = await core.getInstanceStatus(TEST_SLUG)
    expect(status?.status).toBe('stopped')
    expect(status?.stoppedAt).toBeTruthy()
  })

  it('can restart after being reaped', async () => {
    const result = await core.startInstance(TEST_SLUG, TEST_USER_ID)

    expect(result).toEqual({ ok: true, status: 'running' })
  })

  it('stops an instance cleanly', async () => {
    const result = await core.stopInstance(TEST_SLUG, TEST_USER_ID)

    expect(result).toEqual({ ok: true, status: 'stopped' })

    const status = await core.getInstanceStatus(TEST_SLUG)
    expect(status?.status).toBe('stopped')
  })
})

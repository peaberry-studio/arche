import { prisma } from '@/lib/prisma'
import { auditEvent } from '@/lib/auth'
import { isInstanceHealthyWithPassword } from '@/lib/opencode/client'
import * as docker from './docker'
import { decryptPassword, generatePassword, encryptPassword } from './crypto'
import { getStartExpectedMs, getStartTimeoutMs } from './config'

export type StartResult =
  | { ok: true; status: 'running' }
  | { ok: false; error: 'already_running' | 'start_failed' | 'timeout'; detail?: string }

export type StopResult =
  | { ok: true; status: 'stopped' }
  | { ok: false; error: 'not_running' | 'stop_failed' }

function getErrorDetail(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const error = err as {
    json?: { message?: string }
    message?: string
    reason?: string
  }

  return error.json?.message ?? error.message ?? error.reason
}

export async function startInstance(slug: string, userId: string): Promise<StartResult> {
  const existing = await prisma.instance.findUnique({ where: { slug } })

  if (existing?.status === 'running') {
    return { ok: false, error: 'already_running' }
  }

  const password = generatePassword()
  const encryptedPassword = encryptPassword(password)

  await prisma.instance.upsert({
    where: { slug },
    create: {
      slug,
      status: 'starting',
      serverPassword: encryptedPassword,
      startedAt: new Date(),
    },
    update: {
      status: 'starting',
      serverPassword: encryptedPassword,
      startedAt: new Date(),
      stoppedAt: null,
      containerId: null,
    },
  })

  let containerId: string | null = null

  try {
    const container = await docker.createContainer(slug, password)
    containerId = container.id
    await docker.startContainer(container.id)

    await prisma.instance.update({
      where: { slug },
      data: { containerId: container.id },
    })

    const healthy = await waitForHealthy(container.id, slug, password)

    if (!healthy) {
      await docker.stopContainer(container.id).catch(() => {})
      await docker.removeContainer(container.id).catch(() => {})
      containerId = null
      await prisma.instance.update({
        where: { slug },
        data: { status: 'error', containerId: null },
      })
      return { ok: false, error: 'timeout', detail: 'healthcheck timeout' }
    }

    await prisma.instance.update({
      where: { slug },
      data: { status: 'running', lastActivityAt: new Date() },
    })

    await auditEvent({
      actorUserId: userId,
      action: 'instance.started',
      metadata: { slug },
    })

    return { ok: true, status: 'running' }
  } catch (err) {
    const detail = getErrorDetail(err)
    if (detail) {
      console.error('[spawner] startInstance failed:', detail)
    } else {
      console.error('[spawner] startInstance failed: unknown error')
    }

    // Clean up container if it was created to avoid orphans and name conflicts
    if (containerId) {
      await docker.stopContainer(containerId).catch(() => {})
      await docker.removeContainer(containerId).catch(() => {})
    }

    await prisma.instance.update({
      where: { slug },
      data: { status: 'error', containerId: null },
    }).catch(() => {})

    return { ok: false, error: 'start_failed', detail }
  }
}

export async function stopInstance(slug: string, userId: string): Promise<StopResult> {
  const instance = await prisma.instance.findUnique({ where: { slug } })

  if (!instance || instance.status === 'stopped') {
    return { ok: false, error: 'not_running' }
  }

  try {
    if (instance.containerId) {
      await docker.stopContainer(instance.containerId).catch(() => {})
      await docker.removeContainer(instance.containerId).catch(() => {})
    }

    await prisma.instance.update({
      where: { slug },
      data: {
        status: 'stopped',
        stoppedAt: new Date(),
        containerId: null,
      },
    })

    await auditEvent({
      actorUserId: userId,
      action: 'instance.stopped',
      metadata: { slug },
    })

    return { ok: true, status: 'stopped' }
  } catch {
    return { ok: false, error: 'stop_failed' }
  }
}

export async function getInstanceStatus(slug: string) {
  const instance = await prisma.instance.findUnique({
    where: { slug },
    select: {
      status: true,
      startedAt: true,
      stoppedAt: true,
      lastActivityAt: true,
      containerId: true,
    },
  })

  if (!instance) return null

  // Si la DB dice running/starting pero no hay containerId, está desincronizado
  if ((instance.status === 'running' || instance.status === 'starting') && !instance.containerId) {
    await prisma.instance.update({
      where: { slug },
      data: { status: 'stopped', stoppedAt: new Date() },
    })
    return { ...instance, status: 'stopped' as const, containerId: null }
  }

  // Si hay containerId, verificar que el contenedor realmente existe y está corriendo
  if (instance.containerId && (instance.status === 'running' || instance.status === 'starting')) {
    const isRunning = await docker.isContainerRunning(instance.containerId)

    if (!isRunning) {
      // El contenedor no existe o no está corriendo - sincronizar DB
      // Intentar limpiar el contenedor si existe
      await docker.removeContainer(instance.containerId).catch(() => {})

      await prisma.instance.update({
        where: { slug },
        data: { status: 'stopped', stoppedAt: new Date(), containerId: null },
      })
      return { ...instance, status: 'stopped' as const, containerId: null }
    }

    // Verificar que OpenCode realmente responde
    try {
      const password = decryptPassword(instance.serverPassword)
      const isHealthy = await isInstanceHealthyWithPassword(slug, password)

      if (isHealthy) {
        if (instance.status !== 'running') {
          await prisma.instance.update({
            where: { slug },
            data: { status: 'running', lastActivityAt: new Date() },
          })
        }
        return { ...instance, status: 'running' as const }
      }

      if (instance.status === 'running') {
        // El contenedor está running pero OpenCode no responde - marcar como starting
        // para que el frontend espere y reintente
        return { ...instance, status: 'starting' as const }
      }
    } catch (err) {
      console.error('[spawner] Failed to decrypt instance password', err)
    }
  }

  return instance
}

export async function listActiveInstances() {
  return prisma.instance.findMany({
    where: {
      status: { in: ['running', 'starting'] },
    },
    select: {
      slug: true,
      status: true,
      startedAt: true,
      lastActivityAt: true,
    },
    orderBy: { startedAt: 'desc' },
  })
}

export function isSlowStart(instance: { status: string; startedAt: Date | null } | null): boolean {
  if (!instance || instance.status !== 'starting' || !instance.startedAt) {
    return false
  }
  const elapsed = Date.now() - instance.startedAt.getTime()
  return elapsed > getStartExpectedMs()
}

async function waitForHealthy(containerId: string, slug: string, password: string): Promise<boolean> {
  const timeout = getStartTimeoutMs()
  const start = Date.now()

  while (Date.now() - start < timeout) {
    // First check if container is running
    const running = await docker.isContainerRunning(containerId)
    if (!running) {
      await new Promise(r => setTimeout(r, 1000))
      continue
    }

    // Then verify OpenCode is actually responding
    const healthy = await isInstanceHealthyWithPassword(slug, password)
    if (healthy) return true

    await new Promise(r => setTimeout(r, 1000))
  }

  return false
}

import type { InstanceStatus } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { getRuntimeCapabilities } from '@/lib/runtime/capabilities'

// ---------------------------------------------------------------------------
// Query return shapes (only expose what consumers actually need)
// ---------------------------------------------------------------------------

export type InstanceRecord = {
  id: string
  slug: string
  status: InstanceStatus
  createdAt: Date
  startedAt: Date | null
  stoppedAt: Date | null
  lastActivityAt: Date | null
  containerId: string | null
  serverPassword: string
  appliedConfigSha: string | null
  providerSyncHash: string | null
  providerSyncedAt: Date | null
}

export type InstanceCredentials = {
  serverPassword: string
  status: InstanceStatus
}

export type InstanceStatusDetails = {
  status: InstanceStatus
  startedAt: Date | null
  stoppedAt: Date | null
  lastActivityAt: Date | null
  containerId: string | null
  serverPassword: string
  providerSyncHash: string | null
  providerSyncedAt: Date | null
}

export type InstanceProviderSyncDetails = {
  providerSyncHash: string | null
  providerSyncedAt: Date | null
  status: InstanceStatus
}

export type InstanceActiveEntry = {
  slug: string
  status: InstanceStatus
  startedAt: Date | null
  lastActivityAt: Date | null
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function findBySlug(slug: string): Promise<InstanceRecord | null> {
  return prisma.instance.findUnique({ where: { slug } })
}

export function findCredentialsBySlug(slug: string): Promise<InstanceCredentials | null> {
  return prisma.instance.findUnique({
    where: { slug },
    select: { serverPassword: true, status: true },
  })
}

export function findStatusBySlug(slug: string): Promise<InstanceStatusDetails | null> {
  return prisma.instance.findUnique({
    where: { slug },
    select: {
      status: true,
      startedAt: true,
      stoppedAt: true,
      lastActivityAt: true,
      containerId: true,
      serverPassword: true,
      providerSyncHash: true,
      providerSyncedAt: true,
    },
  })
}

export function findProviderSyncBySlug(slug: string): Promise<InstanceProviderSyncDetails | null> {
  return prisma.instance.findUnique({
    where: { slug },
    select: {
      providerSyncHash: true,
      providerSyncedAt: true,
      status: true,
    },
  })
}

export function findContainerStatusBySlug(slug: string): Promise<{ containerId: string | null; status: InstanceStatus } | null> {
  return prisma.instance.findUnique({
    where: { slug },
    select: { containerId: true, status: true },
  })
}

export async function findReachableBySlug(slug: string): Promise<{ containerId: string | null; status: InstanceStatus; reachable: boolean } | null> {
  const instance = await findContainerStatusBySlug(slug)
  if (!instance) return null

  const caps = getRuntimeCapabilities()
  const reachable = instance.status === 'running' && (!caps.containers || !!instance.containerId)

  return { ...instance, reachable }
}

export function findAppliedConfigShaBySlug(slug: string): Promise<{ appliedConfigSha: string | null } | null> {
  return prisma.instance.findUnique({
    where: { slug },
    select: { appliedConfigSha: true },
  })
}

export function findServerPasswordBySlug(slug: string): Promise<{ serverPassword: string } | null> {
  return prisma.instance.findUnique({
    where: { slug },
    select: { serverPassword: true },
  })
}

export function findActiveInstances(): Promise<InstanceActiveEntry[]> {
  return prisma.instance.findMany({
    where: { status: { in: ['running', 'starting'] } },
    select: {
      slug: true,
      status: true,
      startedAt: true,
      lastActivityAt: true,
    },
    orderBy: { startedAt: 'desc' },
  })
}

export function findIdleInstances(threshold: Date): Promise<InstanceRecord[]> {
  return prisma.instance.findMany({
    where: {
      status: 'running',
      lastActivityAt: { lt: threshold },
    },
  })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function upsertStarting(slug: string, serverPassword: string) {
  return prisma.instance.upsert({
    where: { slug },
    create: {
      slug,
      status: 'starting',
      serverPassword,
      startedAt: new Date(),
      providerSyncHash: null,
      providerSyncedAt: null,
    },
    update: {
      status: 'starting',
      serverPassword,
      startedAt: new Date(),
      stoppedAt: null,
      containerId: null,
      providerSyncHash: null,
      providerSyncedAt: null,
    },
  })
}

export function setContainerId(slug: string, containerId: string) {
  return prisma.instance.update({
    where: { slug },
    data: { containerId },
  })
}

export function setError(slug: string) {
  return prisma.instance.update({
    where: { slug },
    data: {
      status: 'error',
      containerId: null,
      providerSyncHash: null,
      providerSyncedAt: null,
    },
  })
}

export function setRunning(slug: string, appliedConfigSha: string | null) {
  return prisma.instance.update({
    where: { slug },
    data: {
      status: 'running',
      lastActivityAt: new Date(),
      appliedConfigSha,
    },
  })
}

export function setStopped(slug: string) {
  return prisma.instance.update({
    where: { slug },
    data: {
      status: 'stopped',
      stoppedAt: new Date(),
      containerId: null,
      providerSyncHash: null,
      providerSyncedAt: null,
    },
  })
}

export function setStoppedNoContainer(slug: string) {
  return prisma.instance.update({
    where: { slug },
    data: {
      status: 'stopped',
      stoppedAt: new Date(),
      providerSyncHash: null,
      providerSyncedAt: null,
    },
  })
}

export function setStoppedById(id: string) {
  return prisma.instance.update({
    where: { id },
    data: {
      status: 'stopped',
      stoppedAt: new Date(),
      containerId: null,
      providerSyncHash: null,
      providerSyncedAt: null,
    },
  })
}

export function setProviderSyncState(slug: string, providerSyncHash: string, providerSyncedAt: Date) {
  return prisma.instance.update({
    where: { slug },
    data: {
      providerSyncHash,
      providerSyncedAt,
    },
  })
}

export function correctToRunning(slug: string) {
  return prisma.instance.update({
    where: { slug },
    data: {
      status: 'running',
      lastActivityAt: new Date(),
    },
  })
}

export function touchActivity(slug: string) {
  return prisma.instance.update({
    where: { slug },
    data: { lastActivityAt: new Date() },
  })
}

export function deleteBySlug(slug: string) {
  return prisma.instance.deleteMany({ where: { slug } })
}

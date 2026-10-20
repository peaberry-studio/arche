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
  runtimeKind: string | null
  providerSyncHash: string | null
  providerSyncedAt: Date | null
}

export type InstanceCredentials = {
  serverPassword: string
  status: InstanceStatus
}

export type InstanceStatusDetails = {
  runtimeKind: string | null
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

export function findRuntimeKindBySlug(slug: string): Promise<{ runtimeKind: string | null } | null> {
  return prisma.instance.findUnique({
    where: { slug },
    select: { runtimeKind: true },
  })
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
      runtimeKind: true,
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

export function upsertStarting(slug: string, serverPassword: string, startedAt = new Date()) {
  return prisma.instance.upsert({
    where: { slug },
    create: {
      slug,
      status: 'starting',
      serverPassword,
      startedAt,
      providerSyncHash: null,
      providerSyncedAt: null,
    },
    update: {
      status: 'starting',
      serverPassword,
      startedAt,
      stoppedAt: null,
      containerId: null,
      providerSyncHash: null,
      providerSyncedAt: null,
    },
  })
}

export function claimStartingTransition(instance: InstanceRecord, startedAt: Date): Promise<{ count: number }> {
  return prisma.instance.updateMany({
    where: {
      id: instance.id,
      status: instance.status,
      containerId: instance.containerId,
      startedAt: instance.startedAt,
    },
    data: { status: 'starting', startedAt },
  })
}

export function continueStartingTransition(instance: InstanceRecord, startedAt: Date, serverPassword: string, nextStartedAt: Date): Promise<{ count: number }> {
  return prisma.instance.updateMany({
    where: {
      id: instance.id,
      status: 'starting',
      containerId: instance.containerId,
      runtimeKind: instance.runtimeKind,
      startedAt,
    },
    data: {
      containerId: null,
      providerSyncedAt: null,
      providerSyncHash: null,
      serverPassword,
      startedAt: nextStartedAt,
      stoppedAt: null,
    },
  })
}

export function failStartingTransition(id: string, startedAt: Date): Promise<{ count: number }> {
  return prisma.instance.updateMany({
    where: { id, status: 'starting', startedAt },
    data: { status: 'error', containerId: null, providerSyncHash: null, providerSyncedAt: null },
  })
}

export function finishStoppingTransition(id: string, startedAt: Date): Promise<{ count: number }> {
  return prisma.instance.updateMany({
    where: { id, status: 'starting', startedAt },
    data: { status: 'stopped', stoppedAt: new Date(), containerId: null, providerSyncHash: null, providerSyncedAt: null },
  })
}

export function setStoppedIfCurrentSnapshot(slug: string, instance: Pick<InstanceStatusDetails, 'status' | 'containerId' | 'startedAt'>): Promise<{ count: number }> {
  return prisma.instance.updateMany({
    where: { slug, status: instance.status, containerId: instance.containerId, startedAt: instance.startedAt },
    data: { status: 'stopped', stoppedAt: new Date(), containerId: null, providerSyncHash: null, providerSyncedAt: null },
  })
}

export function setContainerId(slug: string, containerId: string, runtimeKind = 'opencode-v1') {
  return prisma.instance.update({
    where: { slug, status: 'starting', containerId: null },
    data: { containerId, runtimeKind },
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

// Race-safe variants: each transition is guarded by slug + status + containerId
// so a stale startup attempt can never mutate the outcome of a newer one. They
// return the affected row count so callers can detect a lost race.

export function setRunningIfCurrentContainer(
  slug: string,
  containerId: string,
  appliedConfigSha: string | null,
  runtimeKind = 'opencode-v1',
): Promise<{ count: number }> {
  return prisma.instance.updateMany({
    where: { slug, status: 'starting', containerId },
    data: {
      status: 'running',
      lastActivityAt: new Date(),
      appliedConfigSha,
      runtimeKind,
    },
  })
}

export function setRunningIfCurrentDesktopStart(
  slug: string,
  startedAt: Date,
  appliedConfigSha: string | null,
  runtimeKind: string,
): Promise<{ count: number }> {
  return prisma.instance.updateMany({
    where: { slug, status: 'starting', containerId: null, startedAt },
    data: {
      status: 'running',
      lastActivityAt: new Date(),
      appliedConfigSha,
      runtimeKind,
    },
  })
}

export function setErrorIfCurrentContainer(
  slug: string,
  containerId: string,
): Promise<{ count: number }> {
  return prisma.instance.updateMany({
    where: { slug, status: 'starting', containerId },
    data: {
      status: 'error',
      containerId: null,
      providerSyncHash: null,
      providerSyncedAt: null,
    },
  })
}

export function correctToRunningIfCurrentContainer(
  slug: string,
  containerId: string,
): Promise<{ count: number }> {
  return prisma.instance.updateMany({
    where: { slug, status: 'starting', containerId },
    data: {
      status: 'running',
      lastActivityAt: new Date(),
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

export function invalidateProviderSyncStateForAllInstances() {
  return prisma.instance.updateMany({
    data: {
      providerSyncHash: null,
      providerSyncedAt: null,
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

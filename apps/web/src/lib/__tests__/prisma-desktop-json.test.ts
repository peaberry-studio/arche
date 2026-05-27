import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  FlowNodeType,
  FlowRunStatus,
  FlowRunStepStatus,
  FlowRunTrigger,
} from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FlowDefinition } from '@/lib/flows/types'

describe('desktop Prisma JSON storage', () => {
  let vaultRoot: string | null = null

  beforeEach(() => {
    vi.resetModules()
    vaultRoot = mkdtempSync(join(tmpdir(), 'arche-desktop-json-'))
    vi.stubEnv('ARCHE_DATA_DIR', vaultRoot)
    vi.stubEnv('ARCHE_DESKTOP_PLATFORM', process.platform)
    vi.stubEnv('ARCHE_DESKTOP_WEB_HOST', 'localhost')
    vi.stubEnv('ARCHE_RUNTIME_MODE', 'desktop')
    globalThis.prismaDesktopClient = undefined
  })

  afterEach(async () => {
    await globalThis.prismaDesktopClient?.$disconnect()
    globalThis.prismaDesktopClient = undefined
    vi.unstubAllEnvs()
    vi.resetModules()
    if (vaultRoot) {
      rmSync(vaultRoot, { force: true, recursive: true })
      vaultRoot = null
    }
  })

  it('round-trips flow definitions and step inputs through the desktop schema', async () => {
    const { initDesktopPrisma } = await import('@/lib/prisma-desktop-init')
    const { prisma } = await import('@/lib/prisma')
    const { createFlowActorScope } = await import('@/lib/flows/authorization')
    const { toPrismaJson } = await import('@/lib/flows/serializers')
    const { flowService } = await import('@/lib/services')

    await initDesktopPrisma()

    await prisma.user.create({
      data: {
        email: 'local@arche.local',
        id: 'user-1',
        passwordHash: 'desktop-local',
        role: 'ADMIN',
        slug: 'local',
        updatedAt: new Date('2026-05-12T10:00:00.000Z'),
      },
    })

    const definition: FlowDefinition = {
      edges: [],
      layout: { nodes: [{ nodeId: 'agent-1', x: 120, y: 80 }] },
      nodes: [
        {
          compactOutput: false,
          id: 'agent-1',
          name: 'Agent',
          promptTemplate: 'Summarize {{input}}',
          targetAgentId: null,
          type: 'agent',
        },
      ],
      startNodeId: 'agent-1',
      version: 1,
    }

    const flow = await flowService.createFlow({
      definition: toPrismaJson(definition),
      enabled: false,
      name: 'Round trip flow',
      timezone: 'UTC',
      userId: 'user-1',
    })
    const run = await flowService.createRun({
      executionUserId: 'user-1',
      flowId: flow.id,
      scheduledFor: new Date('2026-05-12T10:00:00.000Z'),
      status: FlowRunStatus.running,
      trigger: FlowRunTrigger.manual,
    })
    const stepInput = { prompt: 'Summarize launch notes', retries: [1, 2], safe: true }

    await flowService.upsertRunStep({
      input: toPrismaJson(stepInput),
      nodeId: 'agent-1',
      nodeName: 'Agent',
      nodeType: FlowNodeType.agent,
      runId: run.id,
      status: FlowRunStepStatus.running,
    })

    const found = await flowService.findFlowByIdForScope(
      flow.id,
      createFlowActorScope({ id: 'user-1', role: 'ADMIN' }, 'user-1'),
    )

    expect(found?.definition).toEqual(definition)
    expect(found?.runs[0]?.steps[0]?.input).toEqual(stepInput)
  })
})

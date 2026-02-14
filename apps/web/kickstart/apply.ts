import { buildKickstartArtifacts } from '@/kickstart/build'
import { acquireKickstartApplyLock } from '@/kickstart/lock'
import {
  replaceKickstartContentRepo,
  type KickstartRepoWriteResult,
  writeKickstartConfigRepo,
} from '@/kickstart/repositories'
import { getKickstartStatus } from '@/kickstart/status'
import type {
  KickstartApplyError,
  KickstartApplyResult,
} from '@/kickstart/types'
import { parseKickstartApplyPayload } from '@/kickstart/validation'
import { auditEvent } from '@/lib/auth'

function mapRepoWriteError(result: KickstartRepoWriteResult): KickstartApplyError {
  if (result.ok) {
    return 'apply_failed'
  }

  if (result.error === 'kb_unavailable') {
    return 'kb_unavailable'
  }

  if (result.error === 'conflict') {
    return 'conflict'
  }

  return 'apply_failed'
}

async function auditWriteFailure(args: {
  actorUserId: string
  metadataBase: {
    templateId: string
    companyName: string
    agentIds: string[]
  }
  stage: 'config_write' | 'kb_write'
  error: KickstartApplyError
}): Promise<void> {
  await auditEvent({
    actorUserId: args.actorUserId,
    action: 'kickstart.apply_failed',
    metadata: {
      ...args.metadataBase,
      error: args.error,
      stage: args.stage,
    },
  })
}

export async function applyKickstart(
  payload: unknown,
  actorUserId: string
): Promise<KickstartApplyResult> {
  const parsedPayload = parseKickstartApplyPayload(payload)
  if (!parsedPayload.ok) {
    return {
      ok: false,
      error: 'invalid_payload',
      message: parsedPayload.message,
    }
  }

  const lock = await acquireKickstartApplyLock()
  if (!lock.ok) {
    if (lock.error === 'kb_unavailable') {
      return { ok: false, error: 'kb_unavailable' }
    }
    if (lock.error === 'conflict') {
      return { ok: false, error: 'conflict' }
    }
    return {
      ok: false,
      error: 'apply_failed',
      message: 'failed to acquire setup lock',
    }
  }

  const metadataBase = {
    templateId: parsedPayload.input.template.id,
    companyName: parsedPayload.input.context.companyName,
    agentIds: parsedPayload.input.agents.map((agent) => agent.id),
  }

  try {
    const status = await getKickstartStatus({ ignoreLock: true })
    if (status === 'ready') {
      return { ok: false, error: 'already_configured' }
    }

    const built = buildKickstartArtifacts(parsedPayload.input)
    if (!built.ok) {
      return {
        ok: false,
        error: 'invalid_payload',
        message: built.message,
      }
    }

    await auditEvent({
      actorUserId,
      action: 'kickstart.apply_started',
      metadata: metadataBase,
    })

    const [configWrite, kbWrite] = await Promise.all([
      writeKickstartConfigRepo({
        'CommonWorkspaceConfig.json': built.artifacts.configContent,
        'AGENTS.md': built.artifacts.agentsMdContent,
      }),
      replaceKickstartContentRepo({
        directories: built.artifacts.kbDirectories,
        files: built.artifacts.kbFiles,
      }),
    ])

    const writeFailures: Array<{
      stage: 'config_write' | 'kb_write'
      error: KickstartApplyError
    }> = []

    if (!configWrite.ok) {
      writeFailures.push({
        stage: 'config_write',
        error: mapRepoWriteError(configWrite),
      })
    }

    if (!kbWrite.ok) {
      writeFailures.push({
        stage: 'kb_write',
        error: mapRepoWriteError(kbWrite),
      })
    }

    if (writeFailures.length > 0) {
      await Promise.all(
        writeFailures.map((failure) =>
          auditWriteFailure({
            actorUserId,
            metadataBase,
            stage: failure.stage,
            error: failure.error,
          })
        )
      )

      return { ok: false, error: writeFailures[0].error }
    }

    await auditEvent({
      actorUserId,
      action: 'kickstart.apply_succeeded',
      metadata: metadataBase,
    })

    return { ok: true }
  } catch (error) {
    await auditEvent({
      actorUserId,
      action: 'kickstart.apply_failed',
      metadata: {
        ...metadataBase,
        error: 'apply_failed',
        detail: error instanceof Error ? error.message : 'unknown_error',
      },
    })

    return {
      ok: false,
      error: 'apply_failed',
      message: 'kickstart apply failed',
    }
  } finally {
    await lock.release()
  }
}

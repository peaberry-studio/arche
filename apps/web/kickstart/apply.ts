import { auditEvent } from '@/lib/auth'
import { buildKickstartArtifacts } from '@/kickstart/build'
import { acquireKickstartApplyLock } from '@/kickstart/lock'
import {
  replaceKickstartContentRepo,
  writeKickstartConfigRepo,
} from '@/kickstart/repositories'
import { getKickstartStatus } from '@/kickstart/status'
import type { KickstartApplyResult } from '@/kickstart/types'
import { parseKickstartApplyPayload } from '@/kickstart/validation'

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

    const configWrite = await writeKickstartConfigRepo({
      'CommonWorkspaceConfig.json': built.artifacts.configContent,
      'AGENTS.md': built.artifacts.agentsMdContent,
    })
    if (!configWrite.ok) {
      const error =
        configWrite.error === 'kb_unavailable'
          ? 'kb_unavailable'
          : configWrite.error === 'conflict'
            ? 'conflict'
            : 'apply_failed'

      await auditEvent({
        actorUserId,
        action: 'kickstart.apply_failed',
        metadata: {
          ...metadataBase,
          error,
          stage: 'config_write',
        },
      })

      return { ok: false, error }
    }

    const kbWrite = await replaceKickstartContentRepo({
      directories: built.artifacts.kbDirectories,
      files: built.artifacts.kbFiles,
    })
    if (!kbWrite.ok) {
      const error =
        kbWrite.error === 'kb_unavailable'
          ? 'kb_unavailable'
          : kbWrite.error === 'conflict'
            ? 'conflict'
            : 'apply_failed'

      await auditEvent({
        actorUserId,
        action: 'kickstart.apply_failed',
        metadata: {
          ...metadataBase,
          error,
          stage: 'kb_write',
        },
      })

      return { ok: false, error }
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

import { NextResponse } from 'next/server'

import { auditEvent } from '@/lib/auth'
import {
  listAppliedKnowledgeReviewChanges,
  markKnowledgeReviewChangesPublished,
} from '@/lib/learning/service'
import { isWorkspaceReachable } from '@/lib/runtime/workspace-host'
import { withAuth } from '@/lib/runtime/with-auth'
import { kbGithubRemoteService } from '@/lib/services'
import { findIdBySlug } from '@/lib/services/user'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'

export interface PublishKbResult {
  ok: boolean
  status: 'published' | 'nothing_to_publish' | 'push_rejected' | 'conflicts' | 'no_remote' | 'error'
  commitHash?: string
  files?: string[]
  githubMessage?: string
  githubStatus?: string
  message?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getWorkspaceDiffPaths(value: unknown): string[] | null {
  if (!isRecord(value) || !Array.isArray(value.diffs)) return null
  return value.diffs.flatMap((diff) => (
    isRecord(diff) && typeof diff.path === 'string' ? [diff.path] : []
  ))
}

const PUBLISH_MESSAGE_LABELS: Record<string, string> = {
  no_reviewed_changes_to_publish: 'No reviewed changes to publish. Apply changes from Knowledge Review first, or discard unreviewed edits.',
  reviewed_path_manifest_required: 'Unreviewed workspace changes must be reviewed or discarded before publishing.',
  unreviewed_changes_present: 'The workspace contains unreviewed changes. Review or discard them before publishing.',
  reviewed_content_changed: 'A reviewed file changed after it was applied. Re-apply or discard the newer edits before publishing.',
  reviewed_hash_missing: 'A reviewed change has no recorded content hash. Re-apply it before publishing.',
  workspace_diffs_unavailable: 'Could not read workspace changes. Try again.',
  workspace_owner_not_found: 'Could not resolve the workspace owner. Try again.',
}

function publishMessage(code: string): string {
  return PUBLISH_MESSAGE_LABELS[code] ?? code
}

export const POST = withAuth<PublishKbResult | { error: string }>(
  { csrf: true },
  async (_request, { slug, user }) => {
    const reachable = await isWorkspaceReachable(slug)

    if (!reachable) {
      return NextResponse.json({ error: 'instance_not_running' }, { status: 409 })
    }

    try {
      const agent = await createWorkspaceAgentClient(slug)
      if (!agent) {
        return NextResponse.json({ error: 'instance_unavailable' }, { status: 409 })
      }

      // Review records belong to the workspace owner. An ADMIN can publish
      // another user's workspace, so the owner must be resolved from the slug
      // instead of assuming the acting user is the owner.
      const owner = await findIdBySlug(slug)
      if (!owner) {
        return NextResponse.json({
          ok: false,
          status: 'error',
          message: publishMessage('workspace_owner_not_found'),
        })
      }

      const githubRemote = await kbGithubRemoteService.createWorkspaceRemoteConfig()
      if (!githubRemote.ok) {
        return NextResponse.json({
          ok: false,
          status: 'error',
          message: githubRemote.error,
        })
      }

      const diffsResponse = await fetch(`${agent.baseUrl}/git/diffs`, {
        headers: {
          Authorization: agent.authHeader,
          Accept: 'application/json',
        },
        cache: 'no-store',
      })
      const diffPaths = getWorkspaceDiffPaths(await diffsResponse.json().catch(() => null))
      if (!diffsResponse.ok || !diffPaths) {
        return NextResponse.json({
          ok: false,
          status: 'error',
          message: publishMessage('workspace_diffs_unavailable'),
        })
      }

      // With no workspace diffs there is nothing to gate: let the agent push
      // already-committed content (e.g. the initial GitHub sync).
      const appliedChanges = diffPaths.length > 0
        ? await listAppliedKnowledgeReviewChanges({ paths: diffPaths, userId: owner.id })
        : []
      const reviewedPaths = appliedChanges.map((change) => change.kbPath)
      if (diffPaths.length > 0 && reviewedPaths.length === 0) {
        return NextResponse.json({
          ok: false,
          status: 'error',
          message: publishMessage('no_reviewed_changes_to_publish'),
        })
      }

      // Publication authorizes the applied content by hash, not just the path:
      // the agent re-verifies these hashes immediately before committing so
      // later unreviewed bytes at an approved path cannot be published. A
      // legacy applied change without a recorded hash cannot be verified, so
      // publishing fails closed instead of sending an empty hash the agent
      // would skip.
      const pathHashes: Record<string, string> = {}
      for (const change of appliedChanges) {
        if (change.operation === 'delete') {
          pathHashes[change.kbPath] = 'deleted'
        } else if (!change.appliedHash) {
          return NextResponse.json({
            ok: false,
            status: 'error',
            message: publishMessage('reviewed_hash_missing'),
          })
        } else {
          pathHashes[change.kbPath] = change.appliedHash
        }
      }

      const body = JSON.stringify({
        ...(githubRemote.remote ? { github: githubRemote.remote } : {}),
        ...(reviewedPaths.length > 0 ? { paths: reviewedPaths, pathHashes } : {}),
      })

      const response = await fetch(`${agent.baseUrl}/kb/publish`, {
        method: 'POST',
        headers: {
          Authorization: agent.authHeader,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body,
        cache: 'no-store'
      })

      const data = await response.json().catch(() => null) as PublishKbResult | null
      if (!response.ok || !data) {
        const errorText = data?.message ?? `workspace_agent_http_${response.status}`
        if (githubRemote.remote) {
          await markGithubSync('error', errorText)
        }
        return NextResponse.json({
          ok: false,
          status: 'error',
          message: errorText,
        })
      }

      if (githubRemote.remote) {
        await markGithubSyncFromPublish(data)
      }

      if (data.ok && data.status === 'published' && data.commitHash) {
        const publishedPaths = (data.files ?? []).filter((path) => reviewedPaths.includes(path))
        if (publishedPaths.length > 0) {
          await markKnowledgeReviewChangesPublished({
            actor: user.id,
            commitSha: data.commitHash,
            paths: publishedPaths,
            userId: owner.id,
          })
          await auditEvent({
            actorUserId: user.id,
            action: 'knowledge.review_published',
            metadata: { commitSha: data.commitHash, paths: publishedPaths, workspaceOwnerId: owner.id },
          })
        }
      }

      return NextResponse.json({
        ...data,
        ...(data.message ? { message: publishMessage(data.message) } : {}),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return NextResponse.json({
        ok: false,
        status: 'error',
        message,
      })
    }
  }
)

async function markGithubSyncFromPublish(result: PublishKbResult): Promise<void> {
  const status = result.githubStatus ?? result.status
  if (result.status === 'conflicts' || status === 'conflicts') {
    await markGithubSync('conflicts', result.message ?? result.githubMessage ?? null)
    return
  }

  if (result.ok && (result.status === 'published' || result.status === 'nothing_to_publish')) {
    await markGithubSync('success', null)
    return
  }

  await markGithubSync('error', result.message ?? result.githubMessage ?? null)
}

async function markGithubSync(
  status: 'success' | 'error' | 'conflicts',
  lastError: string | null,
): Promise<void> {
  await kbGithubRemoteService.updateSyncState({
    lastError,
    lastSyncAt: new Date().toISOString(),
    lastSyncStatus: status,
  }).catch((error) => {
    console.error('[kb-github-remote] Failed to update publish sync state', error)
  })
}

import { NextRequest } from 'next/server'

import { getSession } from '@/lib/runtime/session'
import { validateSameOrigin } from '@/lib/csrf'
import {
  ensureUniqueAttachmentFilename,
  inferAttachmentMimeType,
  isWorkspaceAttachmentPath,
  MAX_ATTACHMENTS_PER_UPLOAD,
  MAX_ATTACHMENT_UPLOAD_BYTES,
  normalizeAttachmentPath,
  sanitizeAttachmentFilename,
  WORKSPACE_ATTACHMENTS_DIR,
} from '@/lib/workspace-attachments'
import { workspaceAgentFetch, type WorkspaceAgent } from '@/lib/workspace-agent-client'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type WorkspaceAgentListEntry = {
  path: string
  name: string
  type: 'file' | 'directory'
  size: number
  modifiedAt: number
}

type WorkspaceAgentListResponse = {
  ok: boolean
  entries?: WorkspaceAgentListEntry[]
  error?: string
}

type WorkspaceAttachment = {
  id: string
  path: string
  name: string
  mime: string
  size: number
  uploadedAt: number
}

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function normalizeAndValidateAttachmentPath(path: unknown): string | null {
  if (typeof path !== 'string') return null
  const normalized = normalizeAttachmentPath(path)
  if (!isWorkspaceAttachmentPath(normalized)) return null
  return normalized
}

async function getAuthorizedWorkspaceAgent(slug: string) {
  const session = await getSession()
  if (!session) {
    return { ok: false as const, response: jsonResponse(401, { error: 'unauthorized' }) }
  }

  if (session.user.slug !== slug && session.user.role !== 'ADMIN') {
    return { ok: false as const, response: jsonResponse(403, { error: 'forbidden' }) }
  }

  const agent = await createWorkspaceAgentClient(slug)
  if (!agent) {
    return {
      ok: false as const,
      response: jsonResponse(503, { error: 'instance_unavailable' }),
    }
  }

  return { ok: true as const, agent }
}

async function listWorkspaceAttachments(
  agent: WorkspaceAgent,
): Promise<{ ok: true; attachments: WorkspaceAttachment[] } | { ok: false; error: string }> {
  const response = await workspaceAgentFetch<WorkspaceAgentListResponse>(
    agent,
    '/files/list',
    { path: WORKSPACE_ATTACHMENTS_DIR, recursive: false },
  )

  if (!response.ok && response.status === 404) {
    return { ok: true, attachments: [] }
  }

  if (!response.ok) {
    return { ok: false, error: response.error }
  }

  const attachments = (response.data.entries ?? [])
    .filter((entry) => entry.type === 'file')
    .map((entry) => ({
      id: entry.path,
      path: entry.path,
      name: entry.name,
      mime: inferAttachmentMimeType(entry.name),
      size: entry.size,
      uploadedAt: entry.modifiedAt,
    }))
    .sort((a, b) => b.uploadedAt - a.uploadedAt)

  return { ok: true, attachments }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const auth = await getAuthorizedWorkspaceAgent(slug)
  if (!auth.ok) return auth.response

  try {
    const listed = await listWorkspaceAttachments(auth.agent)
    if (!listed.ok) {
      return jsonResponse(502, { error: listed.error })
    }

    const { searchParams } = new URL(request.url)
    const limitParam = Number(searchParams.get('limit'))
    const hasLimit = Number.isFinite(limitParam) && limitParam > 0
    const limited = hasLimit
      ? listed.attachments.slice(0, Math.min(limitParam, 50))
      : listed.attachments

    return jsonResponse(200, { attachments: limited })
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : 'attachments_list_failed',
    })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const auth = await getAuthorizedWorkspaceAgent(slug)
  if (!auth.ok) return auth.response

  const originValidation = validateSameOrigin(request)
  if (!originValidation.ok) {
    return jsonResponse(403, { error: 'forbidden' })
  }

  const formData = await request.formData()
  const files = formData
    .getAll('files')
    .filter((value): value is File => value instanceof File)

  if (files.length === 0) {
    return jsonResponse(400, { error: 'missing_files' })
  }

  if (files.length > MAX_ATTACHMENTS_PER_UPLOAD) {
    return jsonResponse(400, { error: 'too_many_files' })
  }

  if (files.some((file) => file.size > MAX_ATTACHMENT_UPLOAD_BYTES)) {
    return jsonResponse(413, { error: 'file_too_large' })
  }

  const existing = await listWorkspaceAttachments(auth.agent)
  if (!existing.ok) {
    return jsonResponse(502, { error: existing.error })
  }

  const usedNames = new Set(existing.attachments.map((attachment) => attachment.name))
  const uploadTargets = files.map((file) => {
    const safeName = sanitizeAttachmentFilename(file.name)
    const uniqueName = ensureUniqueAttachmentFilename(safeName, usedNames)
    usedNames.add(uniqueName)

    return {
      file,
      name: uniqueName,
      path: `${WORKSPACE_ATTACHMENTS_DIR}/${uniqueName}`,
    }
  })

  const results = await Promise.allSettled(
    uploadTargets.map(async ({ file, name, path }) => {
      const bytes = Buffer.from(await file.arrayBuffer())
      const fileType = file.type.trim()
      const mime =
        fileType.length > 0 && fileType !== 'application/octet-stream'
          ? fileType
          : inferAttachmentMimeType(name)
      const uploadedAt = Date.now()

      const response = await workspaceAgentFetch<{ ok: boolean; hash?: string; error?: string }>(
        auth.agent,
        '/files/write',
        {
          path,
          content: bytes.toString('base64'),
          encoding: 'base64',
        },
      )

      if (!response.ok) {
        throw new Error(response.error)
      }

      return {
        id: path,
        path,
        name,
        mime,
        size: bytes.length,
        uploadedAt,
      } satisfies WorkspaceAttachment
    }),
  )

  const uploaded: WorkspaceAttachment[] = []
  const failed: Array<{ name: string; error: string }> = []

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index]
    const target = uploadTargets[index]

    if (result.status === 'fulfilled') {
      uploaded.push(result.value)
      continue
    }

    failed.push({
      name: target.name,
      error:
        result.reason instanceof Error && result.reason.message
          ? result.reason.message
          : 'upload_failed',
    })
  }

  if (failed.length > 0 && uploaded.length === 0) {
    return jsonResponse(502, { error: 'upload_failed', uploaded, failed })
  }

  if (failed.length > 0) {
    return jsonResponse(207, { uploaded, failed })
  }

  return jsonResponse(201, { uploaded, failed: [] })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const auth = await getAuthorizedWorkspaceAgent(slug)
  if (!auth.ok) return auth.response

  const originValidation = validateSameOrigin(request)
  if (!originValidation.ok) {
    return jsonResponse(403, { error: 'forbidden' })
  }

  const body = (await request
    .json()
    .catch(() => null)) as { path?: unknown; name?: unknown } | null
  const path = normalizeAndValidateAttachmentPath(body?.path)
  if (!path) {
    return jsonResponse(400, { error: 'invalid_path' })
  }

  if (typeof body?.name !== 'string') {
    return jsonResponse(400, { error: 'invalid_name' })
  }

  const sanitizedName = sanitizeAttachmentFilename(body.name)
  if (sanitizedName.length === 0) {
    return jsonResponse(400, { error: 'invalid_name' })
  }

  const newPath = `${WORKSPACE_ATTACHMENTS_DIR}/${sanitizedName}`

  const response = await workspaceAgentFetch<{ ok: boolean; path?: string; newPath?: string; error?: string }>(
    auth.agent,
    '/files/rename',
    { path, newPath },
  )

  if (!response.ok) {
    return jsonResponse(response.status === 409 ? 409 : 502, { error: response.error })
  }

  const listed = await listWorkspaceAttachments(auth.agent)
  if (!listed.ok) {
    return jsonResponse(502, { error: listed.error })
  }

  const updatedAttachment = listed.attachments.find(
    (attachment) => attachment.path === newPath,
  )
  if (!updatedAttachment) {
    return jsonResponse(404, { error: 'not_found' })
  }

  return jsonResponse(200, { attachment: updatedAttachment })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const auth = await getAuthorizedWorkspaceAgent(slug)
  if (!auth.ok) return auth.response

  const originValidation = validateSameOrigin(request)
  if (!originValidation.ok) {
    return jsonResponse(403, { error: 'forbidden' })
  }

  const body = (await request
    .json()
    .catch(() => null)) as { path?: unknown } | null
  const path = normalizeAndValidateAttachmentPath(body?.path)
  if (!path) {
    return jsonResponse(400, { error: 'invalid_path' })
  }

  const response = await workspaceAgentFetch<{ ok: boolean; error?: string }>(
    auth.agent,
    '/files/delete',
    { path },
  )

  if (!response.ok) {
    return jsonResponse(response.status === 404 ? 404 : 502, {
      error: response.error,
    })
  }

  return jsonResponse(200, { ok: true })
}

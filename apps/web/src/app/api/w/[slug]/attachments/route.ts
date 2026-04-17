import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/runtime/with-auth'
import {
  ensureUniqueAttachmentFilename,
  inferAttachmentMimeType,
  isWorkspaceAttachmentPath,
  MAX_ATTACHMENT_UPLOAD_BYTES,
  MAX_ATTACHMENT_UPLOAD_MEGABYTES,
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

type WorkspaceAgentUploadResponse = {
  ok: boolean
  path?: string
  hash?: string
  size?: number
  modifiedAt?: number
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

function fileTooLargeResponse() {
  return jsonResponse(413, {
    error: 'file_too_large',
    maxBytes: MAX_ATTACHMENT_UPLOAD_BYTES,
    maxMegabytes: MAX_ATTACHMENT_UPLOAD_MEGABYTES,
  })
}

function normalizeAndValidateAttachmentPath(path: unknown): string | null {
  if (typeof path !== 'string') return null
  const normalized = normalizeAttachmentPath(path)
  if (!isWorkspaceAttachmentPath(normalized)) return null
  return normalized
}

function getAttachmentName(path: string): string | null {
  const parts = path.split('/')
  const name = parts[parts.length - 1]?.trim() ?? ''
  return name.length > 0 ? name : null
}

function getAttachmentUploadName(request: NextRequest): string | null {
  const filename = new URL(request.url).searchParams.get('filename')
  if (!filename || filename.trim().length === 0) return null
  return sanitizeAttachmentFilename(filename)
}

async function getWorkspaceAgentForSlug(slug: string) {
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

export const GET = withAuth(
  { csrf: false },
  async (request: NextRequest, { slug }) => {
    const auth = await getWorkspaceAgentForSlug(slug)
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
  },
)

export const POST = withAuth(
  { csrf: true },
  async (request: NextRequest, { slug }) => {
    const auth = await getWorkspaceAgentForSlug(slug)
    if (!auth.ok) return auth.response

    const filename = getAttachmentUploadName(request)
    if (!filename) {
      return jsonResponse(400, { error: 'invalid_filename' })
    }

    if (!request.body) {
      return jsonResponse(400, { error: 'missing_file' })
    }

    const contentLengthHeader = request.headers.get('content-length')
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader)
      if (Number.isFinite(contentLength) && contentLength > MAX_ATTACHMENT_UPLOAD_BYTES) {
        return fileTooLargeResponse()
      }
    }

    const existing = await listWorkspaceAttachments(auth.agent)
    if (!existing.ok) {
      return jsonResponse(502, { error: existing.error })
    }

    const usedNames = new Set(existing.attachments.map((attachment) => attachment.name))
    const uniqueName = ensureUniqueAttachmentFilename(filename, usedNames)
    const path = `${WORKSPACE_ATTACHMENTS_DIR}/${uniqueName}`
    const contentType = request.headers.get('content-type')?.trim() ?? ''
    const headers = new Headers({
      Accept: 'application/json',
      Authorization: auth.agent.authHeader,
    })
    if (contentType && contentType !== 'application/octet-stream') {
      headers.set('Content-Type', contentType)
    }

    const upstreamUrl = `${auth.agent.baseUrl}/files/upload?path=${encodeURIComponent(path)}`
    const init: RequestInit & { duplex?: 'half' } = {
      method: 'POST',
      headers,
      body: request.body,
      cache: 'no-store',
    }
    init.duplex = 'half'

    let response: Response
    try {
      response = await fetch(upstreamUrl, init)
    } catch {
      return jsonResponse(502, { error: 'upload_failed' })
    }

    const data = (await response.json().catch(() => null)) as WorkspaceAgentUploadResponse | null

    if (response.status === 413) {
      return fileTooLargeResponse()
    }

    if (!response.ok) {
      return jsonResponse(502, { error: data?.error ?? 'upload_failed' })
    }

    const attachmentPath = normalizeAndValidateAttachmentPath(data?.path)
    if (!data?.ok || !attachmentPath || typeof data.size !== 'number' || typeof data.modifiedAt !== 'number') {
      return jsonResponse(502, { error: 'upload_failed' })
    }

    const attachmentName = getAttachmentName(attachmentPath)
    if (!attachmentName) {
      return jsonResponse(502, { error: 'upload_failed' })
    }

    const mime =
      contentType.length > 0 && contentType !== 'application/octet-stream'
        ? contentType
        : inferAttachmentMimeType(attachmentName)

    return jsonResponse(201, {
      attachment: {
        id: attachmentPath,
        path: attachmentPath,
        name: attachmentName,
        mime,
        size: data.size,
        uploadedAt: data.modifiedAt,
      } satisfies WorkspaceAttachment,
    })
  },
)

export const PATCH = withAuth(
  { csrf: true },
  async (request: NextRequest, { slug }) => {
    const auth = await getWorkspaceAgentForSlug(slug)
    if (!auth.ok) return auth.response

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
  },
)

export const DELETE = withAuth(
  { csrf: true },
  async (request: NextRequest, { slug }) => {
    const auth = await getWorkspaceAgentForSlug(slug)
    if (!auth.ok) return auth.response

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
  },
)

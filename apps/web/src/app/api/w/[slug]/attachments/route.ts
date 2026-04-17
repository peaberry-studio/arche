import { NextRequest } from 'next/server'

import { withAuth } from '@/lib/runtime/with-auth'
import { createWorkspaceAgentClient } from '@/lib/workspace-agent/client'
import { workspaceAgentFetch, type WorkspaceAgent } from '@/lib/workspace-agent-client'
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

function getRequestContentLength(request: NextRequest): number | null {
  const raw = request.headers.get('content-length')
  if (!raw) return null

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) return null

  return parsed
}

function inferUploadedAttachmentMimeType(request: NextRequest, filename: string): string {
  const rawContentType = request.headers.get('content-type')?.trim()
  if (rawContentType && rawContentType !== 'application/octet-stream') {
    return rawContentType
  }

  return inferAttachmentMimeType(filename)
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

    const { searchParams } = new URL(request.url)
    const requestedName = searchParams.get('filename')
    if (typeof requestedName !== 'string') {
      return jsonResponse(400, { error: 'invalid_name' })
    }

    const sanitizedName = sanitizeAttachmentFilename(requestedName)
    if (sanitizedName.length === 0) {
      return jsonResponse(400, { error: 'invalid_name' })
    }

    if (!request.body) {
      return jsonResponse(400, { error: 'missing_files' })
    }

    const contentLength = getRequestContentLength(request)
    if (contentLength !== null && contentLength > MAX_ATTACHMENT_UPLOAD_BYTES) {
      return fileTooLargeResponse()
    }

    const existing = await listWorkspaceAttachments(auth.agent)
    if (!existing.ok) {
      return jsonResponse(502, { error: existing.error })
    }

    const usedNames = new Set(existing.attachments.map((attachment) => attachment.name))
    const uniqueName = ensureUniqueAttachmentFilename(sanitizedName, usedNames)
    const path = `${WORKSPACE_ATTACHMENTS_DIR}/${uniqueName}`

    const headers = new Headers({
      Accept: 'application/json',
      Authorization: auth.agent.authHeader,
    })
    const contentType = request.headers.get('content-type')
    if (contentType) {
      headers.set('Content-Type', contentType)
    }

    const uploadRequestInit: RequestInit & { duplex?: 'half' } = {
      method: 'POST',
      headers,
      body: request.body,
      cache: 'no-store',
      duplex: 'half',
    }

    let upstreamResponse: Response
    try {
      upstreamResponse = await fetch(
        `${auth.agent.baseUrl}/files/upload?path=${encodeURIComponent(path)}`,
        uploadRequestInit,
      )
    } catch {
      return jsonResponse(502, { error: 'upload_failed' })
    }

    const uploaded = (await upstreamResponse.json().catch(() => null)) as WorkspaceAgentUploadResponse | null

    if (upstreamResponse.status === 413) {
      return fileTooLargeResponse()
    }

    if (
      !upstreamResponse.ok ||
      !uploaded?.ok ||
      typeof uploaded.path !== 'string' ||
      typeof uploaded.hash !== 'string' ||
      typeof uploaded.size !== 'number' ||
      typeof uploaded.modifiedAt !== 'number'
    ) {
      return jsonResponse(502, { error: uploaded?.error ?? 'upload_failed' })
    }

    const attachment: WorkspaceAttachment = {
      id: uploaded.path,
      path: uploaded.path,
      name: uniqueName,
      mime: inferUploadedAttachmentMimeType(request, uniqueName),
      size: uploaded.size,
      uploadedAt: uploaded.modifiedAt,
    }

    return jsonResponse(201, { uploaded: [attachment], failed: [] })
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

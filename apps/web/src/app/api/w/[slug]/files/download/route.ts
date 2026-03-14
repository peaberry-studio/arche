import { NextRequest } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { workspaceAgentFetch } from "@/lib/workspace-agent-client"
import { createWorkspaceAgentClient } from "@/lib/workspace-agent/client"
import {
  inferAttachmentMimeType,
  sanitizeAttachmentFilename,
} from "@/lib/workspace-attachments"
import { isHiddenWorkspacePath, normalizeWorkspacePath } from "@/lib/workspace-paths"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type WorkspaceAgentReadResponse = {
  ok: boolean
  content?: string
  encoding?: "utf-8" | "base64"
  error?: string
}

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function isValidDownloadPath(path: string): boolean {
  if (!path) return false
  if (isHiddenWorkspacePath(path)) return false
  return path.split("/").every((segment) => segment !== "..")
}

function decodeWorkspaceFileContent(data: WorkspaceAgentReadResponse): Buffer | null {
  if (typeof data.content !== "string") return null

  if (data.encoding === "base64") {
    try {
      return Buffer.from(data.content, "base64")
    } catch {
      return null
    }
  }

  if (data.encoding === "utf-8" || data.encoding === undefined) {
    return Buffer.from(data.content, "utf-8")
  }

  return null
}

function buildContentDisposition(filename: string): string {
  const fallbackName = sanitizeAttachmentFilename(filename)
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const session = await getAuthenticatedUser()
  if (!session) {
    return jsonResponse(401, { error: "unauthorized" })
  }

  if (session.user.slug !== slug && session.user.role !== "ADMIN") {
    return jsonResponse(403, { error: "forbidden" })
  }

  const requestUrl = new URL(request.url)
  const normalizedPath = normalizeWorkspacePath(requestUrl.searchParams.get("path") ?? "")
  if (!isValidDownloadPath(normalizedPath)) {
    return jsonResponse(400, { error: "invalid_path" })
  }

  const agent = await createWorkspaceAgentClient(slug)
  if (!agent) {
    return jsonResponse(503, { error: "instance_unavailable" })
  }

  const response = await workspaceAgentFetch<WorkspaceAgentReadResponse>(agent, "/files/read", {
    path: normalizedPath,
  })

  if (!response.ok) {
    return jsonResponse(response.status === 404 ? 404 : 502, { error: response.error })
  }

  const content = decodeWorkspaceFileContent(response.data)
  if (!content) {
    return jsonResponse(502, { error: "invalid_file_content" })
  }

  const filename = normalizedPath.split("/").pop() ?? "download"

  return new Response(new Uint8Array(content), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": buildContentDisposition(filename),
      "Content-Type": inferAttachmentMimeType(filename),
    },
  })
}

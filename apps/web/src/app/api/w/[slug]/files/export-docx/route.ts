import { NextRequest } from "next/server"

import { markdownToDocx } from "@/lib/markdown-to-docx"
import { withAuth } from "@/lib/runtime/with-auth"
import { createWorkspaceAgentClient } from "@/lib/workspace-agent/client"
import {
  createWorkspaceExportAbortContext,
  withWorkspaceExportAbort,
  WorkspaceExportTimeoutError,
} from "@/lib/workspace-export-abort"
import { loadWorkspaceMarkdownDocumentBundle } from "@/lib/workspace-markdown-document-bundle"
import {
  isValidWorkspacePath,
  jsonResponse,
} from "@/lib/workspace-file-response"
import { normalizeWorkspacePath } from "@/lib/workspace-paths"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const MAX_CONCURRENT_EXPORTS = 4
const DOCX_EXPORT_TIMEOUT_MS = 45_000

let activeExports = 0

export const POST = withAuth<{ error: string }>(
  { csrf: false },
  async (request: NextRequest, { slug }) => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonResponse(400, { error: "invalid_body" })
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return jsonResponse(400, { error: "invalid_body" })
    }

    const pathValue = (body as Record<string, unknown>).path
    if (typeof pathValue !== "string") {
      return jsonResponse(400, { error: "invalid_path" })
    }

    const normalizedPath = normalizeWorkspacePath(pathValue)
    if (!isValidWorkspacePath(normalizedPath, { extension: ".md" })) {
      return jsonResponse(400, { error: "invalid_path" })
    }

    if (activeExports >= MAX_CONCURRENT_EXPORTS) {
      return jsonResponse(503, { error: "export_busy" })
    }

    activeExports++
    const abortContext = createWorkspaceExportAbortContext(
      request.signal,
      DOCX_EXPORT_TIMEOUT_MS,
    )
    try {
      const agent = await withWorkspaceExportAbort(
        createWorkspaceAgentClient(slug),
        abortContext.signal,
      )
      if (!agent) {
        return jsonResponse(503, { error: "instance_unavailable" })
      }

      const bundleResult = await loadWorkspaceMarkdownDocumentBundle(
        agent,
        normalizedPath,
        abortContext.signal,
      )
      if (!bundleResult.ok) return bundleResult.response

      const docx = await markdownToDocx(bundleResult.bundle, {
        signal: abortContext.signal,
      })

      return new Response(new Uint8Array(docx), {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      })
    } catch (error) {
      if (error instanceof WorkspaceExportTimeoutError) {
        return jsonResponse(504, { error: "export_timeout" })
      }
      return jsonResponse(500, { error: "export_failed" })
    } finally {
      abortContext.dispose()
      activeExports--
    }
  },
)

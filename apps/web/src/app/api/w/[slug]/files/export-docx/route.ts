import { NextRequest } from "next/server"

import { markdownToDocx } from "@/lib/markdown-to-docx"
import { withAuth } from "@/lib/runtime/with-auth"
import {
  isValidWorkspacePath,
  jsonResponse,
  readWorkspaceFile,
} from "@/lib/workspace-file-response"
import { normalizeWorkspacePath } from "@/lib/workspace-paths"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

const MAX_MARKDOWN_BYTES = 4 * 1024 * 1024
const MAX_CONCURRENT_EXPORTS = 4

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
    try {
      const result = await readWorkspaceFile(slug, normalizedPath)
      if (!result.ok) return result.response

      let content = result.data.content
      if (typeof content !== "string") {
        return jsonResponse(502, { error: "invalid_file_content" })
      }

      if (result.data.encoding === "base64") {
        try {
          content = Buffer.from(content, "base64").toString("utf-8")
        } catch {
          return jsonResponse(502, { error: "invalid_file_content" })
        }
      }

      if (Buffer.byteLength(content, "utf-8") > MAX_MARKDOWN_BYTES) {
        return jsonResponse(413, { error: "file_too_large" })
      }

      const docx = await markdownToDocx(content)

      return new Response(new Uint8Array(docx), {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      })
    } catch {
      return jsonResponse(500, { error: "export_failed" })
    } finally {
      activeExports--
    }
  },
)

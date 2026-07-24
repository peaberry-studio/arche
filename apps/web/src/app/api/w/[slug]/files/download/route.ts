import { NextRequest } from "next/server"

import { withAuth } from "@/lib/runtime/with-auth"
import {
  inferAttachmentMimeType,
  sanitizeAttachmentFilename,
} from "@/lib/workspace-attachments"
import {
  isValidWorkspacePath,
  jsonResponse,
  readWorkspaceFile,
} from "@/lib/workspace-file-response"
import { normalizeWorkspacePath } from "@/lib/workspace-paths"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function decodeFileContent(data: { content?: string; encoding?: string }): Buffer | null {
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

export const GET = withAuth<{ error: string }>(
  { csrf: false },
  async (request: NextRequest, { slug }) => {
    const requestUrl = new URL(request.url)
    const normalizedPath = normalizeWorkspacePath(requestUrl.searchParams.get("path") ?? "")
    if (!isValidWorkspacePath(normalizedPath)) {
      return jsonResponse(400, { error: "invalid_path" })
    }

    const result = await readWorkspaceFile(slug, normalizedPath)
    if (!result.ok) return result.response

    const content = decodeFileContent(result.data)
    if (!content) {
      return jsonResponse(502, { error: "invalid_file_content" })
    }

    const filename = normalizedPath.split("/").pop() ?? "download"
    const safeName = sanitizeAttachmentFilename(filename)

    return new Response(new Uint8Array(content), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Content-Type": inferAttachmentMimeType(filename),
      },
    })
  },
)

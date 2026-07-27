import { NextRequest } from "next/server"

import { withAuth } from "@/lib/runtime/with-auth"
import {
  inferAttachmentMimeType,
  sanitizeAttachmentFilename,
} from "@/lib/workspace-attachments"
import {
  decodeWorkspaceFileContent,
  isValidWorkspacePath,
  jsonResponse,
  readWorkspaceFile,
} from "@/lib/workspace-file-response"
import { normalizeWorkspacePath } from "@/lib/workspace-paths"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = withAuth<{ error: string }>(
  { csrf: false },
  async (request: NextRequest, { slug }) => {
    const requestUrl = new URL(request.url)
    const normalizedPath = normalizeWorkspacePath(requestUrl.searchParams.get("path") ?? "")
    if (!isValidWorkspacePath(normalizedPath)) {
      return jsonResponse(400, { error: "invalid_path" })
    }

    // A client may cap the response it is willing to receive (chart data loaders do, so
    // an oversized file fails fast instead of streaming). Restriction only — the cap can
    // never expand what the route serves, so the value needs no trust. Validated before
    // the read: a malformed request should fail without costing a file fetch.
    const maxBytesParam = requestUrl.searchParams.get("maxBytes")
    const maxBytes = maxBytesParam === null ? null : Number(maxBytesParam)
    if (maxBytes !== null && (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)) {
      return jsonResponse(400, { error: "invalid_max_bytes" })
    }

    const result = await readWorkspaceFile(slug, normalizedPath)
    if (!result.ok) return result.response

    const content = decodeWorkspaceFileContent(result.data)
    if (!content) {
      return jsonResponse(502, { error: "invalid_file_content" })
    }

    if (maxBytes !== null && content.byteLength > maxBytes) {
      return jsonResponse(413, { error: "file_too_large" })
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

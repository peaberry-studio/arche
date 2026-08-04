import path from "node:path"

import { NextRequest } from "next/server"

import {
  findDirectDocxDocumentPaths,
  type DocxSourceDocument,
} from "@/lib/docx-document-bundle"
import { markdownToDocx } from "@/lib/markdown-to-docx"
import { withAuth } from "@/lib/runtime/with-auth"
import { createWorkspaceAgentClient } from "@/lib/workspace-agent/client"
import {
  isValidWorkspacePath,
  jsonResponse,
  listWorkspaceFilesFromAgent,
  readWorkspaceFileFromAgent,
  type WorkspaceAgentReadResponse,
} from "@/lib/workspace-file-response"
import { normalizeWorkspacePath } from "@/lib/workspace-paths"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const MAX_MARKDOWN_BYTES = 4 * 1024 * 1024
const MAX_BUNDLE_MARKDOWN_BYTES = 16 * 1024 * 1024
const MAX_CONCURRENT_EXPORTS = 4
const MAX_LINKED_DOCUMENTS = 25

let activeExports = 0

function decodeMarkdownContent(data: WorkspaceAgentReadResponse): string | null {
  if (typeof data.content !== "string") return null
  if (data.encoding !== "base64") return data.content

  try {
    return Buffer.from(data.content, "base64").toString("utf-8")
  } catch {
    return null
  }
}

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
      const agent = await createWorkspaceAgentClient(slug)
      if (!agent) {
        return jsonResponse(503, { error: "instance_unavailable" })
      }

      const primaryResult = await readWorkspaceFileFromAgent(agent, normalizedPath)
      if (!primaryResult.ok) return primaryResult.response

      const primaryMarkdown = decodeMarkdownContent(primaryResult.data)
      if (primaryMarkdown === null) {
        return jsonResponse(502, { error: "invalid_file_content" })
      }
      const primaryBytes = Buffer.byteLength(primaryMarkdown, "utf-8")
      if (primaryBytes > MAX_MARKDOWN_BYTES) {
        return jsonResponse(413, { error: "file_too_large" })
      }

      let listResult = await listWorkspaceFilesFromAgent(agent, "", true)
      if (!listResult.ok) {
        const payload: unknown = await listResult.response.clone().json().catch(() => null)
        const sourceDirectory = path.posix.dirname(normalizedPath)
        if (
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          payload.error === "path_required" &&
          sourceDirectory !== "."
        ) {
          listResult = await listWorkspaceFilesFromAgent(agent, sourceDirectory, true)
        }
      }
      if (!listResult.ok) return listResult.response

      const availablePaths = Array.from(
        new Set([
          normalizedPath,
          ...listResult.entries
            .filter((entry) => entry.type === "file")
            .map((entry) => normalizeWorkspacePath(entry.path))
            .filter((entryPath) => isValidWorkspacePath(entryPath, { extension: ".md" })),
        ]),
      )
      const linkedPaths = findDirectDocxDocumentPaths(
        primaryMarkdown,
        normalizedPath,
        availablePaths,
      )
      if (linkedPaths.length > MAX_LINKED_DOCUMENTS) {
        return jsonResponse(413, { error: "bundle_too_large" })
      }

      const appendices: DocxSourceDocument[] = []
      let bundleBytes = primaryBytes
      for (const linkedPath of linkedPaths) {
        const linkedResult = await readWorkspaceFileFromAgent(agent, linkedPath)
        if (!linkedResult.ok) continue

        const markdown = decodeMarkdownContent(linkedResult.data)
        if (markdown === null) {
          return jsonResponse(502, { error: "invalid_file_content" })
        }

        const markdownBytes = Buffer.byteLength(markdown, "utf-8")
        bundleBytes += markdownBytes
        if (
          markdownBytes > MAX_MARKDOWN_BYTES ||
          bundleBytes > MAX_BUNDLE_MARKDOWN_BYTES
        ) {
          return jsonResponse(413, { error: "bundle_too_large" })
        }

        appendices.push({ markdown, path: linkedPath })
      }

      const docx = await markdownToDocx({
        appendices,
        availablePaths,
        primary: { markdown: primaryMarkdown, path: normalizedPath },
      })

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

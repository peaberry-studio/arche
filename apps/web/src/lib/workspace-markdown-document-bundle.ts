import path from "node:path"

import {
  findDirectMarkdownDocumentPaths,
  type MarkdownDocumentBundle,
  type MarkdownSourceDocument,
} from "@/lib/markdown-document-bundle"
import type { WorkspaceAgent } from "@/lib/workspace-agent-client"
import {
  isValidWorkspacePath,
  jsonResponse,
  listWorkspaceFilesFromAgent,
  readWorkspaceFileFromAgent,
  type WorkspaceAgentReadResponse,
} from "@/lib/workspace-file-response"
import { normalizeWorkspacePath } from "@/lib/workspace-paths"

const MAX_MARKDOWN_BYTES = 4 * 1024 * 1024
const MAX_BUNDLE_MARKDOWN_BYTES = 16 * 1024 * 1024
const MAX_LINKED_DOCUMENTS = 25
const MAX_LISTED_MARKDOWN_ENTRIES = 200

type WorkspaceMarkdownDocumentBundleResult =
  | { bundle: MarkdownDocumentBundle; ok: true }
  | { ok: false; response: Response }

function decodeMarkdownContent(data: WorkspaceAgentReadResponse): string | null {
  if (typeof data.content !== "string") return null
  if (data.encoding !== "base64") return data.content

  try {
    return Buffer.from(data.content, "base64").toString("utf-8")
  } catch {
    return null
  }
}

export async function loadWorkspaceMarkdownDocumentBundle(
  agent: WorkspaceAgent,
  normalizedPath: string,
  signal?: AbortSignal,
): Promise<WorkspaceMarkdownDocumentBundleResult> {
  const primaryResult = await readWorkspaceFileFromAgent(agent, normalizedPath, signal)
  if (!primaryResult.ok) return primaryResult

  const primaryMarkdown = decodeMarkdownContent(primaryResult.data)
  if (primaryMarkdown === null) {
    return { ok: false, response: jsonResponse(502, { error: "invalid_file_content" }) }
  }
  const primaryBytes = Buffer.byteLength(primaryMarkdown, "utf-8")
  if (primaryBytes > MAX_MARKDOWN_BYTES) {
    return { ok: false, response: jsonResponse(413, { error: "file_too_large" }) }
  }

  const listOptions = {
    markdownOnly: true,
    maxEntries: MAX_LISTED_MARKDOWN_ENTRIES,
  }
  let listResult = await listWorkspaceFilesFromAgent(agent, "", true, listOptions, signal)
  if (!listResult.ok) {
    const sourceDirectory = path.posix.dirname(normalizedPath)
    if (listResult.error === "path_required" && sourceDirectory !== ".") {
      listResult = await listWorkspaceFilesFromAgent(
        agent,
        sourceDirectory,
        true,
        listOptions,
        signal,
      )
    }
  }
  if (!listResult.ok && listResult.error !== "path_required") return listResult

  const listedEntries = listResult.ok ? listResult.entries : []
  const markdownEntries = listedEntries.filter(
    (entry) =>
      entry.type === "file" &&
      isValidWorkspacePath(normalizeWorkspacePath(entry.path), { extension: ".md" }),
  )
  const availablePaths = Array.from(
    new Set([
      normalizedPath,
      ...markdownEntries.map((entry) => normalizeWorkspacePath(entry.path)),
    ]),
  )
  const markdownSizes = new Map(
    markdownEntries.map((entry) => [normalizeWorkspacePath(entry.path), entry.size]),
  )
  const linkedPaths = findDirectMarkdownDocumentPaths(
    primaryMarkdown,
    normalizedPath,
    availablePaths,
  )
  if (linkedPaths.length > MAX_LINKED_DOCUMENTS) {
    return { ok: false, response: jsonResponse(413, { error: "bundle_too_large" }) }
  }

  const appendices: MarkdownSourceDocument[] = []
  let bundleBytes = primaryBytes
  for (const linkedPath of linkedPaths) {
    const listedBytes = markdownSizes.get(linkedPath)
    if (
      listedBytes !== undefined &&
      (listedBytes > MAX_MARKDOWN_BYTES ||
        bundleBytes + listedBytes > MAX_BUNDLE_MARKDOWN_BYTES)
    ) {
      return { ok: false, response: jsonResponse(413, { error: "bundle_too_large" }) }
    }

    const linkedResult = await readWorkspaceFileFromAgent(agent, linkedPath, signal)
    if (!linkedResult.ok) continue

    const markdown = decodeMarkdownContent(linkedResult.data)
    if (markdown === null) {
      return { ok: false, response: jsonResponse(502, { error: "invalid_file_content" }) }
    }

    const markdownBytes = Buffer.byteLength(markdown, "utf-8")
    bundleBytes += markdownBytes
    if (
      markdownBytes > MAX_MARKDOWN_BYTES ||
      bundleBytes > MAX_BUNDLE_MARKDOWN_BYTES
    ) {
      return { ok: false, response: jsonResponse(413, { error: "bundle_too_large" }) }
    }

    appendices.push({ markdown, path: linkedPath })
  }

  return {
    bundle: {
      appendices,
      availablePaths,
      primary: { markdown: primaryMarkdown, path: normalizedPath },
    },
    ok: true,
  }
}

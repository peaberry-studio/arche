import path from "node:path"

import {
  findDirectPdfDocumentPaths as findDirectDocumentPaths,
  type PdfDocumentBundle as DocumentBundle,
  type PdfSourceDocument as SourceDocument,
} from "@/lib/pdf-document-bundle"
import type { WorkspaceAgent } from "@/lib/workspace-agent-client"
import {
  isValidWorkspacePath,
  jsonResponse,
  listWorkspaceFilesFromAgent,
  readWorkspaceFileFromAgent,
  type WorkspaceAgentReadResponse,
  type WorkspaceFileListOptions,
} from "@/lib/workspace-file-response"
import { normalizeWorkspacePath } from "@/lib/workspace-paths"

const MAX_MARKDOWN_BYTES = 4 * 1024 * 1024
const MAX_BUNDLE_MARKDOWN_BYTES = 16 * 1024 * 1024
const MAX_LINKED_DOCUMENTS = 25

type ExportPathResult =
  | { ok: true; path: string }
  | { ok: false; response: Response }

type LoadDocumentBundleOptions = {
  allowMissingRootListing?: boolean
  listOptions?: WorkspaceFileListOptions
  signal?: AbortSignal
  validateListedSizes?: boolean
}

type LoadDocumentBundleResult =
  | { bundle: DocumentBundle; ok: true }
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

export async function getMarkdownExportPath(request: Request): Promise<ExportPathResult> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { ok: false, response: jsonResponse(400, { error: "invalid_body" }) }
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, response: jsonResponse(400, { error: "invalid_body" }) }
  }

  const pathValue = (body as Record<string, unknown>).path
  if (typeof pathValue !== "string") {
    return { ok: false, response: jsonResponse(400, { error: "invalid_path" }) }
  }

  const normalizedPath = normalizeWorkspacePath(pathValue)
  if (!isValidWorkspacePath(normalizedPath, { extension: ".md" })) {
    return { ok: false, response: jsonResponse(400, { error: "invalid_path" }) }
  }

  return { ok: true, path: normalizedPath }
}

export async function loadWorkspaceMarkdownDocumentBundle(
  agent: WorkspaceAgent,
  normalizedPath: string,
  options: LoadDocumentBundleOptions = {},
): Promise<LoadDocumentBundleResult> {
  const readDocument = (documentPath: string) =>
    options.signal
      ? readWorkspaceFileFromAgent(agent, documentPath, options.signal)
      : readWorkspaceFileFromAgent(agent, documentPath)
  const listDocuments = (directory: string) =>
    options.listOptions || options.signal
      ? listWorkspaceFilesFromAgent(
          agent,
          directory,
          true,
          options.listOptions,
          options.signal,
        )
      : listWorkspaceFilesFromAgent(agent, directory, true)

  const primaryResult = await readDocument(normalizedPath)
  if (!primaryResult.ok) return primaryResult

  const primaryMarkdown = decodeMarkdownContent(primaryResult.data)
  if (primaryMarkdown === null) {
    return { ok: false, response: jsonResponse(502, { error: "invalid_file_content" }) }
  }
  const primaryBytes = Buffer.byteLength(primaryMarkdown, "utf-8")
  if (primaryBytes > MAX_MARKDOWN_BYTES) {
    return { ok: false, response: jsonResponse(413, { error: "file_too_large" }) }
  }

  let listResult = await listDocuments("")
  if (!listResult.ok) {
    const sourceDirectory = path.posix.dirname(normalizedPath)
    if (listResult.error === "path_required" && sourceDirectory !== ".") {
      listResult = await listDocuments(sourceDirectory)
    }
  }
  if (
    !listResult.ok &&
    !(options.allowMissingRootListing && listResult.error === "path_required")
  ) {
    return listResult
  }

  const markdownEntries = (listResult.ok ? listResult.entries : []).filter(
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
  const markdownSizes = options.validateListedSizes
    ? new Map(
        markdownEntries.map((entry) => [normalizeWorkspacePath(entry.path), entry.size]),
      )
    : null
  const linkedPaths = findDirectDocumentPaths(
    primaryMarkdown,
    normalizedPath,
    availablePaths,
  )
  if (linkedPaths.length > MAX_LINKED_DOCUMENTS) {
    return { ok: false, response: jsonResponse(413, { error: "bundle_too_large" }) }
  }

  const appendices: SourceDocument[] = []
  let bundleBytes = primaryBytes
  for (const linkedPath of linkedPaths) {
    const listedBytes = markdownSizes?.get(linkedPath)
    if (
      listedBytes !== undefined &&
      (listedBytes > MAX_MARKDOWN_BYTES ||
        bundleBytes + listedBytes > MAX_BUNDLE_MARKDOWN_BYTES)
    ) {
      return { ok: false, response: jsonResponse(413, { error: "bundle_too_large" }) }
    }

    const linkedResult = await readDocument(linkedPath)
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

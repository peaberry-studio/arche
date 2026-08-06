import { createHash } from "node:crypto"

import { normalizeWorkspacePath } from "@/lib/workspace-paths"

export function getDocxDocumentAnchor(documentPath: string): string {
  const digest = createHash("sha256")
    .update(normalizeWorkspacePath(documentPath))
    .digest("hex")
    .slice(0, 12)
  return `document_${digest}`
}

export function getDocxHeadingAnchor(documentPath: string, heading: string): string {
  const digest = createHash("sha256")
    .update(`${normalizeWorkspacePath(documentPath)}#${heading.toLowerCase()}`)
    .digest("hex")
    .slice(0, 12)
  return `heading_${digest}`
}

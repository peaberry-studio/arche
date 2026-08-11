import { createHash } from "node:crypto"

import { slugifyHeading } from "@/lib/document-bundle"
import { normalizeWorkspacePath } from "@/lib/workspace-paths"

function getAnchor(prefix: string, value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 12)
  return `${prefix}_${digest}`
}

export function getDocxDocumentAnchor(documentPath: string): string {
  return getAnchor("document", normalizeWorkspacePath(documentPath))
}

export function getDocxHeadingAnchor(documentPath: string, heading: string): string {
  const slug = slugifyHeading(heading) || "section"
  return getAnchor("heading", `${normalizeWorkspacePath(documentPath)}#${slug}`)
}

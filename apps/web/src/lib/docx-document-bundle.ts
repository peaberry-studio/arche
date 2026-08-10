import { createHash } from "node:crypto"

import { normalizeWorkspacePath } from "@/lib/workspace-paths"

function normalizeHeading(heading: string): string {
  return heading
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-")
}

function getAnchor(prefix: string, value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 12)
  return `${prefix}_${digest}`
}

export function getDocxDocumentAnchor(documentPath: string): string {
  return getAnchor("document", normalizeWorkspacePath(documentPath))
}

export function getDocxHeadingAnchor(documentPath: string, heading: string): string {
  const slug = normalizeHeading(heading) || "section"
  return getAnchor("heading", `${normalizeWorkspacePath(documentPath)}#${slug}`)
}

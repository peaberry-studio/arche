import { createHash } from "node:crypto"

import { normalizeWorkspacePath } from "@/lib/workspace-paths"

export function getPdfDocumentAnchor(documentPath: string): string {
  const digest = createHash("sha256")
    .update(normalizeWorkspacePath(documentPath))
    .digest("hex")
    .slice(0, 12)
  return `document-${digest}`
}

export function slugifyPdfHeading(heading: string): string {
  return heading
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-")
}

export function getPdfHeadingAnchor(documentPath: string, heading: string): string {
  const slug = slugifyPdfHeading(heading) || "section"
  return `${getPdfDocumentAnchor(documentPath)}--${slug}`
}

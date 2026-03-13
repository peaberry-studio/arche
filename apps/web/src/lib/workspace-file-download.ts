import { normalizeWorkspacePath } from "@/lib/workspace-paths"

export function getWorkspaceFileDownloadUrl(slug: string, path: string): string | null {
  const normalizedPath = normalizeWorkspacePath(path)
  if (!normalizedPath) return null

  const searchParams = new URLSearchParams({ path: normalizedPath })
  return `/api/w/${encodeURIComponent(slug)}/files/download?${searchParams.toString()}`
}

export function downloadWorkspaceFile(slug: string, path: string): boolean {
  const url = getWorkspaceFileDownloadUrl(slug, path)
  if (!url || typeof document === "undefined") return false

  const link = document.createElement("a")
  link.href = url
  link.download = ""
  link.rel = "noopener"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  return true
}

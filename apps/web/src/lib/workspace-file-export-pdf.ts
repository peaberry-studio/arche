import { normalizeWorkspacePath } from "@/lib/workspace-paths"

export async function exportWorkspaceFileAsPdf(slug: string, path: string): Promise<boolean> {
  const normalizedPath = normalizeWorkspacePath(path)
  if (!normalizedPath || typeof document === "undefined") return false

  const response = await fetch(`/api/w/${encodeURIComponent(slug)}/files/export-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: normalizedPath }),
  })

  if (!response.ok) return false

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const basename = (normalizedPath.split("/").pop() ?? "export").replace(/\.md$/, "")

  const link = document.createElement("a")
  link.href = url
  link.download = `${basename}.pdf`
  link.rel = "noopener"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)

  return true
}

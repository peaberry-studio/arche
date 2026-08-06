import { normalizeWorkspacePath } from "@/lib/workspace-paths"

export async function exportWorkspaceFileAsDocx(slug: string, path: string): Promise<boolean> {
  const normalizedPath = normalizeWorkspacePath(path)
  if (!normalizedPath || typeof document === "undefined") return false

  let url: string | undefined
  let link: HTMLAnchorElement | undefined
  try {
    const response = await fetch(`/api/w/${encodeURIComponent(slug)}/files/export-docx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: normalizedPath }),
    })

    if (!response.ok) return false

    const blob = await response.blob()
    url = URL.createObjectURL(blob)
    const basename = (normalizedPath.split("/").pop() ?? "export").replace(/\.md$/, "")

    link = document.createElement("a")
    link.href = url
    link.download = `${basename}.docx`
    link.rel = "noopener"
    document.body.appendChild(link)
    link.click()

    return true
  } catch {
    return false
  } finally {
    if (link?.parentNode) link.parentNode.removeChild(link)
    if (url) URL.revokeObjectURL(url)
  }
}

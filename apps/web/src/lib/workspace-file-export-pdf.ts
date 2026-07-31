import { normalizeWorkspacePath } from "@/lib/workspace-paths"

export async function exportWorkspaceFileAsPdf(slug: string, path: string): Promise<boolean> {
  const normalizedPath = normalizeWorkspacePath(path)
  if (!normalizedPath || typeof document === "undefined") return false

  let url: string | undefined
  let link: HTMLAnchorElement | undefined
  try {
    const response = await fetch(`/api/w/${encodeURIComponent(slug)}/files/export-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: normalizedPath }),
    })

    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null)
      const error =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "unknown_error"
      console.error("[pdf-export] Export request failed", {
        error,
        path: normalizedPath,
        status: response.status,
      })
      return false
    }

    const blob = await response.blob()
    url = URL.createObjectURL(blob)
    const basename = (normalizedPath.split("/").pop() ?? "export").replace(/\.md$/, "")

    link = document.createElement("a")
    link.href = url
    link.download = `${basename}.pdf`
    link.rel = "noopener"
    document.body.appendChild(link)
    link.click()

    return true
  } catch (error) {
    console.error("[pdf-export] Export request threw", {
      error,
      path: normalizedPath,
    })
    return false
  } finally {
    if (link?.parentNode) link.parentNode.removeChild(link)
    if (url) URL.revokeObjectURL(url)
  }
}

import { normalizeWorkspacePath } from "@/lib/workspace-paths"

export type WorkspaceFileExportResult =
  | { ok: true }
  | { error: string; ok: false }

export type WorkspaceFileExportFormat = "docx" | "pdf"

export async function exportWorkspaceFile(
  slug: string,
  path: string,
  format: WorkspaceFileExportFormat,
): Promise<WorkspaceFileExportResult> {
  const normalizedPath = normalizeWorkspacePath(path)
  if (!normalizedPath) return { error: "invalid_path", ok: false }
  if (typeof document === "undefined") {
    return { error: "browser_unavailable", ok: false }
  }

  let url: string | undefined
  let link: HTMLAnchorElement | undefined
  try {
    const response = await fetch(`/api/w/${encodeURIComponent(slug)}/files/export-${format}`, {
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
      console.error(`[${format}-export] Export request failed`, {
        error,
        path: normalizedPath,
        status: response.status,
      })
      return { error, ok: false }
    }

    const blob = await response.blob()
    url = URL.createObjectURL(blob)
    const basename = (normalizedPath.split("/").pop() ?? "export").replace(/\.md$/, "")

    link = document.createElement("a")
    link.href = url
    link.download = `${basename}.${format}`
    link.rel = "noopener"
    document.body.appendChild(link)
    link.click()

    return { ok: true }
  } catch (error) {
    console.error(`[${format}-export] Export request threw`, {
      error,
      path: normalizedPath,
    })
    return { error: "export_failed", ok: false }
  } finally {
    if (link?.parentNode) link.parentNode.removeChild(link)
    if (url) URL.revokeObjectURL(url)
  }
}

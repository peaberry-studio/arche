import {
  exportWorkspaceFile,
  type WorkspaceFileExportResult,
} from "@/lib/workspace-file-export"

export async function exportWorkspaceFileAsPdf(
  slug: string,
  path: string,
): Promise<WorkspaceFileExportResult> {
  return exportWorkspaceFile(slug, path, "pdf")
}

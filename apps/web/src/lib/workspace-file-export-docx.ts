import {
  exportWorkspaceFile,
  type WorkspaceFileExportResult,
} from "@/lib/workspace-file-export"

export async function exportWorkspaceFileAsDocx(
  slug: string,
  path: string,
): Promise<WorkspaceFileExportResult> {
  return exportWorkspaceFile(slug, path, "docx")
}

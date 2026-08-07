import { exportWorkspaceFile } from "@/lib/workspace-file-export-pdf"

export async function exportWorkspaceFileAsDocx(slug: string, path: string): Promise<boolean> {
  return (await exportWorkspaceFile(slug, path, "docx")).ok
}

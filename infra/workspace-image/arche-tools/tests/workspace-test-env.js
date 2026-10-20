import fs from 'node:fs/promises'
import path from 'node:path'

export async function createWorkspaceTestEnv(prefix) {
  const originalWorkspaceDir = process.env.WORKSPACE_DIR
  const workspaceDir = await fs.mkdtemp(path.resolve(import.meta.dirname, prefix))
  const attachmentsDir = path.join(workspaceDir, '.arche', 'attachments')

  process.env.WORKSPACE_DIR = workspaceDir
  await fs.mkdir(attachmentsDir, { recursive: true })

  return {
    workspaceDir,
    attachmentsDir,
    async cleanup() {
      if (originalWorkspaceDir === undefined) {
        delete process.env.WORKSPACE_DIR
      } else {
        process.env.WORKSPACE_DIR = originalWorkspaceDir
      }

      await fs.rm(workspaceDir, { recursive: true, force: true })
    },
  }
}

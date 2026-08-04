import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/workspace-paths", () => ({
  normalizeWorkspacePath: (path: string) => {
    const trimmed = path.trim().replace(/^\/+/, "")
    return trimmed || ""
  },
}))

import { exportWorkspaceFileAsDocx } from "../workspace-file-export-docx"

describe("exportWorkspaceFileAsDocx", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns false when the path normalizes to empty", async () => {
    const result = await exportWorkspaceFileAsDocx("alice", "  ")
    expect(result).toBe(false)
  })

  it("returns false when document is unavailable (node environment)", async () => {
    const result = await exportWorkspaceFileAsDocx("alice", "docs/readme.md")
    expect(result).toBe(false)
  })
})

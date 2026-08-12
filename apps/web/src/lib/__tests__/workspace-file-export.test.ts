import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/workspace-paths", () => ({
  normalizeWorkspacePath: (path: string) => {
    const trimmed = path.trim().replace(/^\/+/, "")
    return trimmed || ""
  },
}))

import { exportWorkspaceFile } from "../workspace-file-export"

describe("exportWorkspaceFile", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns an error when the path normalizes to empty", async () => {
    const result = await exportWorkspaceFile("alice", "  ", "pdf")
    expect(result).toEqual({ error: "invalid_path", ok: false })
  })

  it("returns an error when document is unavailable (node environment)", async () => {
    const result = await exportWorkspaceFile("alice", "docs/readme.md", "pdf")
    expect(result).toEqual({ error: "browser_unavailable", ok: false })
  })
})

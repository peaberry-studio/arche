import { describe, expect, it, vi } from "vitest"

const exportWorkspaceFile = vi.hoisted(() => vi.fn())

vi.mock("@/lib/workspace-file-export-pdf", () => ({ exportWorkspaceFile }))

import { exportWorkspaceFileAsDocx } from "../workspace-file-export-docx"

describe("exportWorkspaceFileAsDocx", () => {
  it.each([
    [{ ok: true }, true],
    [{ error: "export_failed", ok: false }, false],
  ])("maps the shared exporter result to %s", async (result, expected) => {
    exportWorkspaceFile.mockResolvedValue(result)

    await expect(exportWorkspaceFileAsDocx("alice", "docs/readme.md")).resolves.toBe(expected)
    expect(exportWorkspaceFile).toHaveBeenCalledWith("alice", "docs/readme.md", "docx")
  })
})

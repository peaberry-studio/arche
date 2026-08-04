/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest"

import { exportWorkspaceFileAsDocx } from "../workspace-file-export-docx"

describe("exportWorkspaceFileAsDocx in the browser", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("fetches the DOCX, creates a blob download link, and cleans up", async () => {
    const docxBlob = new Blob(["PK"], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(docxBlob),
    })
    vi.stubGlobal("fetch", fetchMock)

    const revokeUrl = vi.fn()
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:test", revokeObjectURL: revokeUrl })

    const originalCreateElement = document.createElement.bind(document)
    const clickMock = vi.fn()
    let capturedDownload = ""
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName)
      if (tagName === "a") {
        element.click = clickMock
        const originalSetter = Object.getOwnPropertyDescriptor(
          HTMLAnchorElement.prototype,
          "download",
        )?.set
        Object.defineProperty(element, "download", {
          set(value: string) {
            capturedDownload = value
            originalSetter?.call(element, value)
          },
          get() { return capturedDownload },
        })
      }
      return element
    })

    const result = await exportWorkspaceFileAsDocx("alice", "docs/notes.md")

    expect(result).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/w/alice/files/export-docx",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "docs/notes.md" }),
      }),
    )
    expect(clickMock).toHaveBeenCalledTimes(1)
    expect(capturedDownload).toBe("notes.docx")
    expect(revokeUrl).toHaveBeenCalledWith("blob:test")
    expect(document.body.querySelector("a")).toBeNull()
  })

  it("returns false when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }))

    const result = await exportWorkspaceFileAsDocx("alice", "docs/notes.md")
    expect(result).toBe(false)
  })
})

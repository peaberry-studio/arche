/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest"

import { exportWorkspaceFileAsPdf } from "../workspace-file-export-pdf"

describe("exportWorkspaceFileAsPdf in the browser", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("fetches the PDF, creates a blob download link, and cleans up", async () => {
    const pdfBlob = new Blob(["%PDF-1.4"], { type: "application/pdf" })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(pdfBlob),
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
          HTMLAnchorElement.prototype, "download",
        )?.set
        Object.defineProperty(element, "download", {
          set(v: string) {
            capturedDownload = v
            originalSetter?.call(element, v)
          },
          get() { return capturedDownload },
        })
      }
      return element
    })

    const result = await exportWorkspaceFileAsPdf("alice", "docs/notes.md")

    expect(result).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/w/alice/files/export-pdf",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "docs/notes.md" }),
      }),
    )
    expect(clickMock).toHaveBeenCalledTimes(1)
    expect(capturedDownload).toBe("notes.pdf")
    expect(revokeUrl).toHaveBeenCalledWith("blob:test")
    expect(document.body.querySelector("a")).toBeNull()
  })

  it("returns false when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }))

    const result = await exportWorkspaceFileAsPdf("alice", "docs/notes.md")
    expect(result).toBe(false)
  })
})

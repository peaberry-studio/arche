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

    expect(result).toEqual({ ok: true })
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

  it("returns the error code when the fetch fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ error: "path_required" }),
      ok: false,
      status: 502,
    }))

    const result = await exportWorkspaceFileAsPdf("alice", "docs/notes.md")
    expect(result).toEqual({ error: "path_required", ok: false })
    expect(consoleError).toHaveBeenCalledWith(
      "[pdf-export] Export request failed",
      {
        error: "path_required",
        path: "docs/notes.md",
        status: 502,
      },
    )
  })

  it("returns the export error code so callers can show a busy message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ error: "export_busy" }),
      ok: false,
      status: 503,
    }))

    const result = await exportWorkspaceFileAsPdf("alice", "docs/notes.md")

    expect(result).toEqual({ error: "export_busy", ok: false })
  })
})

/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest"

import { exportWorkspaceFile } from "../workspace-file-export"

describe("exportWorkspaceFile in the browser", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(["docx", "pdf"] as const)("fetches %s and cleans up the download link", async (format) => {
    const blob = new Blob([format], { type: "application/octet-stream" })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(blob),
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

    const result = await exportWorkspaceFile("alice", "docs/notes.md", format)

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/w/alice/files/export-${format}`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "docs/notes.md" }),
      }),
    )
    expect(clickMock).toHaveBeenCalledTimes(1)
    expect(capturedDownload).toBe(`notes.${format}`)
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

    const result = await exportWorkspaceFile("alice", "docs/notes.md", "pdf")
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

    const result = await exportWorkspaceFile("alice", "docs/notes.md", "pdf")

    expect(result).toEqual({ error: "export_busy", ok: false })
  })
})

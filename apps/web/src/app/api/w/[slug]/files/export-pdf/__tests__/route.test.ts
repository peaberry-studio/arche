import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createWorkspaceAgentClient: vi.fn(),
  listWorkspaceFilesFromAgent: vi.fn(),
  markdownToPdfHtml: vi.fn(),
  pagedHtmlToPdf: vi.fn(),
  readWorkspaceFileFromAgent: vi.fn(),
}))

vi.mock("@/lib/runtime/with-auth", () => ({
  withAuth:
    (
      _options: unknown,
      handler: (
        request: NextRequest,
        context: { slug: string },
      ) => Promise<Response>,
    ) =>
    async (
      request: NextRequest,
      { params }: { params: Promise<{ slug: string }> },
    ) =>
      handler(request, { slug: (await params).slug }),
}))
vi.mock("@/lib/workspace-agent/client", () => ({
  createWorkspaceAgentClient: mocks.createWorkspaceAgentClient,
}))
vi.mock("@/lib/workspace-file-response", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/workspace-file-response")>()
  return {
    ...original,
    listWorkspaceFilesFromAgent: mocks.listWorkspaceFilesFromAgent,
    readWorkspaceFileFromAgent: mocks.readWorkspaceFileFromAgent,
  }
})
vi.mock("@/lib/markdown-to-pdf-html", () => ({
  markdownToPdfHtml: mocks.markdownToPdfHtml,
}))
vi.mock("@/lib/paged-html-to-pdf", () => ({
  pagedHtmlToPdf: mocks.pagedHtmlToPdf,
  PdfExportTimeoutError: class PdfExportTimeoutError extends Error {},
}))

import { POST } from "../route"

const AGENT = { authHeader: "Basic test", baseUrl: "http://workspace-agent" }

function request(path = "docs/main.md") {
  return new NextRequest("http://localhost/api/w/alice/files/export-pdf", {
    body: JSON.stringify({ path }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })
}

function params() {
  return { params: Promise.resolve({ slug: "alice" }) }
}

function readResult(content: string) {
  return {
    data: { content, encoding: "utf-8" as const, ok: true },
    ok: true as const,
  }
}

function listEntry(path: string) {
  return {
    modifiedAt: 0,
    name: path.split("/").pop() ?? path,
    path,
    size: 1,
    type: "file" as const,
  }
}

describe("POST /api/w/[slug]/files/export-pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createWorkspaceAgentClient.mockResolvedValue(AGENT)
    mocks.markdownToPdfHtml.mockResolvedValue("<html></html>")
    mocks.pagedHtmlToPdf.mockResolvedValue(
      new TextEncoder().encode("%PDF-1.7"),
    )
  })

  it("builds a direct-link bundle and skips unreadable linked documents", async () => {
    mocks.listWorkspaceFilesFromAgent.mockResolvedValue({
      entries: [
        listEntry("docs/main.md"),
        listEntry("docs/a.md"),
        listEntry("docs/b.md"),
        listEntry("docs/missing.md"),
      ],
      ok: true,
    })
    mocks.readWorkspaceFileFromAgent
      .mockResolvedValueOnce(
        readResult(
          "Read [A](a.md), then [[docs/b.md|B]], and [missing](missing.md).",
        ),
      )
      .mockResolvedValueOnce(readResult("# A"))
      .mockResolvedValueOnce(readResult("# B"))
      .mockResolvedValueOnce({
        ok: false,
        response: new Response(null, { status: 502 }),
      })

    const response = await POST(request(), params())

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("application/pdf")
    expect(mocks.markdownToPdfHtml).toHaveBeenCalledWith(
      {
        appendices: [
          { markdown: "# A", path: "docs/a.md" },
          { markdown: "# B", path: "docs/b.md" },
        ],
        availablePaths: [
          "docs/main.md",
          "docs/a.md",
          "docs/b.md",
          "docs/missing.md",
        ],
        primary: {
          markdown:
            "Read [A](a.md), then [[docs/b.md|B]], and [missing](missing.md).",
          path: "docs/main.md",
        },
      },
      expect.objectContaining({ logoBase64: expect.any(String) }),
    )
    expect(mocks.pagedHtmlToPdf).toHaveBeenCalledWith(
      "<html></html>",
      expect.any(AbortSignal),
    )
  })

  it("does not include documents linked only from an appendix", async () => {
    mocks.listWorkspaceFilesFromAgent.mockResolvedValue({
      entries: [
        listEntry("docs/main.md"),
        listEntry("docs/direct.md"),
        listEntry("docs/nested.md"),
      ],
      ok: true,
    })
    mocks.readWorkspaceFileFromAgent
      .mockResolvedValueOnce(readResult("[Direct](direct.md)"))
      .mockResolvedValueOnce(
        readResult("# Direct document\n\n[Nested](nested.md)"),
      )

    const response = await POST(request(), params())

    expect(response.status).toBe(200)
    expect(mocks.readWorkspaceFileFromAgent).toHaveBeenCalledTimes(2)
    expect(mocks.readWorkspaceFileFromAgent).toHaveBeenNthCalledWith(
      2,
      AGENT,
      "docs/direct.md",
      expect.any(AbortSignal),
    )
    expect(mocks.markdownToPdfHtml).toHaveBeenCalledWith(
      expect.objectContaining({
        appendices: [
          {
            markdown: "# Direct document\n\n[Nested](nested.md)",
            path: "docs/direct.md",
          },
        ],
      }),
      expect.any(Object),
    )
  })

  it("times out a stalled pre-render workspace request", async () => {
    vi.useFakeTimers()
    mocks.readWorkspaceFileFromAgent.mockImplementation(
      (_agent, _path, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          })
        }),
    )

    const responsePromise = POST(request(), params())
    await vi.advanceTimersByTimeAsync(45_000)

    const response = await responsePromise
    expect(response.status).toBe(504)
    expect(await response.json()).toEqual({ error: "export_timeout" })
    vi.useRealTimers()
  })

  it("rejects bundles with more than 25 direct documents", async () => {
    const linkedPaths = Array.from(
      { length: 26 },
      (_value, index) => `docs/appendix-${index}.md`,
    )
    mocks.readWorkspaceFileFromAgent.mockResolvedValueOnce(
      readResult(linkedPaths.map((path) => `[doc](${path})`).join("\n")),
    )
    mocks.listWorkspaceFilesFromAgent.mockResolvedValue({
      entries: [listEntry("docs/main.md"), ...linkedPaths.map(listEntry)],
      ok: true,
    })

    const response = await POST(request(), params())

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: "bundle_too_large" })
    expect(mocks.readWorkspaceFileFromAgent).toHaveBeenCalledTimes(1)
    expect(mocks.pagedHtmlToPdf).not.toHaveBeenCalled()
  })

  it("rejects an oversized linked document", async () => {
    mocks.readWorkspaceFileFromAgent
      .mockResolvedValueOnce(readResult("[Appendix](appendix.md)"))
      .mockResolvedValueOnce(readResult("x".repeat(4 * 1024 * 1024 + 1)))
    mocks.listWorkspaceFilesFromAgent.mockResolvedValue({
      entries: [
        listEntry("docs/main.md"),
        listEntry("docs/appendix.md"),
      ],
      ok: true,
    })

    const response = await POST(request(), params())

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: "bundle_too_large" })
  })

  it("propagates workspace listing failures", async () => {
    mocks.readWorkspaceFileFromAgent.mockResolvedValueOnce(readResult("# Main"))
    mocks.listWorkspaceFilesFromAgent.mockResolvedValue({
      error: "list_failed",
      ok: false,
      response: new Response(JSON.stringify({ error: "list_failed" }), {
        status: 502,
      }),
    })

    const response = await POST(request(), params())

    expect(response.status).toBe(502)
    expect(mocks.markdownToPdfHtml).not.toHaveBeenCalled()
  })

  it("falls back to the document directory when root listing is unsupported", async () => {
    mocks.readWorkspaceFileFromAgent.mockResolvedValueOnce(readResult("# Main"))
    mocks.listWorkspaceFilesFromAgent
      .mockResolvedValueOnce({
        error: "path_required",
        ok: false,
        response: new Response(JSON.stringify({ error: "path_required" }), {
          status: 502,
        }),
      })
      .mockResolvedValueOnce({
        entries: [listEntry("docs/main.md")],
        ok: true,
      })

    const response = await POST(request(), params())

    expect(response.status).toBe(200)
    expect(mocks.listWorkspaceFilesFromAgent).toHaveBeenNthCalledWith(
      1,
      AGENT,
      "",
      true,
      { markdownOnly: true, maxEntries: 200 },
      expect.any(AbortSignal),
    )
    expect(mocks.listWorkspaceFilesFromAgent).toHaveBeenNthCalledWith(
      2,
      AGENT,
      "docs",
      true,
      { markdownOnly: true, maxEntries: 200 },
      expect.any(AbortSignal),
    )
  })

  it("exports a root document when a legacy agent rejects root listing", async () => {
    mocks.readWorkspaceFileFromAgent.mockResolvedValueOnce(readResult("# Main"))
    mocks.listWorkspaceFilesFromAgent.mockResolvedValueOnce({
      error: "path_required",
      ok: false,
      response: new Response(JSON.stringify({ error: "path_required" }), {
        status: 502,
      }),
    })

    const response = await POST(request("main.md"), params())

    expect(response.status).toBe(200)
    expect(mocks.markdownToPdfHtml).toHaveBeenCalledWith(
      {
        appendices: [],
        availablePaths: ["main.md"],
        primary: { markdown: "# Main", path: "main.md" },
      },
      expect.any(Object),
    )
  })
})

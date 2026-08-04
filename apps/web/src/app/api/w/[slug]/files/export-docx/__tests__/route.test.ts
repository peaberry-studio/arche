import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createWorkspaceAgentClient: vi.fn(),
  findDirectDocxDocumentPaths: vi.fn(),
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  getSession: vi.fn(),
  isDesktop: vi.fn(() => false),
  listWorkspaceFilesFromAgent: vi.fn(),
  markdownToDocx: vi.fn(),
  readWorkspaceFileFromAgent: vi.fn(),
  validateDesktopToken: vi.fn(() => true),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
}))

vi.mock("@/lib/csrf", () => ({ validateSameOrigin: mocks.validateSameOrigin }))
vi.mock("@/lib/docx-document-bundle", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/docx-document-bundle")>()
  return { ...original, findDirectDocxDocumentPaths: mocks.findDirectDocxDocumentPaths }
})
vi.mock("@/lib/markdown-to-docx", () => ({ markdownToDocx: mocks.markdownToDocx }))
vi.mock("@/lib/runtime/capabilities", () => ({
  getRuntimeCapabilities: mocks.getRuntimeCapabilities,
}))
vi.mock("@/lib/runtime/desktop/token", () => ({
  DESKTOP_TOKEN_HEADER: "x-arche-desktop-token",
  validateDesktopToken: mocks.validateDesktopToken,
}))
vi.mock("@/lib/runtime/mode", () => ({ isDesktop: mocks.isDesktop }))
vi.mock("@/lib/runtime/session", () => ({ getSession: mocks.getSession }))
vi.mock("@/lib/workspace-agent/client", () => ({
  createWorkspaceAgentClient: mocks.createWorkspaceAgentClient,
}))
vi.mock("@/lib/workspace-file-response", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/workspace-file-response")>()
  return {
    ...original,
    listWorkspaceFilesFromAgent: mocks.listWorkspaceFilesFromAgent,
    readWorkspaceFileFromAgent: mocks.readWorkspaceFileFromAgent,
  }
})

import { POST } from "../route"

const CONTEXT = { params: Promise.resolve({ slug: "alice" }) }

function request(body: BodyInit): NextRequest {
  return new NextRequest("http://localhost/api/w/alice/files/export-docx", {
    body,
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })
}

function jsonRequest(body: unknown): NextRequest {
  return request(JSON.stringify(body))
}

describe("POST /api/w/[slug]/files/export-docx", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRuntimeCapabilities.mockReturnValue({ csrf: false })
    mocks.getSession.mockResolvedValue({
      sessionId: "session-1",
      user: { email: "alice@example.com", id: "user-1", role: "USER", slug: "alice" },
    })
    mocks.isDesktop.mockReturnValue(false)
    mocks.createWorkspaceAgentClient.mockResolvedValue({ baseUrl: "http://agent" })
    mocks.findDirectDocxDocumentPaths.mockReturnValue([])
    mocks.listWorkspaceFilesFromAgent.mockResolvedValue({
      entries: [{ modifiedAt: 1, name: "article.md", path: "Research/article.md", size: 9, type: "file" }],
      ok: true,
    })
    mocks.markdownToDocx.mockResolvedValue(Buffer.from("PK docx"))
    mocks.readWorkspaceFileFromAgent.mockResolvedValue({
      ok: true,
      data: { content: "# Article", encoding: "utf-8", ok: true },
    })
  })

  it("returns a DOCX response for a Markdown article", async () => {
    const response = await POST(jsonRequest({ path: "Research/article.md" }), CONTEXT)

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("PK docx")
    expect(mocks.readWorkspaceFileFromAgent).toHaveBeenCalledWith(
      { baseUrl: "http://agent" },
      "Research/article.md",
    )
    expect(mocks.markdownToDocx).toHaveBeenCalledWith({
      appendices: [],
      availablePaths: ["Research/article.md"],
      primary: { markdown: "# Article", path: "Research/article.md" },
    })
  })

  it("decodes base64 article content before conversion", async () => {
    mocks.readWorkspaceFileFromAgent.mockResolvedValue({
      ok: true,
      data: { content: Buffer.from("# Encoded").toString("base64"), encoding: "base64", ok: true },
    })

    const response = await POST(jsonRequest({ path: "encoded.md" }), CONTEXT)

    expect(response.status).toBe(200)
    expect(mocks.markdownToDocx).toHaveBeenCalledWith({
      appendices: [],
      availablePaths: ["encoded.md", "Research/article.md"],
      primary: { markdown: "# Encoded", path: "encoded.md" },
    })
  })

  it("loads directly linked Markdown documents as ordered appendices", async () => {
    mocks.listWorkspaceFilesFromAgent.mockResolvedValue({
      entries: [
        { modifiedAt: 1, name: "report.md", path: "Research/report.md", size: 9, type: "file" },
        { modifiedAt: 1, name: "plots.md", path: "Research/report/plots.md", size: 9, type: "file" },
      ],
      ok: true,
    })
    mocks.findDirectDocxDocumentPaths.mockReturnValue(["Research/report/plots.md"])
    mocks.readWorkspaceFileFromAgent.mockImplementation(async (_agent, filePath) => ({
      data: {
        content: filePath === "Research/report.md" ? "# Report" : "# Plots",
        encoding: "utf-8",
        ok: true,
      },
      ok: true,
    }))

    const response = await POST(jsonRequest({ path: "Research/report.md" }), CONTEXT)

    expect(response.status).toBe(200)
    expect(mocks.markdownToDocx).toHaveBeenCalledWith({
      appendices: [{ markdown: "# Plots", path: "Research/report/plots.md" }],
      availablePaths: ["Research/report.md", "Research/report/plots.md"],
      primary: { markdown: "# Report", path: "Research/report.md" },
    })
  })

  it("forwards workspace listing failures", async () => {
    mocks.listWorkspaceFilesFromAgent.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "list_failed" }), { status: 502 }),
    })

    const response = await POST(jsonRequest({ path: "article.md" }), CONTEXT)

    expect(response.status).toBe(502)
  })

  it("rejects bundles with more than 25 direct links", async () => {
    mocks.findDirectDocxDocumentPaths.mockReturnValue(
      Array.from({ length: 26 }, (_, index) => `appendix-${index}.md`),
    )

    const response = await POST(jsonRequest({ path: "article.md" }), CONTEXT)

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: "bundle_too_large" })
  })

  it.each([
    { body: "{", error: "invalid_body" },
    { body: JSON.stringify([]), error: "invalid_body" },
    { body: JSON.stringify({}), error: "invalid_path" },
    { body: JSON.stringify({ path: "article.txt" }), error: "invalid_path" },
    { body: JSON.stringify({ path: "../article.md" }), error: "invalid_path" },
  ])("rejects invalid input with $error", async ({ body, error }) => {
    const response = await POST(request(body), CONTEXT)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error })
  })

  it("forwards workspace read failures", async () => {
    mocks.readWorkspaceFileFromAgent.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
    })

    const response = await POST(jsonRequest({ path: "missing.md" }), CONTEXT)

    expect(response.status).toBe(404)
  })

  it("returns unavailable when the workspace agent is stopped", async () => {
    mocks.createWorkspaceAgentClient.mockResolvedValue(null)

    const response = await POST(jsonRequest({ path: "article.md" }), CONTEXT)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "instance_unavailable" })
  })

  it("rejects non-text workspace content", async () => {
    mocks.readWorkspaceFileFromAgent.mockResolvedValue({
      ok: true,
      data: { content: null, encoding: "utf-8", ok: true },
    })

    const response = await POST(jsonRequest({ path: "article.md" }), CONTEXT)

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: "invalid_file_content" })
  })

  it("rejects articles larger than four MiB", async () => {
    mocks.readWorkspaceFileFromAgent.mockResolvedValue({
      ok: true,
      data: { content: "x".repeat(4 * 1024 * 1024 + 1), encoding: "utf-8", ok: true },
    })

    const response = await POST(jsonRequest({ path: "large.md" }), CONTEXT)

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: "file_too_large" })
  })

  it("returns export_failed when conversion fails", async () => {
    mocks.markdownToDocx.mockRejectedValue(new Error("conversion failed"))

    const response = await POST(jsonRequest({ path: "article.md" }), CONTEXT)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "export_failed" })
  })

  it("requires authentication", async () => {
    mocks.getSession.mockResolvedValue(null)

    const response = await POST(jsonRequest({ path: "article.md" }), CONTEXT)

    expect(response.status).toBe(401)
  })

  it("limits concurrent exports", async () => {
    let releaseRead: (() => void) | undefined
    const blockedRead = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    mocks.readWorkspaceFileFromAgent.mockImplementation(async () => {
      await blockedRead
      return { ok: true, data: { content: "# Article", encoding: "utf-8", ok: true } }
    })

    const active = Array.from({ length: 4 }, () =>
      POST(jsonRequest({ path: "article.md" }), CONTEXT),
    )
    await vi.waitFor(() => expect(mocks.readWorkspaceFileFromAgent).toHaveBeenCalledTimes(4))

    const busyResponse = await POST(jsonRequest({ path: "article.md" }), CONTEXT)
    expect(busyResponse.status).toBe(503)
    expect(await busyResponse.json()).toEqual({ error: "export_busy" })

    releaseRead?.()
    await Promise.all(active)
  })
})

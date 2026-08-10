import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createWorkspaceAgentClient: vi.fn(),
  findDirectDocumentPaths: vi.fn(),
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
vi.mock("@/lib/document-bundle", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/document-bundle")>()
  return { ...original, findDirectDocumentPaths: mocks.findDirectDocumentPaths }
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

function failureCase(
  name: string,
  status: number,
  error: string | null,
  arrange: () => void,
  path = "article.md",
) {
  return { arrange, error, name, path, status }
}

const FAILURE_CASES = [
  failureCase("workspace listing failures", 502, "list_failed", () =>
    mocks.listWorkspaceFilesFromAgent.mockResolvedValue({
      error: "list_failed",
      ok: false,
      response: new Response(JSON.stringify({ error: "list_failed" }), { status: 502 }),
    })),
  failureCase("more than 25 direct links", 413, "bundle_too_large", () =>
    mocks.findDirectDocumentPaths.mockReturnValue(
      Array.from({ length: 26 }, (_, index) => `appendix-${index}.md`),
    )),
  failureCase("workspace read failures", 404, null, () =>
    mocks.readWorkspaceFileFromAgent.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 404 }),
    }), "missing.md"),
  failureCase("a stopped workspace agent", 503, "instance_unavailable", () =>
    mocks.createWorkspaceAgentClient.mockResolvedValue(null)),
  failureCase("non-text workspace content", 502, "invalid_file_content", () =>
    mocks.readWorkspaceFileFromAgent.mockResolvedValue({
      data: { content: null, encoding: "utf-8", ok: true },
      ok: true,
    })),
  failureCase("articles larger than four MiB", 413, "file_too_large", () =>
    mocks.readWorkspaceFileFromAgent.mockResolvedValue({
      data: { content: "x".repeat(4 * 1024 * 1024 + 1), encoding: "utf-8", ok: true },
      ok: true,
    }), "large.md"),
  failureCase("conversion failures", 500, "export_failed", () =>
    mocks.markdownToDocx.mockRejectedValue(new Error("conversion failed"))),
]

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
    mocks.findDirectDocumentPaths.mockReturnValue([])
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
      expect.any(AbortSignal),
    )
    expect(mocks.markdownToDocx).toHaveBeenCalledWith(
      {
        appendices: [],
        availablePaths: ["Research/article.md"],
        primary: { markdown: "# Article", path: "Research/article.md" },
      },
      expect.any(AbortSignal),
    )
  })

  it("decodes base64 article content before conversion", async () => {
    mocks.readWorkspaceFileFromAgent.mockResolvedValue({
      ok: true,
      data: { content: Buffer.from("# Encoded").toString("base64"), encoding: "base64", ok: true },
    })

    const response = await POST(jsonRequest({ path: "encoded.md" }), CONTEXT)

    expect(response.status).toBe(200)
    expect(mocks.markdownToDocx).toHaveBeenCalledWith(
      {
        appendices: [],
        availablePaths: ["encoded.md", "Research/article.md"],
        primary: { markdown: "# Encoded", path: "encoded.md" },
      },
      expect.any(AbortSignal),
    )
  })

  it("loads directly linked Markdown documents as ordered appendices", async () => {
    mocks.listWorkspaceFilesFromAgent.mockResolvedValue({
      entries: [
        { modifiedAt: 1, name: "report.md", path: "Research/report.md", size: 9, type: "file" },
        { modifiedAt: 1, name: "plots.md", path: "Research/report/plots.md", size: 9, type: "file" },
      ],
      ok: true,
    })
    mocks.findDirectDocumentPaths.mockReturnValue(["Research/report/plots.md"])
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
    expect(mocks.markdownToDocx).toHaveBeenCalledWith(
      {
        appendices: [{ markdown: "# Plots", path: "Research/report/plots.md" }],
        availablePaths: ["Research/report.md", "Research/report/plots.md"],
        primary: { markdown: "# Report", path: "Research/report.md" },
      },
      expect.any(AbortSignal),
    )
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

  it.each(FAILURE_CASES)("handles $name", async ({ arrange, error, path, status }) => {
    arrange()
    const response = await POST(jsonRequest({ path }), CONTEXT)

    expect(response.status).toBe(status)
    if (error) expect(await response.json()).toEqual({ error })
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

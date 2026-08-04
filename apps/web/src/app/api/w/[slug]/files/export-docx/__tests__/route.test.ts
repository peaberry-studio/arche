import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getRuntimeCapabilities: vi.fn(() => ({ csrf: false })),
  getSession: vi.fn(),
  isDesktop: vi.fn(() => false),
  markdownToDocx: vi.fn(),
  readWorkspaceFile: vi.fn(),
  validateDesktopToken: vi.fn(() => true),
  validateSameOrigin: vi.fn(() => ({ ok: true })),
}))

vi.mock("@/lib/csrf", () => ({ validateSameOrigin: mocks.validateSameOrigin }))
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
vi.mock("@/lib/workspace-file-response", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/workspace-file-response")>()
  return { ...original, readWorkspaceFile: mocks.readWorkspaceFile }
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
    mocks.markdownToDocx.mockResolvedValue(Buffer.from("PK docx"))
    mocks.readWorkspaceFile.mockResolvedValue({
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
    expect(mocks.readWorkspaceFile).toHaveBeenCalledWith("alice", "Research/article.md")
    expect(mocks.markdownToDocx).toHaveBeenCalledWith("# Article")
  })

  it("decodes base64 article content before conversion", async () => {
    mocks.readWorkspaceFile.mockResolvedValue({
      ok: true,
      data: { content: Buffer.from("# Encoded").toString("base64"), encoding: "base64", ok: true },
    })

    const response = await POST(jsonRequest({ path: "encoded.md" }), CONTEXT)

    expect(response.status).toBe(200)
    expect(mocks.markdownToDocx).toHaveBeenCalledWith("# Encoded")
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
    mocks.readWorkspaceFile.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
    })

    const response = await POST(jsonRequest({ path: "missing.md" }), CONTEXT)

    expect(response.status).toBe(404)
  })

  it("rejects non-text workspace content", async () => {
    mocks.readWorkspaceFile.mockResolvedValue({
      ok: true,
      data: { content: null, encoding: "utf-8", ok: true },
    })

    const response = await POST(jsonRequest({ path: "article.md" }), CONTEXT)

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: "invalid_file_content" })
  })

  it("rejects articles larger than four MiB", async () => {
    mocks.readWorkspaceFile.mockResolvedValue({
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
    mocks.readWorkspaceFile.mockImplementation(async () => {
      await blockedRead
      return { ok: true, data: { content: "# Article", encoding: "utf-8", ok: true } }
    })

    const active = Array.from({ length: 4 }, () =>
      POST(jsonRequest({ path: "article.md" }), CONTEXT),
    )
    await vi.waitFor(() => expect(mocks.readWorkspaceFile).toHaveBeenCalledTimes(4))

    const busyResponse = await POST(jsonRequest({ path: "article.md" }), CONTEXT)
    expect(busyResponse.status).toBe(503)
    expect(await busyResponse.json()).toEqual({ error: "export_busy" })

    releaseRead?.()
    await Promise.all(active)
  })
})

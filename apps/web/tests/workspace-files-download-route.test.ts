import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockGetAuthenticatedUser = vi.fn()
vi.mock("@/lib/auth", () => ({
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}))

const mockCreateWorkspaceAgentClient = vi.fn()
vi.mock("@/lib/workspace-agent/client", () => ({
  createWorkspaceAgentClient: (...args: unknown[]) =>
    mockCreateWorkspaceAgentClient(...args),
}))

type Role = "USER" | "ADMIN"

function session(slug: string, role: Role = "USER") {
  return {
    user: { id: "user-1", email: "alice@example.com", slug, role },
    sessionId: "session-1",
  }
}

async function callDownload(path: string, slug = "alice") {
  const { GET } = await import("@/app/api/w/[slug]/files/download/route")
  const request = new Request(
    `http://localhost/api/w/${slug}/files/download?path=${encodeURIComponent(path)}`
  )
  const response = await GET(request as never, { params: Promise.resolve({ slug }) })

  return {
    status: response.status,
    headers: response.headers,
    text: await response.text(),
  }
}

describe("workspace file download route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockCreateWorkspaceAgentClient.mockResolvedValue({
      baseUrl: "http://agent",
      authHeader: "Basic token",
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null)

    const response = await callDownload("notes.md")

    expect(response.status).toBe(401)
    expect(JSON.parse(response.text)).toEqual({ error: "unauthorized" })
  })

  it("rejects hidden or invalid paths", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session("alice"))

    const response = await callDownload(".arche/attachments/secret.txt")

    expect(response.status).toBe(400)
    expect(JSON.parse(response.text)).toEqual({ error: "invalid_path" })
  })

  it("downloads workspace file content with attachment headers", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session("alice"))

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            content: Buffer.from("# Notes\n").toString("base64"),
            encoding: "base64",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
    )

    const response = await callDownload("docs/notes.md")

    expect(response.status).toBe(200)
    expect(response.text).toBe("# Notes\n")
    expect(response.headers.get("Content-Type")).toBe("text/markdown")
    expect(response.headers.get("Content-Disposition")).toContain(
      'attachment; filename="notes.md"'
    )
  })

  it("returns 503 when the workspace agent is unavailable", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session("alice"))
    mockCreateWorkspaceAgentClient.mockResolvedValue(null)

    const response = await callDownload("notes.md")

    expect(response.status).toBe(503)
    expect(JSON.parse(response.text)).toEqual({ error: "instance_unavailable" })
  })

  it("returns 404 when the workspace agent cannot find the file", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session("alice"))

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: "not_found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      )
    )

    const response = await callDownload("missing.md")

    expect(response.status).toBe(404)
    expect(JSON.parse(response.text)).toEqual({ error: "not_found" })
  })

  it("returns 502 for invalid workspace agent file content", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session("alice"))

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, encoding: "utf-8" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    )

    const response = await callDownload("broken.txt")

    expect(response.status).toBe(502)
    expect(JSON.parse(response.text)).toEqual({ error: "invalid_file_content" })
  })

  it("returns 502 for unsupported workspace agent file encoding", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session("alice"))

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, content: "plain text", encoding: "latin1" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
    )

    const response = await callDownload("broken.txt")

    expect(response.status).toBe(502)
    expect(JSON.parse(response.text)).toEqual({ error: "invalid_file_content" })
  })

  it("downloads utf-8 file content with a sanitized fallback filename", async () => {
    mockGetAuthenticatedUser.mockResolvedValue(session("alice"))

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, content: "plain text", encoding: "utf-8" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    )

    const response = await callDownload("docs/report final.txt")

    expect(response.status).toBe(200)
    expect(response.text).toBe("plain text")
    expect(response.headers.get("Content-Type")).toBe("text/plain")
    expect(response.headers.get("Content-Disposition")).toContain(
      'filename="report-final.txt"'
    )
  })
})

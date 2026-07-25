import { workspaceAgentFetch } from "@/lib/workspace-agent-client"
import { createWorkspaceAgentClient } from "@/lib/workspace-agent/client"
import { isHiddenWorkspacePath } from "@/lib/workspace-paths"

export type WorkspaceAgentReadResponse = {
  ok: boolean
  content?: string
  encoding?: "utf-8" | "base64"
  error?: string
}

/**
 * Workspace reads come back either as UTF-8 or base64, so every consumer has to decode.
 * Keeping this next to readWorkspaceFile stops callers re-implementing it — or, worse,
 * forgetting to, and handing raw base64 downstream as if it were file content.
 */
export function decodeWorkspaceFileContent(
  data: Pick<WorkspaceAgentReadResponse, "content" | "encoding">,
): Buffer | null {
  if (typeof data.content !== "string") return null

  if (data.encoding === "base64") {
    try {
      return Buffer.from(data.content, "base64")
    } catch {
      return null
    }
  }

  if (data.encoding === "utf-8" || data.encoding === undefined) {
    return Buffer.from(data.content, "utf-8")
  }

  return null
}

/** Decodes a workspace read to text. Returns null when the payload is unusable. */
export function decodeWorkspaceFileText(
  data: Pick<WorkspaceAgentReadResponse, "content" | "encoding">,
): string | null {
  return decodeWorkspaceFileContent(data)?.toString("utf-8") ?? null
}

export function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

export function isValidWorkspacePath(
  path: string,
  opts?: { extension?: string },
): boolean {
  if (!path) return false
  if (isHiddenWorkspacePath(path)) return false
  if (opts?.extension && !path.endsWith(opts.extension)) return false
  return path.split("/").every((segment) => segment !== "..")
}

type ReadResult =
  | { ok: true; data: WorkspaceAgentReadResponse }
  | { ok: false; response: Response }

export async function readWorkspaceFile(
  slug: string,
  normalizedPath: string,
  signal?: AbortSignal,
): Promise<ReadResult> {
  const agent = await createWorkspaceAgentClient(slug)
  if (!agent) {
    return { ok: false, response: jsonResponse(503, { error: "instance_unavailable" }) }
  }

  const response = await workspaceAgentFetch<WorkspaceAgentReadResponse>(
    agent,
    "/files/read",
    { path: normalizedPath },
    { signal },
  )

  if (!response.ok) {
    return {
      ok: false,
      response: jsonResponse(response.status === 404 ? 404 : 502, { error: response.error }),
    }
  }

  return { ok: true, data: response.data }
}

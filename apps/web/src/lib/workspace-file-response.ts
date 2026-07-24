import { workspaceAgentFetch } from "@/lib/workspace-agent-client"
import { createWorkspaceAgentClient } from "@/lib/workspace-agent/client"
import { isHiddenWorkspacePath } from "@/lib/workspace-paths"

export type WorkspaceAgentReadResponse = {
  ok: boolean
  content?: string
  encoding?: "utf-8" | "base64"
  error?: string
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
): Promise<ReadResult> {
  const agent = await createWorkspaceAgentClient(slug)
  if (!agent) {
    return { ok: false, response: jsonResponse(503, { error: "instance_unavailable" }) }
  }

  const response = await workspaceAgentFetch<WorkspaceAgentReadResponse>(agent, "/files/read", {
    path: normalizedPath,
  })

  if (!response.ok) {
    return {
      ok: false,
      response: jsonResponse(response.status === 404 ? 404 : 502, { error: response.error }),
    }
  }

  return { ok: true, data: response.data }
}

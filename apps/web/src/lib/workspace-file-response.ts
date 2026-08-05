import {
  workspaceAgentFetch,
  type WorkspaceAgent,
} from "@/lib/workspace-agent-client"
import { createWorkspaceAgentClient } from "@/lib/workspace-agent/client"
import { isHiddenWorkspacePath } from "@/lib/workspace-paths"

export type WorkspaceAgentReadResponse = {
  ok: boolean
  content?: string
  encoding?: "utf-8" | "base64"
  error?: string
}

export type WorkspaceAgentListEntry = {
  modifiedAt: number
  name: string
  path: string
  size: number
  type: "directory" | "file"
}

type WorkspaceAgentListResponse = {
  entries?: WorkspaceAgentListEntry[]
  ok: boolean
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

export type WorkspaceFileReadResult =
  | { ok: true; data: WorkspaceAgentReadResponse }
  | { ok: false; response: Response }

export async function readWorkspaceFileFromAgent(
  agent: WorkspaceAgent,
  normalizedPath: string,
): Promise<WorkspaceFileReadResult> {
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

export async function readWorkspaceFile(
  slug: string,
  normalizedPath: string,
): Promise<WorkspaceFileReadResult> {
  const agent = await createWorkspaceAgentClient(slug)
  if (!agent) {
    return { ok: false, response: jsonResponse(503, { error: "instance_unavailable" }) }
  }

  return readWorkspaceFileFromAgent(agent, normalizedPath)
}

export type WorkspaceFileListResult =
  | { ok: true; entries: WorkspaceAgentListEntry[] }
  | { error: string; ok: false; response: Response }

export type WorkspaceFileListOptions = {
  markdownOnly?: boolean
  maxEntries?: number
}

export async function listWorkspaceFilesFromAgent(
  agent: WorkspaceAgent,
  normalizedPath: string,
  recursive: boolean,
  options?: WorkspaceFileListOptions,
): Promise<WorkspaceFileListResult> {
  const response = await workspaceAgentFetch<WorkspaceAgentListResponse>(
    agent,
    "/files/list",
    { path: normalizedPath, recursive, ...options },
  )

  if (!response.ok) {
    return {
      error: response.error,
      ok: false,
      response: jsonResponse(response.status === 404 ? 404 : 502, {
        error: response.error,
      }),
    }
  }

  return { ok: true, entries: response.data.entries ?? [] }
}

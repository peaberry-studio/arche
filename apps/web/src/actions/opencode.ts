"use server";

import { createInstanceClient, getInstanceUrl } from "@/lib/opencode/client";
import { extractTextContent, transformParts } from "@/lib/opencode/transform";
import type {
  AvailableModel,
  WorkspaceConnectionState,
  WorkspaceFileContent,
  WorkspaceFileNode,
  WorkspaceMessage,
  WorkspaceSession,
} from "@/lib/opencode/types";
import { getActiveCredentialForUser } from "@/lib/providers/store";
import { PROVIDERS, type ProviderId } from "@/lib/providers/types";
import { getSession } from "@/lib/runtime/session";
import { instanceService, userService } from "@/lib/services";
import { decryptPassword } from "@/lib/spawner/crypto";
import { createWorkspaceAgentClient } from "@/lib/workspace-agent/client";
import { deriveWorkspaceMessageRuntimeState } from "@/lib/workspace-message-state";
import {
  isHiddenWorkspacePath,
  isProtectedWorkspacePath,
} from "@/lib/workspace-paths";

const CREDENTIAL_REQUIRED_PROVIDER_IDS = new Set<ProviderId>([
  "openai",
  "anthropic",
  "fireworks",
  "openrouter",
]);

const PROVIDER_ID_ALIASES: Record<string, ProviderId> = {
  "fireworks-ai": "fireworks",
};

function normalizeProviderId(providerId: string): string {
  return PROVIDER_ID_ALIASES[providerId] ?? providerId;
}

function isFreeOpencodeModel(model: unknown): boolean {
  if (!model || typeof model !== "object" || Array.isArray(model)) {
    return false;
  }

  const cost = (model as { cost?: unknown }).cost;
  if (!cost || typeof cost !== "object" || Array.isArray(cost)) {
    return false;
  }

  const input = (cost as { input?: unknown }).input;
  const output = (cost as { output?: unknown }).output;

  return input === 0 && output === 0;
}

function normalizeMessageRole(
  role: unknown
): "user" | "assistant" | "system" | null {
  if (role === "user" || role === "assistant" || role === "system") {
    return role;
  }

  return null;
}

function extractUserTextContent(parts: ReturnType<typeof transformParts>): string {
  const firstText = parts.find((part) => part.type === "text");
  return firstText ? firstText.text : "";
}

async function getAuthorizedClient(slug: string) {
  const session = await getSession();
  if (!session) return { error: "unauthorized" as const, client: null };

  if (session.user.slug !== slug && session.user.role !== "ADMIN") {
    return { error: "forbidden" as const, client: null };
  }

  const client = await createInstanceClient(slug);
  if (!client) {
    return { error: "instance_unavailable" as const, client: null };
  }

  return { error: null, client };
}

// ============================================================================
// Connection & Health
// ============================================================================

export async function checkConnectionAction(
  slug: string
): Promise<WorkspaceConnectionState> {
  const { error, client } = await getAuthorizedClient(slug);
  if (error) {
    return { status: "error", error };
  }

  try {
    const health = await client!.global.health();
    if (health.data?.healthy) {
      return { status: "connected", version: health.data.version };
    }
    return { status: "error", error: "unhealthy" };
  } catch (e) {
    return {
      status: "error",
      error: e instanceof Error ? e.message : "unknown",
    };
  }
}

// ============================================================================
// Files
// ============================================================================

export async function listFilesAction(
  slug: string,
  path?: string
): Promise<{
  ok: boolean;
  files?: WorkspaceFileNode[];
  error?: string;
}> {
  const { error, client } = await getAuthorizedClient(slug);
  if (error) return { ok: false, error };

  try {
    const result = await client!.file.list({ path: path ?? "" });
    const files = result.data ?? [];

    // SDK returns a flat list of files/directories at the given path
    const transformed: WorkspaceFileNode[] = files
      .filter((f) => !f.ignored && !isHiddenWorkspacePath(f.path))
      .map((node) => ({
        id: node.path,
        name: node.name,
        path: node.path,
        type: node.type,
      }));

    return { ok: true, files: transformed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function readFileAction(
  slug: string,
  path: string
): Promise<{
  ok: boolean;
  content?: WorkspaceFileContent;
  error?: string;
}> {
  if (isProtectedWorkspacePath(path)) {
    return { ok: false, error: "protected_path" };
  }

  const { error, client } = await getAuthorizedClient(slug);
  if (error) return { ok: false, error };

  try {
    const result = await client!.file.read({ path });
    if (!result.data) {
      return { ok: false, error: "file_not_found" };
    }

    // Handle base64 encoded content
    let content = result.data.content;
    if (result.data.encoding === "base64") {
      content = Buffer.from(content, "base64").toString("utf-8");
    }

    return {
      ok: true,
      content: {
        path,
        content,
        type: result.data.type === "text" ? "raw" : "patch",
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function searchFilesAction(
  slug: string,
  query: string
): Promise<{
  ok: boolean;
  files?: string[];
  error?: string;
}> {
  const { error, client } = await getAuthorizedClient(slug);
  if (error) return { ok: false, error };

  try {
    const result = await client!.find.files({ query, limit: 50 });
    const files = (result.data ?? []).filter(
      (path) => !isHiddenWorkspacePath(path)
    );
    return { ok: true, files };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/**
 * Load the full file tree by recursively fetching directories.
 */
export async function loadFileTreeAction(
  slug: string,
  maxDepth = 4
): Promise<{
  ok: boolean;
  tree?: WorkspaceFileNode[];
  error?: string;
}> {
  const { error, client } = await getAuthorizedClient(slug);
  if (error) return { ok: false, error };

  try {
    async function loadDirectory(
      path: string,
      depth: number
    ): Promise<WorkspaceFileNode[]> {
      if (depth > maxDepth) return [];

      const result = await client!.file.list({ path });
      const items = result.data ?? [];

      const nodes: WorkspaceFileNode[] = [];

      for (const item of items) {
        if (item.ignored || isHiddenWorkspacePath(item.path)) continue;

        const node: WorkspaceFileNode = {
          id: item.path,
          name: item.name,
          path: item.path,
          type: item.type,
        };

        // Recursively load children for directories
        if (item.type === "directory") {
          const children = await loadDirectory(item.path, depth + 1);
          if (children.length > 0) {
            node.children = children;
          }
        }

        nodes.push(node);
      }

      // Sort: directories first, then alphabetically
      nodes.sort((a, b) => {
        if (a.type === "directory" && b.type === "file") return -1;
        if (a.type === "file" && b.type === "directory") return 1;
        return a.name.localeCompare(b.name);
      });

      return nodes;
    }

    const tree = await loadDirectory("", 0);
    return { ok: true, tree };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

// ============================================================================
// Sessions
// ============================================================================

/**
 * Format a timestamp (unix ms or Date) for display.
 */
function formatTimestamp(
  timestamp: number | Date | string | undefined
): string {
  if (!timestamp) return "";

  let d: Date;
  if (typeof timestamp === "number") {
    d = new Date(timestamp);
  } else if (typeof timestamp === "string") {
    d = new Date(timestamp);
  } else {
    d = timestamp;
  }

  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

export async function listSessionsAction(slug: string): Promise<{
  ok: boolean;
  sessions?: WorkspaceSession[];
  error?: string;
}> {
  const { error, client } = await getAuthorizedClient(slug);
  if (error) return { ok: false, error };

  try {
    const result = await client!.session.list();
    const sessions = result.data ?? [];

    // Get status for all sessions
    const statusResult = await client!.session.status();
    const statuses = statusResult.data ?? {};

    const transformed: WorkspaceSession[] = sessions.map((s) => {
      const sessionStatus = statuses[s.id];
      let status: "active" | "idle" | "busy" | "error" = "idle";
      if (sessionStatus?.type === "busy") status = "busy";
      else if (sessionStatus?.type === "retry") status = "busy";

      return {
        id: s.id,
        title: s.title || "Untitled",
        status,
        updatedAt: formatTimestamp(s.time?.updated),
        updatedAtRaw: typeof s.time?.updated === "number" ? s.time.updated : undefined,
        parentId: s.parentID,
        share: s.share ? { url: s.share.url, version: 1 } : undefined,
      };
    });

    return { ok: true, sessions: transformed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function createSessionAction(
  slug: string,
  title?: string
): Promise<{
  ok: boolean;
  session?: WorkspaceSession;
  error?: string;
}> {
  const { error, client } = await getAuthorizedClient(slug);
  if (error) return { ok: false, error };

  try {
    const result = await client!.session.create({ title });
    if (!result.data) {
      return { ok: false, error: "create_failed" };
    }

    const s = result.data;
    return {
      ok: true,
      session: {
        id: s.id,
        title: s.title || "Untitled",
        status: "active",
        updatedAt: formatTimestamp(s.time?.updated),
        updatedAtRaw: typeof s.time?.updated === "number" ? s.time.updated : undefined,
        parentId: s.parentID,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function deleteSessionAction(
  slug: string,
  sessionId: string
): Promise<{
  ok: boolean;
  error?: string;
}> {
  const { error, client } = await getAuthorizedClient(slug);
  if (error) return { ok: false, error };

  try {
    await client!.session.delete({ sessionID: sessionId });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function updateSessionAction(
  slug: string,
  sessionId: string,
  title: string
): Promise<{
  ok: boolean;
  session?: WorkspaceSession;
  error?: string;
}> {
  const { error, client } = await getAuthorizedClient(slug);
  if (error) return { ok: false, error };

  try {
    const result = await client!.session.update({
      sessionID: sessionId,
      title,
    });
    if (!result.data) {
      return { ok: false, error: "update_failed" };
    }

    const s = result.data;
    return {
      ok: true,
      session: {
        id: s.id,
        title: s.title || "Untitled",
        status: "idle",
        updatedAt: formatTimestamp(s.time?.updated),
        updatedAtRaw: typeof s.time?.updated === "number" ? s.time.updated : undefined,
        parentId: s.parentID,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

// ============================================================================
// Messages
// ============================================================================

export async function listMessagesAction(
  slug: string,
  sessionId: string
): Promise<{
  ok: boolean;
  messages?: WorkspaceMessage[];
  error?: string;
}> {
  const { error, client } = await getAuthorizedClient(slug);
  if (error) return { ok: false, error };

  try {
    const result = await client!.session.messages({ sessionID: sessionId });
    const messages = result.data ?? [];

    let sessionRuntimeStatus: "busy" | "idle" | "unknown" = "unknown";
    try {
      const statusResult = await client!.session.status();
      const statuses = (statusResult.data ?? {}) as Record<
        string,
        { type?: string } | undefined
      >;
      const sessionStatus = statuses[sessionId]?.type;
      if (sessionStatus === "busy" || sessionStatus === "retry") {
        sessionRuntimeStatus = "busy";
      } else if (sessionStatus === "idle") {
        sessionRuntimeStatus = "idle";
      }
    } catch {
      // Keep unknown status when status endpoint fails.
    }

    const transformed: WorkspaceMessage[] = [];
    for (const m of messages) {
      const role = normalizeMessageRole(m.info.role);
      if (!role) continue;

      const parts = transformParts(m.parts ?? []);
      const rawTimestamp = m.info.time?.created;
      const completedAt = (m.info.time as { completed?: number } | undefined)
        ?.completed;
      const runtimeState = deriveWorkspaceMessageRuntimeState({
        role,
        completedAt,
        parts,
        sessionStatus: sessionRuntimeStatus,
      });
      const info = m.info as Record<string, unknown>;
      const infoModel = info.model as Record<string, unknown> | undefined;
      const providerId =
        typeof info.providerID === "string"
          ? info.providerID
          : typeof infoModel?.providerID === "string"
          ? infoModel.providerID
          : undefined;
      const modelId =
        typeof info.modelID === "string"
          ? info.modelID
          : typeof infoModel?.modelID === "string"
          ? infoModel.modelID
          : undefined;
      const agentId = typeof info.agent === "string" ? info.agent : undefined;

      transformed.push({
        id: m.info.id,
        sessionId,
        role,
        agentId,
        model: providerId && modelId ? { providerId, modelId } : undefined,
        content:
          role === "user" ? extractUserTextContent(parts) : extractTextContent(parts),
        timestamp: formatTimestamp(rawTimestamp),
        timestampRaw:
          typeof rawTimestamp === "number" ? rawTimestamp : undefined,
        parts,
        pending: runtimeState.pending,
        statusInfo: runtimeState.statusInfo,
      });
    }

    return { ok: true, messages: transformed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function sendMessageAction(
  slug: string,
  sessionId: string,
  text: string,
  model?: { providerId: string; modelId: string }
): Promise<{
  ok: boolean;
  message?: WorkspaceMessage;
  error?: string;
}> {
  console.log("[sendMessageAction] Called with:", {
    slug,
    sessionId,
    text: text.substring(0, 50),
    model,
  });

  // Verify user is authorized
  const session = await getSession();
  if (!session) {
    return { ok: false, error: "unauthorized" };
  }
  if (session.user.slug !== slug && session.user.role !== "ADMIN") {
    return { ok: false, error: "forbidden" };
  }

  try {
    // Get credentials for direct fetch (bypassing SDK due to streaming issues)
    const instance = await instanceService.findCredentialsBySlug(slug);

    if (
      !instance ||
      !instance.serverPassword ||
      instance.status !== "running"
    ) {
      console.log("[sendMessageAction] Instance unavailable:", {
        hasInstance: !!instance,
        hasPassword: !!instance?.serverPassword,
        status: instance?.status,
      });
      return { ok: false, error: "instance_unavailable" };
    }

    const password = decryptPassword(instance.serverPassword);
    const authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString(
      "base64"
    )}`;
    const baseUrl = getInstanceUrl(slug);

    console.log(
      "[sendMessageAction] Sending to:",
      `${baseUrl}/session/${sessionId}/message`
    );

    const body = {
      parts: [{ type: "text", text }],
      model: model
        ? { providerID: model.providerId, modelID: model.modelId }
        : undefined,
    };

    const response = await fetch(`${baseUrl}/session/${sessionId}/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { ok: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    // Response is JSON with { info, parts } structure
    const responseText = await response.text();

    let messageId = "";
    let textContent = "";

    try {
      const data = JSON.parse(responseText);
      messageId = data.info?.id || `msg-${Date.now()}`;

      // Extract text from parts array
      if (Array.isArray(data.parts)) {
        for (const part of data.parts) {
          if (part.type === "text" && part.text) {
            textContent += part.text;
          }
        }
      }

      console.log(
        "[sendMessageAction] Extracted text:",
        textContent.substring(0, 100)
      );
    } catch {
      // If not valid JSON, maybe it's streaming format (NDJSON)
      console.log("[sendMessageAction] JSON parse failed, trying NDJSON");
      const lines = responseText.split("\n");

      for (const line of lines) {
        if (line.trim().startsWith("{")) {
          try {
            const event = JSON.parse(line);
            if (event.messageID && !messageId) {
              messageId = event.messageID;
            }
            if (event.type === "text" && event.text) {
              textContent += event.text;
            }
          } catch {
            // Not JSON, might be plain text
            if (line.trim()) textContent += line + "\n";
          }
        } else if (line.trim()) {
          textContent += line + "\n";
        }
      }
      textContent = textContent.trim();
    }

    const m = {
      info: {
        id: messageId,
        role: "assistant" as const,
        time: { created: Date.now() },
      },
      parts: [{ type: "text", text: textContent }],
    };

    const parts = transformParts(m.parts ?? []);

    return {
      ok: true,
      message: {
        id: m.info.id,
        sessionId,
        role: m.info.role as "user" | "assistant",
        content: extractTextContent(parts),
        timestamp: formatTimestamp(m.info.time?.created),
        parts,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function abortSessionAction(
  slug: string,
  sessionId: string
): Promise<{
  ok: boolean;
  error?: string;
}> {
  const { error, client } = await getAuthorizedClient(slug);
  if (error) return { ok: false, error };

  try {
    await client!.session.abort({ sessionID: sessionId });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

// ============================================================================
// Diffs
// ============================================================================

type GitDiffEntry = {
  path: string;
  status: "modified" | "added" | "deleted";
  additions: number;
  deletions: number;
  diff: string;
  conflicted: boolean;
};

export async function getWorkspaceDiffsAction(slug: string): Promise<{
  ok: boolean;
  diffs?: GitDiffEntry[];
  error?: string;
}> {
  const session = await getSession();
  if (!session) return { ok: false, error: "unauthorized" };

  if (session.user.slug !== slug && session.user.role !== "ADMIN") {
    return { ok: false, error: "forbidden" };
  }

  const agent = await createWorkspaceAgentClient(slug);
  if (!agent) return { ok: false, error: "instance_unavailable" };

  try {
    const response = await fetch(`${agent.baseUrl}/git/diffs`, {
      headers: {
        Authorization: agent.authHeader,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        ok: false,
        error: `workspace_agent_http_${response.status}: ${errorText}`,
      };
    }

    const data = (await response.json()) as {
      ok: boolean;
      diffs?: GitDiffEntry[];
      error?: string;
    };
    if (!data.ok) {
      return { ok: false, error: data.error ?? "workspace_agent_error" };
    }

    const diffs = (data.diffs ?? []).filter(
      (diff) => !isHiddenWorkspacePath(diff.path)
    );

    return { ok: true, diffs };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "workspace_agent_unreachable",
    };
  }
}

export async function getSessionDiffsAction(
  slug: string,
  sessionId: string
): Promise<{
  ok: boolean;
  diffs?: Array<{
    path: string;
    status: "modified" | "added" | "deleted";
    additions: number;
    deletions: number;
    diff: string;
  }>;
  error?: string;
}> {
  const { error, client } = await getAuthorizedClient(slug);
  if (error) return { ok: false, error };

  try {
    const result = await client!.session.diff({ sessionID: sessionId });
    const diffs = result.data ?? [];

    return {
      ok: true,
      diffs: diffs.map((d) => {
        // Determine status based on before/after content
        let status: "modified" | "added" | "deleted" = "modified";
        if (!d.before || d.before === "") status = "added";
        else if (!d.after || d.after === "") status = "deleted";

        // Generate unified diff format
        const diff = `--- a/${d.file}\n+++ b/${d.file}\n${generateUnifiedDiff(
          d.before,
          d.after
        )}`;

        return {
          path: d.file,
          status,
          additions: d.additions,
          deletions: d.deletions,
          diff,
        };
      }),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/**
 * Generate a simple unified diff representation.
 */
function generateUnifiedDiff(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  // Simple line-by-line diff for display
  const lines: string[] = [];
  const maxLines = Math.max(beforeLines.length, afterLines.length);

  for (let i = 0; i < maxLines; i++) {
    const beforeLine = beforeLines[i];
    const afterLine = afterLines[i];

    if (beforeLine === afterLine) {
      if (beforeLine !== undefined) lines.push(` ${beforeLine}`);
    } else {
      if (beforeLine !== undefined) lines.push(`-${beforeLine}`);
      if (afterLine !== undefined) lines.push(`+${afterLine}`);
    }
  }

  return lines.join("\n");
}

// ============================================================================
// Providers & Models
// ============================================================================

export async function listModelsAction(slug: string): Promise<{
  ok: boolean;
  models?: AvailableModel[];
  error?: string;
}> {
  const session = await getSession();
  if (!session) return { ok: false, error: "unauthorized" };

  if (session.user.slug !== slug && session.user.role !== "ADMIN") {
    return { ok: false, error: "forbidden" };
  }

  const ownerUserId =
    session.user.slug === slug
      ? session.user.id
      : (await userService.findIdBySlug(slug))?.id;

  if (!ownerUserId) {
    return { ok: false, error: "user_not_found" };
  }

  const client = await createInstanceClient(slug);
  if (!client) return { ok: false, error: "instance_unavailable" };

  const enabledProviderIds = new Set<ProviderId>();
  for (const providerId of PROVIDERS) {
    const credential = await getActiveCredentialForUser({
      userId: ownerUserId,
      providerId,
    });
    if (credential) enabledProviderIds.add(providerId);
  }

  try {
    const result = await client.config.providers();
    const data = result.data;
    if (!data) return { ok: true, models: [] };

    const { providers, default: defaults } = data;
    const models: AvailableModel[] = [];

    const hasOpencodeCredential = enabledProviderIds.has("opencode");

    for (const provider of providers ?? []) {
      const providerId = String(provider.id);
      const normalizedProviderId = normalizeProviderId(providerId);

      // OpenCode Zen can be available via native workspace auth even without
      // an Arche-managed API credential.
      if (
        CREDENTIAL_REQUIRED_PROVIDER_IDS.has(normalizedProviderId as ProviderId) &&
        !enabledProviderIds.has(normalizedProviderId as ProviderId)
      ) {
        continue;
      }

      // Models is an object with modelId as key
      const providerModels = provider.models ?? {};
      for (const [modelId, model] of Object.entries(providerModels)) {
        if (
          normalizedProviderId === "opencode" &&
          !hasOpencodeCredential &&
          !isFreeOpencodeModel(model)
        ) {
          continue;
        }

        const isDefault = defaults?.[providerId] === modelId;
        models.push({
          providerId,
          providerName: provider.name,
          modelId,
          modelName: model.name ?? modelId,
          isDefault,
        });
      }
    }

    // Sort: defaults first, then by provider name
    models.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.providerName.localeCompare(b.providerName);
    });

    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

// ============================================================================
// Agents
// ============================================================================

export async function listAgentsAction(slug: string): Promise<{
  ok: boolean;
  agents?: Array<{ id: string; name: string; description?: string }>;
  error?: string;
}> {
  const { error, client } = await getAuthorizedClient(slug);
  if (error) return { ok: false, error };

  try {
    const result = await client!.app.agents();
    const agents = result.data ?? [];

    return {
      ok: true,
      agents: agents.map((a) => ({
        id: a.name, // Agent uses name as id
        name: a.name,
        description: a.description,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

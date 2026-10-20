"use server";

import { createFlowActorScope } from "@/lib/flows/authorization";
import { formatTimestamp } from "@/lib/format-timestamp";
import type { HarnessPermission, HarnessRuntime, HarnessSession, HarnessSessionStatus } from "@/lib/harness/contract";
import { EXECUTION_TERMINATION_UNCONFIRMED_ERROR } from "@/lib/harness/errors";
import { abortSessionFamilyAndConfirmIdle } from "@/lib/harness/execution";
import {
  getRuntimeForSlug,
  listWorkspaceFiles,
  readWorkspaceFile,
  searchWorkspaceFiles,
} from "@/lib/harness/registry";
import { isLearningSessionTitle } from "@/lib/learning/session-title";
import {
  getCanonicalProviderId,
  providerRequiresCredential,
} from "@/lib/providers/catalog";
import { getEnabledProviderIdsForUser } from "@/lib/providers/store";
import { getSession } from "@/lib/runtime/session";
import { flowService, messageRunService, slackService, userService } from "@/lib/services";
import { createWorkspaceAgentClient } from "@/lib/workspace-agent/client";
import {
  isHiddenWorkspacePath,
  isProtectedWorkspacePath,
  normalizeWorkspacePath,
} from "@/lib/workspace-paths";
import type { WorkspaceFileContent, WorkspaceFileNode } from "@/types/workspace";
import type {
  AvailableModel,
  WorkspaceConnectionState,
  WorkspaceMessage,
  WorkspaceSession,
} from "@/types/workspace-runtime";

const CONNECTION_HEALTH_TIMEOUT_MS = 5_000;

async function getAuthorizedClientContext(slug: string) {
  const session = await getSession();
  if (!session) return { error: "unauthorized" as const, client: null };

  if (session.user.slug !== slug && session.user.role !== "ADMIN") {
    return { error: "forbidden" as const, client: null };
  }

  const result = await getRuntimeForSlug(slug);
  if (!result.ok) return { error: result.error.code, client: null };
  return { error: null, client: result.data, session };
}

async function getAuthorizedClient(slug: string) {
  const { error, client } = await getAuthorizedClientContext(slug);
  return { error, client };
}

async function authorizeWorkspaceFiles(slug: string) {
  const session = await getSession();
  if (!session) return { error: "unauthorized" as const };
  if (session.user.slug !== slug && session.user.role !== "ADMIN") {
    return { error: "forbidden" as const };
  }
  return { error: null };
}

async function getAuthorizedWorkspaceUserId(slug: string): Promise<
  | { ok: true; userId: string }
  | { ok: false; error: "unauthorized" | "forbidden" | "user_not_found" }
> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: "unauthorized" };
  }

  if (session.user.slug !== slug && session.user.role !== "ADMIN") {
    return { ok: false, error: "forbidden" };
  }

  if (session.user.slug === slug) {
    return { ok: true, userId: session.user.id };
  }

  const targetUser = await userService.findIdBySlug(slug);
  if (!targetUser) {
    return { ok: false, error: "user_not_found" };
  }

  return { ok: true, userId: targetUser.id };
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
    const health = await client!.health({
      signal: AbortSignal.timeout(CONNECTION_HEALTH_TIMEOUT_MS),
    });
    if (health.ok) {
      return { status: "connected", version: health.data.version ?? "unknown" };
    }
    return { status: "error", error: health.error.code === "healthcheck_timeout" ? "health_check_timeout" : health.error.code === "unhealthy_response" ? "unhealthy" : health.error.code };
  } catch (e) {
    const timedOut = e instanceof Error && (
      e.name === "TimeoutError" ||
      (e.name === "AbortError" && e.message.toLowerCase().includes("timeout"))
    );
    return {
      status: "error",
      error: timedOut ? "health_check_timeout" : e instanceof Error ? e.message : "unknown",
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
  const { error } = await authorizeWorkspaceFiles(slug);
  if (error) return { ok: false, error };

  try {
    const result = await listWorkspaceFiles(slug, path ?? "");
    if (!result.ok) return { ok: false, error: result.error.detail ?? result.error.code };
    return { ok: true, files: result.data };
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
  const safePath = normalizeWorkspacePath(path);
  if (!safePath || safePath.split("/").some((s) => s === "..") || isProtectedWorkspacePath(safePath)) {
    return { ok: false, error: "protected_path" };
  }

  const { error } = await authorizeWorkspaceFiles(slug);
  if (error) return { ok: false, error };

  try {
    const result = await readWorkspaceFile(slug, safePath);
    if (!result.ok) return { ok: false, error: result.error.detail ?? result.error.code };
    return { ok: true, content: result.data };
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
  const { error } = await authorizeWorkspaceFiles(slug);
  if (error) return { ok: false, error };

  try {
    const result = await searchWorkspaceFiles(slug, query);
    if (!result.ok) return { ok: false, error: result.error.detail ?? result.error.code };
    return { ok: true, files: result.data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/**
 * Load the full file tree by recursively fetching directories.
 */
export async function loadFileTreeAction(
  slug: string,
  maxDepth = 10
): Promise<{
  ok: boolean;
  tree?: WorkspaceFileNode[];
  error?: string;
}> {
  const { error } = await authorizeWorkspaceFiles(slug);
  if (error) return { ok: false, error };

  try {
    async function loadDirectory(
      path: string,
      depth: number
    ): Promise<WorkspaceFileNode[]> {
      if (depth > maxDepth) return [];

      const result = await listWorkspaceFiles(slug, path);
      if (!result.ok) throw new Error(result.error.detail ?? result.error.code);
      const items = result.data;

      const nodes: WorkspaceFileNode[] = [];

      for (const item of items) {
        if (isHiddenWorkspacePath(item.path)) continue;

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

type WorkspaceSessionListEntry = {
  id: string;
  parentId?: string;
  share?: WorkspaceSession["share"];
  title: string;
  updatedAtRaw?: number;
};

type ListWorkspaceSessionsOptions = {
  limit?: number;
  query?: string;
  rootsOnly?: boolean;
  start?: number;
};

type ListWorkspaceSessionsResult = {
  ok: boolean;
  sessions?: WorkspaceSession[];
  hasMore?: boolean;
  error?: string;
};

type ListWorkspaceSessionFamilyResult = {
  ok: boolean;
  rootSessionId?: string | null;
  sessions?: WorkspaceSession[];
  error?: string;
};

function toListSessionStatus(status: HarnessSessionStatus | undefined): "idle" | "error" {
  return status?.type === "retry" && status.terminalError ? "error" : "idle";
}

function toWorkspaceSessions(
  sessions: WorkspaceSessionListEntry[],
  statuses: Record<string, HarnessSessionStatus>,
  flowBySessionId: Map<string, Awaited<ReturnType<typeof flowService.findSessionMetadataForWorkspace>>[number]>,
): WorkspaceSession[] {
  return sessions.map((session) => {
    const flow = flowBySessionId.get(session.id);

    return {
      id: session.id,
      title: session.title || "Untitled",
      status: toListSessionStatus(statuses[session.id]),
      updatedAt: formatTimestamp(session.updatedAtRaw),
      updatedAtRaw: session.updatedAtRaw,
      parentId: session.parentId,
      flow: flow
        ? {
            flowId: flow.flowId,
            flowName: flow.flowName,
            runId: flow.runId,
            status: flow.status,
            trigger: flow.trigger,
            hasUnseenResult: flow.hasUnseenResult,
          }
        : undefined,
      share: session.share,
    };
  });
}

function mapApiSession(session: HarnessSession): WorkspaceSessionListEntry {
  return {
    id: session.id,
    parentId: session.parentId,
    share: session.share,
    title: session.title || "Untitled",
    updatedAtRaw: session.updatedAtRaw,
  };
}

function compareSessionListEntries(
  left: WorkspaceSessionListEntry,
  right: WorkspaceSessionListEntry,
): number {
  const rightUpdatedAt = right.updatedAtRaw ?? 0;
  const leftUpdatedAt = left.updatedAtRaw ?? 0;

  if (rightUpdatedAt !== leftUpdatedAt) {
    return rightUpdatedAt - leftUpdatedAt;
  }

  return right.id.localeCompare(left.id);
}

async function getWorkspaceSessionMetadata(
  slug: string,
  client: HarnessRuntime,
  sessionIds: string[],
) {
  const [statusResult, workspaceUser] = await Promise.all([
    client.sessionStatus(),
    getAuthorizedWorkspaceUserId(slug),
  ]);
  const statuses = statusResult.ok ? statusResult.data : {};
  const targetUserId = workspaceUser.ok ? workspaceUser.userId : null;
  const flowMetadata = targetUserId
    ? await flowService.findSessionMetadataForWorkspace(targetUserId, sessionIds)
    : [];

  return {
    flowBySessionId: new Map(
      flowMetadata.map((entry) => [entry.openCodeSessionId, entry]),
    ),
    statuses,
  };
}

async function listWorkspaceSessionsFromApi(
  slug: string,
  client: HarnessRuntime,
  options: ListWorkspaceSessionsOptions,
): Promise<ListWorkspaceSessionsResult> {
  const query = options.query?.trim().toLowerCase();
  const requestedLimit =
    typeof options.limit === "number" && Number.isFinite(options.limit)
      ? Math.max(1, Math.trunc(options.limit))
      : undefined;
  const requestedStart =
    typeof options.start === "number" && Number.isFinite(options.start)
      ? Math.trunc(options.start)
      : undefined;
  const result = await client.listSessions({
    limit: query ? Math.min(requestedLimit ?? 100, 100) : requestedLimit,
    rootsOnly: options.rootsOnly ? true : undefined,
    start: requestedStart,
  });
  if (!result.ok) return { ok: false, error: result.error.code };
  const rawSessions = result.data;
  const sessions = rawSessions.map(mapApiSession).filter((session) => !isLearningSessionTitle(session.title));
  const metadata = await getWorkspaceSessionMetadata(slug, client, sessions.map((session) => session.id));
  const workspaceSessions = toWorkspaceSessions(sessions, metadata.statuses, metadata.flowBySessionId);

  if (query) {
    const filteredSessions = workspaceSessions.filter((session) => {
      const title = session.title.toLowerCase();
      const flowName = session.flow?.flowName.toLowerCase() ?? "";
      return title.includes(query) || flowName.includes(query);
    });

    return {
      ok: true,
      hasMore: false,
      sessions: filteredSessions.slice(0, 20),
    };
  }

  return {
    ok: true,
    // Use the pre-filter count: a page whose tail was filtered out (hidden
    // learning sessions) can still have more results upstream.
    hasMore: requestedLimit ? rawSessions.length >= requestedLimit : false,
    sessions: workspaceSessions,
  };
}

async function getWorkspaceSessionById(
  client: HarnessRuntime,
  sessionId: string,
): Promise<HarnessSession | null> {
  const result = await client.getSession(sessionId);
  if (!result.ok) {
    if (result.error.code === "session_not_found") return null;
    throw new Error(result.error.code);
  }
  return result.data;
}

async function listWorkspaceSessionFamilyFromApi(
  client: HarnessRuntime,
  sessionId: string,
): Promise<{
  rootSessionId: string | null;
  sessions: WorkspaceSessionListEntry[];
}> {
  const target = await getWorkspaceSessionById(client, sessionId);
  if (!target) {
    return { rootSessionId: null, sessions: [] };
  }

  const sessionsById = new Map<string, HarnessSession>([[target.id, target]]);
  const visitedAncestorIds = new Set<string>();
  let root = target;
  let current: HarnessSession | null = target;

  while (current) {
    if (visitedAncestorIds.has(current.id)) {
      break;
    }

    visitedAncestorIds.add(current.id);
    sessionsById.set(current.id, current);
    root = current;

    if (!current.parentId) {
      break;
    }

    current = await getWorkspaceSessionById(client, current.parentId);
  }

  const queue: string[] = [root.id];
  const visitedFamilyIds = new Set<string>([root.id]);

  while (queue.length > 0) {
    const parentId = queue.shift();
    if (!parentId) {
      continue;
    }

    const childrenResult = await client.listChildren(parentId);
    if (!childrenResult.ok) throw new Error(childrenResult.error.code);
    const children = childrenResult.data;

    for (const child of children) {
      if (visitedFamilyIds.has(child.id)) {
        continue;
      }

      visitedFamilyIds.add(child.id);
      sessionsById.set(child.id, child);
      queue.push(child.id);
    }
  }

  return {
    rootSessionId: root.id,
    sessions: Array.from(sessionsById.values())
      .map(mapApiSession)
      .sort(compareSessionListEntries),
  };
}

export async function listSessionsAction(
  slug: string,
  options: ListWorkspaceSessionsOptions = {},
): Promise<ListWorkspaceSessionsResult> {
  const { error, client } = await getAuthorizedClientContext(slug);
  if (error) return { ok: false, error };

  try {
    return await listWorkspaceSessionsFromApi(slug, client!, options);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function listSessionFamilyAction(
  slug: string,
  sessionId: string,
): Promise<ListWorkspaceSessionFamilyResult> {
  const { error, client } = await getAuthorizedClientContext(slug);
  if (error) return { ok: false, error };

  try {
    const family = await listWorkspaceSessionFamilyFromApi(client!, sessionId);
    if (!family.rootSessionId) {
      return { ok: false, error: "not_found" };
    }

    const metadata = await getWorkspaceSessionMetadata(slug, client!, family.sessions.map((session) => session.id));

    return {
      ok: true,
      rootSessionId: family.rootSessionId,
      sessions: toWorkspaceSessions(family.sessions, metadata.statuses, metadata.flowBySessionId),
    };
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
    const result = await client!.createSession({ title });
    if (!result.ok) return { ok: false, error: result.error.code };

    const s = result.data;
    return {
      ok: true,
      session: {
        id: s.id,
        title: s.title || "Untitled",
        status: "active",
        updatedAt: s.updatedAt,
        updatedAtRaw: s.updatedAtRaw,
        parentId: s.parentId,
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
    const result = await client!.deleteSession(sessionId);
    if (!result.ok) return { ok: false, error: result.error.code };
    await slackService.deleteSessionBindingsByOpenCodeSessionId(sessionId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function markFlowRunSeenAction(
  slug: string,
  runId: string,
): Promise<{
  ok: boolean;
  error?: string;
}> {
  const workspaceUser = await getAuthorizedWorkspaceUserId(slug);
  if (!workspaceUser.ok) {
    return { ok: false, error: workspaceUser.error };
  }

  const marked = await flowService.markRunResultSeenByIdForScope(
    runId,
    createFlowActorScope({ id: workspaceUser.userId, role: "USER" }, workspaceUser.userId),
    new Date(),
  );

  return marked
    ? { ok: true }
    : { ok: false, error: "not_found" };
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
    const result = await client!.updateSession(sessionId, title);
    if (!result.ok) return { ok: false, error: result.error.code };

    const s = result.data;
    return {
      ok: true,
      session: {
        id: s.id,
        title: s.title || "Untitled",
        status: "idle",
        updatedAt: s.updatedAt,
        updatedAtRaw: s.updatedAtRaw,
        parentId: s.parentId,
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
  sessionRuntimeStatus?: "busy" | "idle" | "unknown";
  error?: string;
}> {
  const { error, client } = await getAuthorizedClient(slug);
  if (error) return { ok: false, error };

  try {
    const result = await client!.listMessages(sessionId);
    if (!result.ok) return { ok: false, error: result.error.code };

    let sessionRuntimeStatus: "busy" | "idle" | "unknown" = "unknown";
    try {
      const statusResult = await client!.sessionStatus();
      const statuses = statusResult.ok ? statusResult.data : {};
      const sessionStatus = statuses[sessionId]?.type;
      if (sessionStatus === "busy" || sessionStatus === "retry") {
        sessionRuntimeStatus = "busy";
      } else if (sessionStatus === "idle") {
        sessionRuntimeStatus = "idle";
      }
    } catch {
      // Keep unknown status when status endpoint fails.
    }

    return { ok: true, messages: result.data, sessionRuntimeStatus };
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
  const { error, client } = await getAuthorizedClient(slug);
  if (error) return { ok: false, error };

  try {
    const result = await client!.sendMessage({
      sessionId,
      parts: [{ type: "text", text }],
      model,
    });
    if (!result.ok) return { ok: false, error: result.error.code };
    return { ok: true, message: result.data };
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
    const terminated = await abortSessionFamilyAndConfirmIdle({
      client: client!,
      rootSessionId: sessionId,
    });
    if (!terminated) {
      return { ok: false, error: EXECUTION_TERMINATION_UNCONFIRMED_ERROR };
    }
    await messageRunService.abortActiveRun(slug, sessionId).catch(() => undefined);
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
    const result = await client!.sessionDiff(sessionId);
    if (!result.ok) return { ok: false, error: result.error.code };
    return { ok: true, diffs: result.data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

// ============================================================================
// Permissions
// ============================================================================

export async function listPermissionsAction(
  slug: string,
): Promise<{
  ok: boolean;
  permissions?: Record<string, HarnessPermission[]>;
  error?: string;
}> {
  const { error, client } = await getAuthorizedClient(slug);
  if (error) return { ok: false, error };

  try {
    const result = await client!.listPermissions();
    if (!result.ok) return { ok: false, error: result.error.code };
    const grouped: Record<string, HarnessPermission[]> = {};
    for (const permission of result.data) {
      const sessionId = permission.sessionId;
      grouped[sessionId] = [...(grouped[sessionId] ?? []), permission];
    }
    return { ok: true, permissions: grouped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
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

  const runtimeResult = await getRuntimeForSlug(slug);
  if (!runtimeResult.ok) return { ok: false, error: runtimeResult.error.code };

  const enabledProviderIds = await getEnabledProviderIdsForUser(ownerUserId);

  try {
    const result = await runtimeResult.data.listModels();
    if (!result.ok) return { ok: false, error: result.error.code };
    const models: AvailableModel[] = result.data.filter((model) => {
      const providerId = getCanonicalProviderId(model.providerId);
      if (providerId && providerRequiresCredential(providerId) && !enabledProviderIds.has(providerId)) return false;
      return model.providerId !== "opencode" || enabledProviderIds.has("opencode") ||
        (model.cost?.input === 0 && model.cost.output === 0);
    }).map(({ providerId, providerName, modelId, modelName, isDefault }) => ({
      providerId, providerName, modelId, modelName, isDefault,
    }));

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
    const result = await client!.listAgents();
    if (!result.ok) return { ok: false, error: result.error.code };
    return { ok: true, agents: result.data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

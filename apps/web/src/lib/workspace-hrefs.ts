type WorkspaceHrefOptions = {
  mode?: "chat" | "explore" | "flows" | "knowledge";
  sessionId?: string | null;
  settings?: string | null;
  path?: string | null;
};

export function getWorkspaceHref(slug: string, options: WorkspaceHrefOptions = {}): string {
  const mode = options.mode ?? (options.path ? "explore" : undefined);

  // Explore is a dedicated page, not a workspace mode.
  if (mode === "explore") {
    const params = new URLSearchParams();
    if (options.path) params.set("path", options.path);
    const query = params.toString();
    return query ? `/w/${slug}/explore?${query}` : `/w/${slug}/explore`;
  }

  const params = new URLSearchParams();

  if (mode && mode !== "chat") {
    params.set("mode", mode);
  }

  if (options.sessionId) {
    params.set("session", options.sessionId);
  }

  if (options.settings) {
    params.set("settings", options.settings);
  }

  if (options.path) {
    params.set("path", options.path);
  }

  const query = params.toString();
  return query ? `/w/${slug}?${query}` : `/w/${slug}`;
}

export type WorkspaceFlowsView = "list" | "new" | "edit" | "runs";

export const WORKSPACE_FLOWS_VIEWS: readonly WorkspaceFlowsView[] = ["list", "new", "edit", "runs"];

export function getWorkspaceFlowsHref(
  slug: string,
  view: WorkspaceFlowsView,
  flowId?: string | null,
  sessionId?: string | null,
): string {
  const params = new URLSearchParams();
  if (sessionId) params.set("session", sessionId);
  params.set("flows", view);
  if (flowId) params.set("flowId", flowId);
  return `/w/${slug}?${params.toString()}`;
}

export type WorkspaceCatalogType = "agents" | "skills";

export function getWorkspaceCatalogHref(
  slug: string,
  catalog: WorkspaceCatalogType,
  item?: string | null,
): string {
  const params = new URLSearchParams({ catalog });
  const itemParam = catalog === "agents" ? "agent" : "skill";
  if (item) params.set(itemParam, item);
  return `/w/${slug}?${params.toString()}`;
}

export type WorkspaceIntegrationId = "slack" | "mcp" | "google-workspace" | "kb-github-remote";

export function getWorkspaceIntegrationHref(
  slug: string,
  integrationId: WorkspaceIntegrationId,
): string {
  return `/w/${slug}?settings=integrations&integration=${integrationId}`;
}

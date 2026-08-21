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

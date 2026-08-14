type WorkspaceHrefOptions = {
  mode?: "chat" | "explore" | "flows" | "knowledge";
  sessionId?: string | null;
  settings?: string | null;
  path?: string | null;
};

export function getWorkspaceHref(slug: string, options: WorkspaceHrefOptions = {}): string {
  const params = new URLSearchParams();
  const mode = options.mode ?? (options.path ? "explore" : undefined);

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

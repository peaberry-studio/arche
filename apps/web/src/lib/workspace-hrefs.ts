type WorkspaceHrefOptions = {
  mode?: "chat" | "knowledge" | "tasks";
  sessionId?: string | null;
  settings?: string | null;
};

export function getWorkspaceHref(slug: string, options: WorkspaceHrefOptions = {}): string {
  const params = new URLSearchParams();

  if (options.mode && options.mode !== "chat") {
    params.set("mode", options.mode);
  }

  if (options.sessionId) {
    params.set("session", options.sessionId);
  }

  if (options.settings) {
    params.set("settings", options.settings);
  }

  const query = params.toString();
  return query ? `/w/${slug}?${query}` : `/w/${slug}`;
}

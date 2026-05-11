import type { WorkspaceSession } from "@/lib/opencode/types";

export type WorkspaceSessionMode = "chat" | "tasks";

export type WorkspaceUnreadCounts = {
  sessionsUnreadCount: number;
  tasksUnreadCount: number;
};

type AutopilotWorkspaceSession = WorkspaceSession & {
  autopilot: NonNullable<WorkspaceSession["autopilot"]>;
};

export function isAutopilotSession(
  session: WorkspaceSession | null | undefined
): session is AutopilotWorkspaceSession {
  return Boolean(session?.autopilot);
}

export function hasUnseenAutopilotResult(session: WorkspaceSession | null | undefined): boolean {
  return Boolean(session?.autopilot?.hasUnseenResult);
}

export function getWorkspaceSessionMode(session: WorkspaceSession): WorkspaceSessionMode {
  return isAutopilotSession(session) ? "tasks" : "chat";
}

export function canAutoResumeWorkspaceSession(session: WorkspaceSession | null | undefined): boolean {
  return !isAutopilotSession(session);
}

export function isBusyAutopilotWorkspaceSession(session: WorkspaceSession | null | undefined): boolean {
  return isAutopilotSession(session) && session?.status === "busy";
}

export function getWorkspaceUnreadCounts(
  sessions: WorkspaceSession[],
  unseenCompletedSessions: ReadonlySet<string>
): WorkspaceUnreadCounts {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  let sessionsUnreadCount = 0;

  unseenCompletedSessions.forEach((sessionId) => {
    const session = sessionsById.get(sessionId);
    if (session && !isAutopilotSession(session)) {
      sessionsUnreadCount += 1;
    }
  });

  return {
    sessionsUnreadCount,
    tasksUnreadCount: sessions.filter(hasUnseenAutopilotResult).length,
  };
}

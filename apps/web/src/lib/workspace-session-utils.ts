import type { WorkspaceSession } from "@/lib/opencode/types";

export type WorkspaceSessionMode = "chat" | "flows";

export type WorkspaceUnreadCounts = {
  sessionsUnreadCount: number;
  flowsUnreadCount: number;
};

type FlowWorkspaceSession = WorkspaceSession & {
  flow: NonNullable<WorkspaceSession["flow"]>;
};

export function isFlowSession(
  session: WorkspaceSession | null | undefined
): session is FlowWorkspaceSession {
  return Boolean(session?.flow);
}

export function hasUnseenFlowResult(session: WorkspaceSession | null | undefined): boolean {
  return Boolean(session?.flow?.hasUnseenResult);
}

export function getWorkspaceSessionMode(session: WorkspaceSession): WorkspaceSessionMode {
  return isFlowSession(session) ? "flows" : "chat";
}

export function canAutoResumeWorkspaceSession(session: WorkspaceSession | null | undefined): boolean {
  return !isFlowSession(session);
}

export function isBusyFlowWorkspaceSession(session: WorkspaceSession | null | undefined): boolean {
  return isFlowSession(session) && (
    session?.status === "busy" ||
    session.flow.status === "running" ||
    session.flow.status === "waiting_for_human"
  );
}

export function getWorkspaceUnreadCounts(
  sessions: WorkspaceSession[],
  unseenCompletedSessions: ReadonlySet<string>
): WorkspaceUnreadCounts {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  let sessionsUnreadCount = 0;

  unseenCompletedSessions.forEach((sessionId) => {
    const session = sessionsById.get(sessionId);
    if (session && !isFlowSession(session)) {
      sessionsUnreadCount += 1;
    }
  });

  return {
    sessionsUnreadCount,
    flowsUnreadCount: sessions.filter(hasUnseenFlowResult).length,
  };
}

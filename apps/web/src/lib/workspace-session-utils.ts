import type { WorkspaceSession } from "@/lib/opencode/types";

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

export function isBusyFlowWorkspaceSession(session: WorkspaceSession | null | undefined): boolean {
  return isFlowSession(session) && (
    session?.status === "busy" ||
    session.flow.status === "running" ||
    session.flow.status === "waiting_for_human"
  );
}

/**
 * Keep only root sessions: drop any session whose parent session is also in
 * the list (subagent sessions that belong to a visible parent).
 */
export function excludeSubagentSessions(sessions: WorkspaceSession[]): WorkspaceSession[] {
  if (sessions.length === 0) return sessions;
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  return sessions.filter(
    (session) => !session.parentId || !sessionsById.has(session.parentId)
  );
}

"use client";

import { useEffect, useRef } from "react";

import type { WorkspacePermission } from "@/lib/opencode/permission";
import type { WorkspaceMessage } from "@/lib/opencode/types";

type UseWorkspacePermissionMessagesEffectInput = {
  enabled: boolean;
  hydrateSessionMessages: (
    sessionId: string,
    options?: { trackLoading?: boolean }
  ) => Promise<void>;
  messagesBySession: Record<string, WorkspaceMessage[]>;
  permissions: WorkspacePermission[];
};

// Pending permissions can reference sessions whose messages were never loaded
// into the store — delegated child sessions in particular. Approval previews
// need the referenced tool call, so hydrate each referenced session once
// (quietly, without toggling the active session's loading indicator). A
// session that fails to hydrate stays in the preview loading state instead of
// being retried in a loop.
export function useWorkspacePermissionMessagesEffect(
  input: UseWorkspacePermissionMessagesEffectInput
): void {
  const attemptedSessionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!input.enabled) return;

    for (const permission of input.permissions) {
      if (permission.sessionId in input.messagesBySession) continue;
      if (attemptedSessionsRef.current.has(permission.sessionId)) continue;

      attemptedSessionsRef.current.add(permission.sessionId);
      void input.hydrateSessionMessages(permission.sessionId, { trackLoading: false });
    }
  }, [input]);
}

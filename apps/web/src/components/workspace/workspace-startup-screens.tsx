"use client";

import { XCircle } from "@phosphor-icons/react";

import { ArcLoader } from "@/components/workspace/arc-loader";
import type { InstanceStartupStatus } from "@/hooks/use-instance-startup";
import type { WorkspaceConnectionState } from "@/types/workspace-runtime";

const CONNECTION_ERROR_COPY: Record<string, string> = {
  connection_check_failed: "Couldn't reach the workspace. Retrying...",
  forbidden: "You are not allowed to access this workspace.",
  health_check_timeout: "The workspace is taking too long to respond. Retrying...",
  instance_unavailable: "The workspace is not ready right now. Retrying...",
  unauthorized: "Your session has expired. Sign in again.",
  unhealthy: "The workspace is not ready right now. Retrying...",
  user_not_found: "This workspace could not be found.",
};

const getConnectionErrorText = (error: string | undefined) =>
  (error && CONNECTION_ERROR_COPY[error]) || `Error: ${error ?? "unknown"}`;

type WorkspaceConnectingBannerProps = {
  connection: WorkspaceConnectionState;
  instanceStatus: InstanceStartupStatus;
  instanceError: string | null;
};

/**
 * In-pane connecting state rendered inside the chrome (sidebar stays visible).
 * Never replaces the full viewport — the sidebar and page remain mounted.
 */
export function WorkspaceConnectingBanner({
  connection,
  instanceStatus,
  instanceError,
}: WorkspaceConnectingBannerProps) {
  const migrating = instanceStatus === "migrating_history";
  const starting = instanceStatus === "starting" || instanceStatus === null || migrating;
  const failed = instanceStatus === "error";
  const connectionFailed = !starting && !failed && connection.status === "error";

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 text-center">
      {failed || connectionFailed ? (
        <XCircle size={24} weight="fill" className="text-destructive/70" aria-hidden />
      ) : (
        <div aria-hidden><ArcLoader /></div>
      )}
      <div className="max-w-sm space-y-1">
        {starting ? (
          <div role="status" aria-atomic="true" className="space-y-1">
            <h2 className="type-display text-base font-semibold">
              {migrating ? "Migrating history" : "Starting workspace"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {migrating
                ? "Preserving your previous conversations before starting your workspace…"
                : "Setting up your workspace…"}
            </p>
          </div>
        ) : failed ? (
          <div role="alert">
            <h2 className="type-display text-base font-semibold text-destructive">Failed to start</h2>
            <p className="text-sm text-muted-foreground">
              {instanceError ?? "Unable to start the workspace"}
            </p>
          </div>
        ) : (
          <div role={connectionFailed ? "alert" : undefined}>
            <h2 className="type-display text-base font-semibold">Connecting to OpenCode</h2>
            <p className="text-sm text-muted-foreground">
              {connectionFailed
                ? getConnectionErrorText(connection.error)
                : "Establishing connection..."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

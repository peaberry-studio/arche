"use client";

import type { InstanceStartupStatus } from "@/hooks/use-instance-startup";
import type { WorkspaceConnectionState } from "@/lib/opencode/types";

import { ArcLoader } from "./arc-loader";

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
  const starting = instanceStatus === "starting" || instanceStatus === null;

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 text-center">
      <ArcLoader />
      <div className="space-y-1">
        {starting ? (
          <>
            <h2 className="type-display text-base font-semibold">Starting workspace</h2>
            <p className="text-sm text-muted-foreground">
              Preparing your development environment...
            </p>
          </>
        ) : instanceStatus === "error" ? (
          <>
            <h2 className="type-display text-base font-semibold text-destructive">Failed to start</h2>
            <p className="text-sm text-muted-foreground">
              {instanceError ?? "Unable to start the workspace"}
            </p>
          </>
        ) : (
          <>
            <h2 className="type-display text-base font-semibold">Connecting to OpenCode</h2>
            <p className="text-sm text-muted-foreground">
              {connection.status === "error"
                ? getConnectionErrorText(connection.error)
                : "Establishing connection..."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

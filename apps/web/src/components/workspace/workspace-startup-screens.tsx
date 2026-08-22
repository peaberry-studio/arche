"use client";

import type { ReactNode } from "react";
import { Circle, XCircle } from "@phosphor-icons/react";

import { useWorkspaceTheme } from "@/contexts/workspace-theme-context";
import type { InstanceStartupStatus } from "@/hooks/use-instance-startup";
import type { WorkspaceConnectionState } from "@/lib/opencode/types";
import { cn } from "@/lib/utils";

import { ArcLoader } from "./arc-loader";

const statusConfig = {
  active: { color: "text-emerald-500", pulse: true },
  provisioning: { color: "text-amber-500", pulse: true },
  offline: { color: "text-muted-foreground", pulse: false },
};

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

type StatusScreenFrameProps = {
  slug: string;
  showHeader: boolean;
  statusStyle: { color: string; pulse: boolean };
  macDesktopWindowInset: boolean;
  children: ReactNode;
};

function StatusScreenFrame({
  slug,
  showHeader,
  statusStyle,
  macDesktopWindowInset,
  children,
}: StatusScreenFrameProps) {
  const { themeId, isDark } = useWorkspaceTheme();

  return (
    <div
      className={cn(
        "flex h-dvh flex-col overflow-hidden bg-background text-foreground",
        macDesktopWindowInset && "pt-8",
        isDark && "dark",
        `theme-${themeId}`
      )}
    >
      <div className="flex h-full flex-col p-3">
        {showHeader && (
          <div className="flex items-center gap-2 p-4">
            <span className="type-display text-base font-semibold tracking-tight">Arche</span>
            <span className="text-sm text-muted-foreground">/</span>
            <span className="text-sm text-muted-foreground">{slug}</span>
            <Circle size={8} weight="fill" className={cn(statusStyle.color, statusStyle.pulse && "animate-pulse")} />
          </div>
        )}

        <div className="relative z-10 flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-6 text-center">{children}</div>
        </div>
      </div>
    </div>
  );
}

type WorkspaceStartupScreenProps = {
  slug: string;
  instanceStatus: Exclude<InstanceStartupStatus, "running">;
  instanceError: string | null;
  macDesktopWindowInset?: boolean;
};

export function WorkspaceStartupScreen({
  slug,
  instanceStatus,
  instanceError,
  macDesktopWindowInset = false,
}: WorkspaceStartupScreenProps) {
  const loadingStyle = statusConfig[instanceStatus === "starting" ? "provisioning" : "offline"];

  return (
    <StatusScreenFrame
      slug={slug}
      showHeader={instanceStatus === "error"}
      statusStyle={loadingStyle}
      macDesktopWindowInset={macDesktopWindowInset}
    >
      {instanceStatus === "starting" && (
        <>
          <div className="relative">
            <div className="h-16 w-16 animate-spin rounded-full border-4 border-muted border-t-primary" />
          </div>
          <div className="space-y-2">
            <h2 className="type-display text-xl font-semibold">Starting workspace</h2>
            <p className="text-sm text-muted-foreground">
              Preparing your development environment...
            </p>
          </div>
        </>
      )}
      {instanceStatus === "error" && (
        <>
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <XCircle size={30} weight="fill" className="text-destructive" />
          </div>
          <div className="space-y-2">
            <h2 className="type-display text-xl font-semibold text-destructive">Failed to start</h2>
            <p className="text-sm text-muted-foreground">
              {instanceError ?? "Unable to start the workspace"}
            </p>
          </div>
        </>
      )}
      {instanceStatus === null && (
        <>
          <ArcLoader />
          <div className="space-y-2">
            <h2 className="type-display text-xl font-semibold">Connecting...</h2>
          </div>
        </>
      )}
    </StatusScreenFrame>
  );
}

type WorkspaceConnectingScreenProps = {
  slug: string;
  connection: WorkspaceConnectionState;
  macDesktopWindowInset?: boolean;
};

export function WorkspaceConnectingScreen({
  slug,
  connection,
  macDesktopWindowInset = false,
}: WorkspaceConnectingScreenProps) {
  return (
    <StatusScreenFrame
      slug={slug}
      showHeader={connection.status === "error"}
      statusStyle={statusConfig.provisioning}
      macDesktopWindowInset={macDesktopWindowInset}
    >
      <ArcLoader />
      <div className="space-y-2">
        <h2 className="type-display text-xl font-semibold">Connecting to OpenCode</h2>
        <p className="text-sm text-muted-foreground">
          {connection.status === "error"
            ? getConnectionErrorText(connection.error)
            : "Establishing connection..."}
        </p>
      </div>
    </StatusScreenFrame>
  );
}

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

"use client";

import { useRouter } from "next/navigation";
import { Circle, Palette, SquaresFour } from "@phosphor-icons/react";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SyncKbResult } from "@/app/api/instances/[slug]/sync-kb/route";
import { useWorkspaceTheme } from "@/contexts/workspace-theme-context";
import { cn } from "@/lib/utils";
import { SyncKbButton } from "./sync-kb-button";

type WorkspaceHeaderProps = {
  slug: string;
  status: "active" | "provisioning" | "offline";
  onSyncComplete?: (status: SyncKbResult['status']) => void;
};

const statusConfig = {
  active: { color: "text-emerald-500", pulse: true },
  provisioning: { color: "text-amber-500", pulse: true },
  offline: { color: "text-muted-foreground", pulse: false }
};

export function WorkspaceHeader({
  slug,
  status,
  onSyncComplete,
}: WorkspaceHeaderProps) {
  const router = useRouter();
  const statusStyle = statusConfig[status];
  const { themes, themeId, setThemeId } = useWorkspaceTheme();
  const [pendingConfig, setPendingConfig] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);

  const { lightThemes, darkThemes } = useMemo(() => {
    return {
      lightThemes: themes.filter((t) => !t.isDark),
      darkThemes: themes.filter((t) => t.isDark),
    };
  }, [themes]);

  useEffect(() => {
    if (status !== "active") {
      return;
    }

    let cancelled = false;

    const loadStatus = async () => {
      try {
        const response = await fetch(`/api/instances/${slug}/config-status`, { cache: "no-store" });
        const data = (await response.json().catch(() => null)) as { pending?: boolean } | null;
        if (!response.ok || !data) {
          return;
        }
        if (!cancelled) {
          setPendingConfig(Boolean(data.pending));
        }
      } catch {
        // Silent — we only need the banner when available
      }
    };

    loadStatus();
    const interval = setInterval(loadStatus, 300000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [slug, status]);

  const handleRestart = async () => {
    if (isRestarting) return;
    setIsRestarting(true);
    try {
      const response = await fetch(`/api/instances/${slug}/restart`, { method: "POST" });
      if (!response.ok) {
        setIsRestarting(false);
        return;
      }
      setPendingConfig(false);
      setTimeout(() => {
        setIsRestarting(false);
      }, 1000);
    } catch {
      setIsRestarting(false);
    }
  };

  return (
    <header className="glass-bar relative z-30 shrink-0 rounded-2xl text-card-foreground">
      <div className="flex h-11 w-full items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2">
          <span className="font-[family-name:var(--font-display)] text-base font-semibold tracking-tight">
            Archē
          </span>
          <span className="text-sm text-muted-foreground">/</span>
          <span className="text-sm text-muted-foreground">{slug}</span>
          <Circle
            size={8}
            weight="fill"
            className={cn(
              statusStyle.color,
              statusStyle.pulse && "animate-pulse"
            )}
          />
        </div>

        <TooltipProvider delayDuration={2000}>
          <div className="flex items-center gap-1">
            {pendingConfig && status === "active" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={handleRestart}
                disabled={isRestarting}
              >
                {isRestarting ? "Restarting..." : "Restart to apply changes"}
              </Button>
            )}
            <SyncKbButton
              slug={slug}
              disabled={status !== "active"}
              onComplete={onSyncComplete}
            />

            {/* Theme picker */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      aria-label="Change theme"
                    >
                      <Palette size={16} weight="bold" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">Change theme</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" sideOffset={8} className="min-w-[180px]">
                <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Light
                </DropdownMenuLabel>
                {lightThemes.map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    onClick={() => setThemeId(t.id)}
                    className={cn(
                      "flex items-center gap-3",
                      themeId === t.id && "bg-primary/10"
                    )}
                  >
                    {/* Color swatch preview */}
                    <div className="flex h-5 w-8 overflow-hidden rounded-md border border-border/50">
                      <div
                        className="w-1/2"
                        style={{ backgroundColor: t.swatches[0] }}
                      />
                      <div
                        className="w-1/2"
                        style={{ backgroundColor: t.swatches[1] }}
                      />
                    </div>
                    <span className="text-sm">{t.name}</span>
                    {themeId === t.id && (
                      <span className="ml-auto text-[10px] text-primary">Active</span>
                    )}
                  </DropdownMenuItem>
                ))}

                <DropdownMenuSeparator />

                <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Dark
                </DropdownMenuLabel>
                {darkThemes.map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    onClick={() => setThemeId(t.id)}
                    className={cn(
                      "flex items-center gap-3",
                      themeId === t.id && "bg-primary/10"
                    )}
                  >
                    {/* Color swatch preview */}
                    <div className="flex h-5 w-8 overflow-hidden rounded-md border border-border/50">
                      <div
                        className="w-1/2"
                        style={{ backgroundColor: t.swatches[0] }}
                      />
                      <div
                        className="w-1/2"
                        style={{ backgroundColor: t.swatches[1] }}
                      />
                    </div>
                    <span className="text-sm">{t.name}</span>
                    {themeId === t.id && (
                      <span className="ml-auto text-[10px] text-primary">Active</span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  aria-label="Dashboard"
                  onClick={() => router.push(`/u/${slug}`)}
                >
                  <SquaresFour size={16} weight="bold" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Dashboard</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
    </header>
  );
}

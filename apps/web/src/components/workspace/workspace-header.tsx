"use client";

import { useRouter } from "next/navigation";
import { Circle, Gear, Palette } from "@phosphor-icons/react";

import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspaceTheme } from "@/contexts/workspace-theme-context";
import { cn } from "@/lib/utils";
import { SyncKbButton } from "./sync-kb-button";

type WorkspaceHeaderProps = {
  slug: string;
  status: "active" | "provisioning" | "offline";
  onSyncComplete?: () => void;
};

const statusConfig = {
  active: { color: "text-emerald-500", pulse: true },
  provisioning: { color: "text-amber-500", pulse: true },
  offline: { color: "text-muted-foreground", pulse: false }
};

export function WorkspaceHeader({
  slug,
  status,
  onSyncComplete
}: WorkspaceHeaderProps) {
  const router = useRouter();
  const statusStyle = statusConfig[status];
  const { themes, themeId, setThemeId } = useWorkspaceTheme();

  const { lightThemes, darkThemes } = useMemo(() => {
    return {
      lightThemes: themes.filter((t) => !t.isDark),
      darkThemes: themes.filter((t) => t.isDark),
    };
  }, [themes]);

  return (
    <header className="glass-bar relative z-30 shrink-0 rounded-2xl text-card-foreground">
      <div className="flex h-11 w-full items-center justify-between px-4">
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

        <div className="flex items-center gap-1">
          <SyncKbButton
            slug={slug}
            disabled={status !== "active"}
            onComplete={onSyncComplete}
          />
          
          {/* Theme picker */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label="Change background theme"
              >
                <Palette size={16} weight="bold" />
              </Button>
            </DropdownMenuTrigger>
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

          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label="Settings"
            onClick={() => router.push("/settings/security")}
          >
            <Gear size={16} weight="bold" />
          </Button>
        </div>
      </div>
    </header>
  );
}

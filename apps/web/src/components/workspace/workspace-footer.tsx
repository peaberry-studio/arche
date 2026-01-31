"use client";

import { SidebarSimple, SquareHalf } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

type WorkspaceFooterProps = {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
};

export function WorkspaceFooter({
  leftCollapsed,
  rightCollapsed,
  onToggleLeft,
  onToggleRight
}: WorkspaceFooterProps) {
  return (
    <footer className="relative z-20 border-t border-border/60 bg-card/80 backdrop-blur-sm">
      <div className="flex h-8 w-full items-center justify-between px-2">
        <button
          type="button"
          onClick={onToggleLeft}
          className={cn(
            "flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors",
            leftCollapsed
              ? "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              : "bg-muted/50 text-foreground"
          )}
          aria-label={leftCollapsed ? "Mostrar archivos" : "Ocultar archivos"}
        >
          <SidebarSimple size={14} weight={leftCollapsed ? "regular" : "bold"} />
          <span className="hidden sm:inline">Archivos</span>
        </button>

        <button
          type="button"
          onClick={onToggleRight}
          className={cn(
            "flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors",
            rightCollapsed
              ? "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              : "bg-muted/50 text-foreground"
          )}
          aria-label={rightCollapsed ? "Mostrar inspector" : "Ocultar inspector"}
        >
          <span className="hidden sm:inline">Inspector</span>
          <SquareHalf size={14} weight={rightCollapsed ? "regular" : "bold"} />
        </button>
      </div>
    </footer>
  );
}

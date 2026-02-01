import { Circle, Gear } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SyncKbButton } from "./sync-kb-button";

type WorkspaceHeaderProps = {
  slug: string;
  status: "active" | "provisioning" | "offline";
};

const statusConfig = {
  active: { color: "text-emerald-500", pulse: true },
  provisioning: { color: "text-amber-500", pulse: true },
  offline: { color: "text-muted-foreground", pulse: false }
};

export function WorkspaceHeader({
  slug,
  status
}: WorkspaceHeaderProps) {
  const statusStyle = statusConfig[status];

  return (
    <header className="relative border-b border-border/60 bg-card/80 backdrop-blur-sm">
      <div className="flex h-11 w-full items-center justify-between px-3">
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
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label="Ajustes"
          >
            <Gear size={16} weight="bold" />
          </Button>
        </div>
      </div>
    </header>
  );
}

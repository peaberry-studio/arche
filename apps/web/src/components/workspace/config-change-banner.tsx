"use client";

import { ArrowClockwise, Warning } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

type ConfigChangeBannerProps = {
  pending: boolean;
  restarting: boolean;
  restartError: string | null;
  onRestart: () => void;
};

export function ConfigChangeBanner({
  pending,
  restarting,
  restartError,
  onRestart,
}: ConfigChangeBannerProps) {
  if (!pending && !restartError) return null;

  return (
    <div
      className={cn(
        "flex w-full shrink-0 items-center justify-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors",
        restartError
          ? "bg-destructive text-destructive-foreground"
          : "bg-amber-500 text-white dark:bg-amber-600"
      )}
    >
      <Warning size={16} weight="bold" className="shrink-0" />
      <span>
        {restartError
          ? `Restart failed: ${restartError}`
          : "Configuration changes detected — restart to apply"}
      </span>
      <button
        type="button"
        onClick={onRestart}
        disabled={restarting}
        className={cn(
          "ml-1 inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors",
          restartError
            ? "bg-white/20 hover:bg-white/30 disabled:opacity-50"
            : "bg-white/20 hover:bg-white/30 disabled:opacity-50"
        )}
      >
        <ArrowClockwise
          size={13}
          weight="bold"
          className={cn(restarting && "animate-spin")}
        />
        {restarting ? "Restarting…" : "Restart now"}
      </button>
    </div>
  );
}

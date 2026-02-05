"use client";

import { useEffect, useMemo, useState } from "react";

import {
  getWorkspaceConflictAction,
  resolveWorkspaceConflictAction,
} from "@/actions/workspace-agent";
import type { ConflictResolutionStrategy, WorkspaceConflictDetails } from "@/actions/workspace-agent";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type ConflictResolverDialogProps = {
  slug: string;
  path: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResolved?: (path: string, content: string) => void;
};

const STRATEGY_OPTIONS: Array<{
  key: ConflictResolutionStrategy;
  label: string;
  description: string;
}> = [
  {
    key: "ours",
    label: "Keep local",
    description: "Use the current workspace version.",
  },
  {
    key: "theirs",
    label: "Keep KB",
    description: "Use the incoming KB version.",
  },
  {
    key: "manual",
    label: "Manual",
    description: "Edit and merge both versions.",
  },
];

export function ConflictResolverDialog({
  slug,
  path,
  open,
  onOpenChange,
  onResolved,
}: ConflictResolverDialogProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<WorkspaceConflictDetails | null>(null);
  const [strategy, setStrategy] = useState<ConflictResolutionStrategy>("ours");
  const [manualContent, setManualContent] = useState<string>("");

  useEffect(() => {
    if (!open || !path) return;

    let cancelled = false;
    setStatus("loading");
    setError(null);
    setConflict(null);

    getWorkspaceConflictAction(slug, path)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok || !result.conflict) {
          setError(result.error ?? "Unable to load conflict data");
          setStatus("idle");
          return;
        }
        setConflict(result.conflict);
        setManualContent(result.conflict.working ?? result.conflict.ours ?? "");
        setStrategy("ours");
        setStatus("idle");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unable to load conflict data");
        setStatus("idle");
      });

    return () => {
      cancelled = true;
    };
  }, [open, path, slug]);

  useEffect(() => {
    if (open) return;
    setStatus("idle");
    setError(null);
    setConflict(null);
    setManualContent("");
  }, [open]);

  const previewContent = useMemo(() => {
    if (!conflict) return "";
    if (strategy === "ours") return conflict.ours;
    if (strategy === "theirs") return conflict.theirs;
    return manualContent;
  }, [conflict, manualContent, strategy]);

  const applyResolution = async () => {
    if (!path || !conflict || status !== "idle") return;

    setStatus("saving");
    setError(null);

    const content =
      strategy === "manual"
        ? manualContent
        : strategy === "ours"
          ? conflict.ours
          : conflict.theirs;

    const result = await resolveWorkspaceConflictAction(slug, {
      path,
      strategy,
      content: strategy === "manual" ? manualContent : undefined,
    });

    if (!result.ok) {
      setError(result.error ?? "Unable to resolve conflict");
      setStatus("idle");
      return;
    }

    onResolved?.(path, content);
    setStatus("idle");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Resolve conflict</DialogTitle>
          <DialogDescription className="font-mono text-[11px] text-muted-foreground">
            {path ?? ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {STRATEGY_OPTIONS.map((option) => (
              <Button
                key={option.key}
                size="sm"
                variant={strategy === option.key ? "default" : "outline"}
                className="h-8 px-3 text-xs"
                onClick={() => setStrategy(option.key)}
                disabled={status !== "idle"}
              >
                {option.label}
              </Button>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            {STRATEGY_OPTIONS.find((option) => option.key === strategy)?.description}
          </p>

          {status === "loading" ? (
            <div className="rounded-lg border border-border/40 bg-muted/30 px-4 py-6 text-xs text-muted-foreground">
              Loading conflict data...
            </div>
          ) : strategy === "manual" ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="min-w-0 space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Local version
                  </p>
                  <pre className="max-h-48 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-[11px] font-mono leading-relaxed text-foreground/80">
                    {conflict?.ours || "(empty)"}
                  </pre>
                </div>
                <div className="min-w-0 space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    KB version
                  </p>
                  <pre className="max-h-48 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-[11px] font-mono leading-relaxed text-foreground/80">
                    {conflict?.theirs || "(empty)"}
                  </pre>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Resolved content
                </p>
                <textarea
                  value={manualContent}
                  onChange={(event) => setManualContent(event.target.value)}
                  className={cn(
                    "min-h-[220px] w-full resize-y rounded-md border border-border/40 bg-background px-3 py-2",
                    "text-[12px] font-mono leading-relaxed text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  )}
                  placeholder="Write the final version of this file"
                  disabled={status !== "idle"}
                />
              </div>
            </div>
          ) : (
            <div className="min-w-0 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Preview
              </p>
              <pre className="max-h-80 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-[11px] font-mono leading-relaxed text-foreground/80">
                {previewContent || "(empty)"}
              </pre>
            </div>
          )}

          {error ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-3 text-xs"
            onClick={() => onOpenChange(false)}
            disabled={status === "saving"}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8 px-3 text-xs"
            onClick={applyResolution}
            disabled={status !== "idle" || !conflict}
          >
            {status === "saving" ? "Resolving..." : "Resolve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

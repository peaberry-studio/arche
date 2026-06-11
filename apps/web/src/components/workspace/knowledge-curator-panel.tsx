"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LearningProposal, LearningRun, LearningRunStatus } from "@/types/learning";

type KnowledgeCuratorPanelProps = {
  slug: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  refreshKey?: number;
}

type LearningResponse = {
  proposals: LearningProposal[];
  runs: LearningRun[];
}

const ERROR_LABELS: Record<string, string> = {
  hash_conflict: "The target file changed since this proposal was created. Review it before applying.",
  not_pending: "This proposal was already resolved.",
  not_found: "Proposal not found.",
  file_exists: "The target file already exists.",
  workspace_agent_unavailable: "The workspace agent is unavailable. Try again later.",
  invalid_request: "The request was invalid.",
  learning_load_failed: "Could not load learning data.",
  learning_action_failed: "The action failed. Try again.",
};

function errorLabel(code: string): string {
  return ERROR_LABELS[code] ?? code;
}

const RUN_STATUS_LABELS: Record<LearningRunStatus, string> = {
  pending: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
};

const RUN_STATUS_CLASSES: Record<LearningRunStatus, string> = {
  pending: "bg-muted/60 text-muted-foreground",
  running: "bg-primary/15 text-primary",
  succeeded: "bg-emerald-500/15 text-emerald-500",
  failed: "bg-destructive/15 text-destructive",
};

function RunStatusBadge({ status }: { status: LearningRunStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
        RUN_STATUS_CLASSES[status] ?? RUN_STATUS_CLASSES.pending,
      )}
    >
      {RUN_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function KnowledgeCuratorPanel({ slug, collapsed = false, onToggleCollapse, refreshKey = 0 }: KnowledgeCuratorPanelProps) {
  const [data, setData] = useState<LearningResponse>({ proposals: [], runs: [] });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/u/${slug}/learning`, { cache: "no-store" });
      const json = (await response.json().catch(() => null)) as LearningResponse | { error?: string } | null;
      const error = json && "error" in json && typeof json.error === "string" ? json.error : null;
      if (!response.ok || !json || error || !('runs' in json) || !('proposals' in json)) {
        setError(error ?? "learning_load_failed");
        return;
      }
      setError(null);
      setData(json);
    } catch {
      setError("learning_load_failed");
    }
  }, [slug]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [refresh, refreshKey]);

  const actOnProposal = useCallback(
    async (proposalId: string, action: "apply" | "reject", content?: string) => {
      setBusyProposalId(proposalId);
      try {
        const response = await fetch(`/api/u/${slug}/learning/proposals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, proposalId, content }),
        });
        const json = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) {
          await refresh();
          setError(json?.error ?? "learning_action_failed");
          return;
        }

        setError(null);
        await refresh();
        setEdits((current) => {
          const next = { ...current };
          delete next[proposalId];
          return next;
        });
      } catch {
        setError("learning_action_failed");
      } finally {
        setBusyProposalId(null);
      }
    },
    [refresh, slug]
  );

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label="Expand curator panel"
        className="group flex h-full w-full cursor-pointer flex-col items-center gap-3 py-4 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        <span
          className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground/80 transition-colors group-hover:text-foreground"
          style={{ writingMode: "vertical-rl" }}
        >
          Curator
        </span>
      </button>
    );
  }

  return (
    <aside className="flex h-full min-h-0 flex-col text-card-foreground">
      <div className="flex items-start justify-between border-b border-border/30 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Knowledge Curator</h2>
          <p className="text-xs text-muted-foreground">Review learning runs and pending KB proposals.</p>
        </div>
        {onToggleCollapse ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Collapse curator panel"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <span aria-hidden>»</span>
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {error ? <p className="text-xs text-destructive">{errorLabel(error)}</p> : null}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pending proposals</h3>
          {data.proposals.filter((proposal) => proposal.status === "pending").map((proposal) => (
            <article key={proposal.id} className="space-y-2 rounded-lg border border-border/60 bg-background/60 p-3">
              <div>
                <p className="text-sm font-medium">{proposal.title}</p>
                <p className="text-xs text-muted-foreground">{proposal.operation} {proposal.kbPath} · {Math.round(proposal.confidence * 100)}%</p>
              </div>
              {proposal.evidence.quote ? (
                <blockquote className="rounded bg-muted/40 p-2 text-xs text-muted-foreground">{proposal.evidence.quote}</blockquote>
              ) : null}
              <textarea
                className="h-28 w-full rounded-md border border-border bg-background p-2 text-xs outline-none"
                value={edits[proposal.id] ?? proposal.proposedContent}
                disabled={busyProposalId === proposal.id}
                onChange={(event) => {
                  setEdits((current) => ({ ...current, [proposal.id]: event.currentTarget.value }));
                }}
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyProposalId !== null}
                  onClick={() => void actOnProposal(proposal.id, "reject")}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  disabled={busyProposalId !== null}
                  onClick={() => void actOnProposal(proposal.id, "apply", edits[proposal.id] ?? proposal.proposedContent)}
                >
                  Apply
                </Button>
              </div>
            </article>
          ))}
          {data.proposals.every((proposal) => proposal.status !== "pending") ? (
            <p className="text-xs text-muted-foreground">No pending proposals.</p>
          ) : null}
        </section>
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent runs</h3>
          {data.runs.map((run) => (
            <div key={run.id} className="space-y-1 rounded-md border border-border/60 p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate font-medium">{run.title}</p>
                <RunStatusBadge status={run.status} />
              </div>
              <p className="text-muted-foreground">{run.trigger}</p>
              {run.status === "failed" && run.error ? (
                <p className="text-destructive">{errorLabel(run.error)}</p>
              ) : null}
            </div>
          ))}
          {data.runs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No learning runs yet.</p>
          ) : null}
        </section>
      </div>
    </aside>
  );
}

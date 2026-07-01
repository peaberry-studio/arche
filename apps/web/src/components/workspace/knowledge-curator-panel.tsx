"use client";

import { useCallback, useEffect, useState } from "react";

import { ArrowLineRight } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { MarkdownPreview } from "@/components/workspace/markdown-preview";
import { cn } from "@/lib/utils";
import type { LearningProposal, LearningRun, LearningRunStatus } from "@/types/learning";

type KnowledgeCuratorPanelProps = {
  slug: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onOpenSession?: (sessionId: string) => void;
  onProposalSentToReview?: () => Promise<void> | void;
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
  learning_run_cancelled: "The learning run was cancelled.",
  run_not_cancelable: "This run cannot be cancelled.",
  run_not_retryable: "This run is already executing.",
  cancel_failed: "Could not cancel the learning run. Try again.",
  instance_unavailable: "The workspace instance is unavailable. Try again later.",
};

const ACTIVE_RUN_POLL_INTERVAL_MS = 5_000;
const COLLAPSED_IDLE_POLL_INTERVAL_MS = 45_000;
// Dispatch happens right after a run is created, so a run still pending after
// this window lost its executor (e.g. a server restart) and can be retried.
const STALE_PENDING_RUN_MS = 2 * 60 * 1000;

function errorLabel(code: string): string {
  return ERROR_LABELS[code] ?? code;
}

const RUN_STATUS_LABELS: Record<LearningRunStatus, string> = {
  pending: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

const RUN_STATUS_CLASSES: Record<LearningRunStatus, string> = {
  pending: "bg-muted/60 text-muted-foreground",
  running: "bg-primary/15 text-primary",
  succeeded: "bg-emerald-500/15 text-emerald-500",
  failed: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted/60 text-muted-foreground",
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

function formatTrigger(trigger: LearningRun["trigger"]): string {
  return trigger.charAt(0).toUpperCase() + trigger.slice(1);
}

function formatMessageCount(count: number): string {
  return `${count} ${count === 1 ? "message" : "messages"}`;
}

export function KnowledgeCuratorPanel({ slug, collapsed = false, onToggleCollapse, onOpenSession, onProposalSentToReview, refreshKey = 0 }: KnowledgeCuratorPanelProps) {
  const [data, setData] = useState<LearningResponse>({ proposals: [], runs: [] });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState(0);

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
      setRefreshedAt(Date.now());
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

  const hasActiveRun = data.runs.some((run) => run.status === "pending" || run.status === "running");
  const pendingProposalCount = data.proposals.filter((proposal) => proposal.status === "pending").length;
  const pendingProposalBadge = pendingProposalCount > 99 ? "99+" : String(pendingProposalCount);

  useEffect(() => {
    const pollIntervalMs = hasActiveRun
      ? ACTIVE_RUN_POLL_INTERVAL_MS
      : collapsed
        ? COLLAPSED_IDLE_POLL_INTERVAL_MS
        : null;
    if (!pollIntervalMs) return;

    const interval = window.setInterval(() => {
      void refresh();
    }, pollIntervalMs);

    return () => window.clearInterval(interval);
  }, [collapsed, hasActiveRun, refresh]);

  const retryRun = useCallback(
    async (runId: string) => {
      setBusyRunId(runId);
      try {
        const response = await fetch(`/api/u/${slug}/learning`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId }),
        });
        const json = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) {
          setError(json?.error ?? "learning_action_failed");
        } else {
          setError(null);
        }
        await refresh();
      } catch {
        setError("learning_action_failed");
      } finally {
        setBusyRunId(null);
      }
    },
    [refresh, slug]
  );

  const cancelRun = useCallback(
    async (runId: string) => {
      setBusyRunId(runId);
      try {
        const response = await fetch(`/api/u/${slug}/learning/runs/${runId}/cancel`, {
          method: "POST",
        });
        const json = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) {
          await refresh();
          setError(json?.error ?? "cancel_failed");
          return;
        } else {
          setError(null);
        }
        await refresh();
      } catch {
        setError("cancel_failed");
      } finally {
        setBusyRunId(null);
      }
    },
    [refresh, slug]
  );

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
        if (action === "apply") {
          void onProposalSentToReview?.();
        }
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
    [onProposalSentToReview, refresh, slug]
  );

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label="Expand curator panel"
        className="group flex h-full w-full cursor-pointer flex-col items-center gap-3 py-4 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        {pendingProposalCount > 0 ? (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-none text-primary-foreground">
            {pendingProposalBadge}
          </span>
        ) : (
          <span className="h-5" aria-hidden />
        )}
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
      <div className="flex shrink-0 items-center gap-2 pl-2 pr-3 py-2">
        {onToggleCollapse ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Collapse panel"
            title="Collapse panel"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <ArrowLineRight size={13} weight="bold" />
          </button>
        ) : null}
        <div className="flex h-8 min-w-0 flex-1 items-center">
          <h2 className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Knowledge Curator
          </h2>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {error ? <p className="text-xs text-destructive">{errorLabel(error)}</p> : null}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pending proposals</h3>
          {data.proposals.filter((proposal) => proposal.status === "pending").map((proposal) => {
            const proposalContent = edits[proposal.id] ?? proposal.proposedContent;

            return (
              <article key={proposal.id} className="space-y-3 rounded-xl border border-border/60 bg-background/70 p-3 shadow-sm">
                <div>
                  <p className="text-sm font-medium">{proposal.title}</p>
                  <p className="text-xs text-muted-foreground">{proposal.operation} {proposal.kbPath} · {Math.round(proposal.confidence * 100)}%</p>
                </div>
                {proposal.evidence.quote ? (
                  <blockquote className="rounded-lg border border-border/40 bg-muted/30 p-2 text-xs leading-relaxed text-muted-foreground">{proposal.evidence.quote}</blockquote>
                ) : null}
                <div className="overflow-hidden rounded-lg border border-border/60 bg-background">
                  <div className="border-b border-border/50 bg-muted/30 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Markdown preview
                  </div>
                  <div className="max-h-72 overflow-y-auto scrollbar-none">
                    <MarkdownPreview content={proposalContent} />
                  </div>
                </div>
                <details className="rounded-lg border border-border/50 bg-muted/20 p-2">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                    Edit markdown before review
                  </summary>
                  <textarea
                    className="mt-2 h-28 w-full rounded-md border border-border bg-background p-2 font-mono text-xs outline-none"
                    value={proposalContent}
                    disabled={busyProposalId === proposal.id}
                    onChange={(event) => {
                      setEdits((current) => ({ ...current, [proposal.id]: event.currentTarget.value }));
                    }}
                  />
                </details>
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
                    onClick={() => void actOnProposal(proposal.id, "apply", proposalContent)}
                  >
                    Send to review
                  </Button>
                </div>
              </article>
            );
          })}
          {pendingProposalCount === 0 ? (
            <p className="text-xs text-muted-foreground">No pending proposals.</p>
          ) : null}
        </section>
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent runs</h3>
          {data.runs.map((run) => {
            const isStalePending =
              run.status === "pending" && refreshedAt - Date.parse(run.createdAt) > STALE_PENDING_RUN_MS;
            const isRetryable = run.status === "failed" || isStalePending;
            const isCancelable = run.status === "pending" || run.status === "running";
            const internalSessionId = run.internalSessionId;
            return (
              <article key={run.id} className="rounded-xl border border-border/60 bg-background/70 p-3 text-xs shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-medium">{run.title}</p>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="rounded-full bg-muted/50 px-2 py-0.5">{formatTrigger(run.trigger)}</span>
                      <span className="rounded-full bg-muted/50 px-2 py-0.5">{formatMessageCount(run.messageCount)}</span>
                    </div>
                  </div>
                  <RunStatusBadge status={run.status} />
                </div>
                <div className="mt-3 flex items-center justify-end gap-2">
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {internalSessionId && onOpenSession ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => onOpenSession(internalSessionId)}
                      >
                        Open session
                      </Button>
                    ) : null}
                    {isCancelable ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px]"
                        disabled={busyRunId !== null}
                        onClick={() => void cancelRun(run.id)}
                      >
                        Cancel
                      </Button>
                    ) : null}
                    {isRetryable ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px]"
                        disabled={busyRunId !== null}
                        onClick={() => void retryRun(run.id)}
                      >
                        {run.status === "failed" ? "Retry" : "Run now"}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {run.status === "failed" && run.error ? (
                  <p className="mt-2 rounded-lg bg-destructive/10 px-2 py-1 text-destructive">{errorLabel(run.error)}</p>
                ) : null}
              </article>
            );
          })}
          {data.runs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No learning runs yet.</p>
          ) : null}
        </section>
      </div>
    </aside>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { LearningProposal, LearningRun } from "@/types/learning";

type KnowledgeCuratorPanelProps = {
  slug: string;
}

type LearningResponse = {
  proposals: LearningProposal[];
  runs: LearningRun[];
}

export function KnowledgeCuratorPanel({ slug }: KnowledgeCuratorPanelProps) {
  const [data, setData] = useState<LearningResponse>({ proposals: [], runs: [] });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/u/${slug}/learning`, { cache: "no-store" });
    const json = (await response.json().catch(() => null)) as LearningResponse | { error?: string } | null;
    const error = json && "error" in json && typeof json.error === "string" ? json.error : null;
    if (!response.ok || !json || error || !('runs' in json) || !('proposals' in json)) {
      setError(error ?? "learning_load_failed");
      return;
    }
    setError(null);
    setData(json);
  }, [slug]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [refresh]);

  const actOnProposal = useCallback(
    async (proposalId: string, action: "apply" | "reject", content?: string) => {
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
    },
    [refresh, slug]
  );

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-border/60 bg-card/80 text-card-foreground">
      <div className="border-b border-border/60 px-4 py-3">
        <h2 className="text-sm font-semibold">Knowledge Curator</h2>
        <p className="text-xs text-muted-foreground">Review learning runs and pending KB proposals.</p>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
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
                onChange={(event) => {
                  setEdits((current) => ({ ...current, [proposal.id]: event.currentTarget.value }));
                }}
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => void actOnProposal(proposal.id, "reject")}>Reject</Button>
                <Button size="sm" onClick={() => void actOnProposal(proposal.id, "apply", edits[proposal.id] ?? proposal.proposedContent)}>Apply</Button>
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
            <div key={run.id} className="rounded-md border border-border/60 p-2 text-xs">
              <p className="font-medium">{run.title}</p>
              <p className="text-muted-foreground">{run.trigger} · {run.status}</p>
            </div>
          ))}
        </section>
      </div>
    </aside>
  );
}

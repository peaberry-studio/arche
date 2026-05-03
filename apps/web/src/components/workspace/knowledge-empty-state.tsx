"use client";

import { Database } from "@phosphor-icons/react";

export function KnowledgeEmptyState() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center px-6 text-center text-card-foreground">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground/[0.04] text-muted-foreground/50">
        <Database size={22} weight="regular" />
      </div>
      <p className="mt-4 max-w-[280px] text-sm font-medium text-foreground/80">
        Browse your knowledge base
      </p>
      <p className="mt-1 max-w-[340px] text-xs leading-relaxed text-muted-foreground">
        Pick a note from the sidebar to start reading or editing. Knowledge mode keeps your markdown notes, internal links, and the graph view in one place.
      </p>
    </div>
  );
}

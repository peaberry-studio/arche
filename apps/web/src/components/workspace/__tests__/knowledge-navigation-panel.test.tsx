/** @vitest-environment jsdom */

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  KnowledgeNavigationPanel,
  type KnowledgeNavigationView,
} from "@/components/workspace/knowledge-navigation-panel";

vi.mock("@/components/workspace/knowledge-graph-panel", () => ({
  KnowledgeGraphPanel: ({ onOpenFile }: { onOpenFile: (path: string) => void }) => (
    <button type="button" onClick={() => onOpenFile("docs/plan.md")}>
      Graph node docs/plan.md
    </button>
  ),
}));

function KnowledgeNavigationPanelHarness({
  onOpenFile,
}: {
  onOpenFile: (path: string) => void
}) {
  const [view, setView] = useState<KnowledgeNavigationView>("tree");

  return (
    <KnowledgeNavigationPanel
      activeFilePath={null}
      agentSources={[]}
      fileNodes={[{ id: "docs/plan.md", name: "plan.md", path: "docs/plan.md", type: "file" }]}
      onOpenFile={onOpenFile}
      openFiles={[]}
      readFile={vi.fn()}
      reloadKey={0}
      view={view}
      onViewChange={setView}
    />
  );
}

function CollapsibleKnowledgeNavigationPanelHarness() {
  const [view, setView] = useState<KnowledgeNavigationView>("tree");
  const [collapsed, setCollapsed] = useState(false);

  return (
    <KnowledgeNavigationPanel
      activeFilePath={null}
      agentSources={[]}
      collapsed={collapsed}
      fileNodes={[{ id: "docs/plan.md", name: "plan.md", path: "docs/plan.md", type: "file" }]}
      onOpenFile={vi.fn()}
      onToggleCollapsed={() => setCollapsed((previous) => !previous)}
      openFiles={[]}
      readFile={vi.fn()}
      reloadKey={0}
      view={view}
      onViewChange={setView}
    />
  );
}

describe("KnowledgeNavigationPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens files from both tree and graph views", () => {
    const onOpenFile = vi.fn();

    render(<KnowledgeNavigationPanelHarness onOpenFile={onOpenFile} />);

    fireEvent.click(screen.getByRole("button", { name: /plan.md/i }));
    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    fireEvent.click(screen.getByRole("button", { name: "Graph node docs/plan.md" }));

    expect(onOpenFile).toHaveBeenNthCalledWith(1, "docs/plan.md");
    expect(onOpenFile).toHaveBeenNthCalledWith(2, "docs/plan.md");
  });

  it("collapses into an icon rail and expands back from it", () => {
    render(<CollapsibleKnowledgeNavigationPanelHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Collapse navigation panel" }));

    expect(screen.getByRole("button", { name: "Expand navigation panel" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /plan.md/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand navigation panel" }));

    expect(screen.getByRole("button", { name: /plan.md/i })).toBeTruthy();
  });

  it("expands into the view chosen from the collapsed rail", () => {
    render(<CollapsibleKnowledgeNavigationPanelHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Collapse navigation panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Graph" }));

    expect(screen.getByRole("button", { name: "Graph node docs/plan.md" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Graph" }).getAttribute("aria-pressed")).toBe("true");
  });
});

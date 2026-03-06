/** @vitest-environment jsdom */

import { createRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LeftPanel } from "@/components/workspace/left-panel";
import type { AgentCatalogItem } from "@/hooks/use-workspace";
import type { WorkspaceFileNode, WorkspaceSession } from "@/lib/opencode/types";

const sessions: WorkspaceSession[] = [
  {
    id: "s1",
    title: "Alpha chat",
    status: "idle",
    updatedAt: "now",
    updatedAtRaw: 1,
  },
  {
    id: "s2",
    title: "Beta chat",
    status: "idle",
    updatedAt: "now",
    updatedAtRaw: 2,
  },
];

const fileNodes: WorkspaceFileNode[] = [
  {
    id: "d1",
    name: "docs",
    path: "docs",
    type: "directory",
    children: [
      {
        id: "f3",
        name: "nested.md",
        path: "docs/nested.md",
        type: "file",
      },
    ],
  },
  {
    id: "f1",
    name: "alpha.md",
    path: "alpha.md",
    type: "file",
  },
  {
    id: "f2",
    name: "beta.md",
    path: "beta.md",
    type: "file",
  },
];

const agents: AgentCatalogItem[] = [
  {
    id: "a1",
    displayName: "Alpha Agent",
    isPrimary: true,
  },
  {
    id: "a2",
    displayName: "Beta Agent",
    isPrimary: false,
  },
];

describe("LeftPanel", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("filters sections using internal search state", () => {
    const onCreateKnowledgeFile = vi.fn().mockResolvedValue({ ok: true as const });

    render(
      <LeftPanel
        slug="alice"
        sessions={sessions}
        activeSessionId={"s1"}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        agents={agents}
        onSelectAgent={vi.fn()}
        onOpenExpertsSettings={vi.fn()}
        fileNodes={fileNodes}
        activeFilePath={null}
        onSelectFile={vi.fn()}
        onCreateKnowledgeFile={onCreateKnowledgeFile}
        searchInputRef={createRef<HTMLInputElement>()}
      />
    );

    const searchInput = screen.getByLabelText("Search chats, knowledge, and experts");
    if (!(searchInput instanceof HTMLInputElement)) {
      throw new Error("Expected search input element");
    }
    fireEvent.change(searchInput, { target: { value: "beta" } });

    expect(screen.queryByText("Alpha chat")).toBeNull();
    expect(screen.getByText("Beta chat")).toBeTruthy();

    expect(screen.queryByText("alpha.md")).toBeNull();
    expect(screen.getByText("beta.md")).toBeTruthy();

    expect(screen.queryByText("Alpha Agent")).toBeNull();
    expect(screen.getByText("Beta Agent")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(searchInput.value).toBe("");
    expect(screen.getByText("Alpha chat")).toBeTruthy();
    expect(screen.getByText("alpha.md")).toBeTruthy();
    expect(screen.queryByText("Alpha Agent")).toBeNull();
    expect(screen.getByText("Beta Agent")).toBeTruthy();
  });

  it("creates a markdown file in the selected directory", async () => {
    const onCreateKnowledgeFile = vi.fn().mockResolvedValue({ ok: true as const });

    render(
      <LeftPanel
        slug="alice"
        sessions={sessions}
        activeSessionId={"s1"}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        agents={agents}
        onSelectAgent={vi.fn()}
        onOpenExpertsSettings={vi.fn()}
        fileNodes={fileNodes}
        activeFilePath={null}
        onSelectFile={vi.fn()}
        onCreateKnowledgeFile={onCreateKnowledgeFile}
        searchInputRef={createRef<HTMLInputElement>()}
      />
    );

    const createFileButtons = screen.getAllByRole("button", { name: "Create file" });
    fireEvent.click(createFileButtons[createFileButtons.length - 1]);
    fireEvent.change(screen.getByLabelText("File name"), {
      target: { value: "release-plan" },
    });
    fireEvent.change(screen.getByLabelText("Location"), {
      target: { value: "docs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(onCreateKnowledgeFile).toHaveBeenCalledWith("docs/release-plan.md");
    });
  });

  it("hydrates subpanel collapsed state from browser storage", () => {
    window.localStorage.setItem(
      "arche.workspace.alice.left-panel",
      JSON.stringify({
        topCollapsed: true,
        midCollapsed: false,
        bottomCollapsed: true,
        topRatio: 0.2,
        midRatio: 0.5,
      })
    );

    render(
      <LeftPanel
        slug="alice"
        sessions={sessions}
        activeSessionId={"s1"}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        agents={agents}
        onSelectAgent={vi.fn()}
        onOpenExpertsSettings={vi.fn()}
        fileNodes={fileNodes}
        activeFilePath={null}
        onSelectFile={vi.fn()}
        onCreateKnowledgeFile={vi.fn().mockResolvedValue({ ok: true as const })}
        searchInputRef={createRef<HTMLInputElement>()}
      />
    );

    const chatsSection = screen
      .getByRole("button", { name: "Chats" })
      .closest(".glass-panel");
    const expertsSection = screen
      .getByRole("button", { name: "Experts" })
      .closest(".glass-panel");

    expect(chatsSection?.getAttribute("style")).toContain("flex: 0 0 32px");
    expect(expertsSection?.getAttribute("style")).toContain("flex: 0 0 32px");
  });

  it("persists subpanel collapsed state to browser storage", async () => {
    render(
      <LeftPanel
        slug="alice"
        sessions={sessions}
        activeSessionId={"s1"}
        onSelectSession={vi.fn()}
        onCreateSession={vi.fn()}
        agents={agents}
        onSelectAgent={vi.fn()}
        onOpenExpertsSettings={vi.fn()}
        fileNodes={fileNodes}
        activeFilePath={null}
        onSelectFile={vi.fn()}
        onCreateKnowledgeFile={vi.fn().mockResolvedValue({ ok: true as const })}
        searchInputRef={createRef<HTMLInputElement>()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /knowledge/i }));

    await waitFor(() => {
      const raw = window.localStorage.getItem("arche.workspace.alice.left-panel");
      expect(raw).toBeTruthy();

      const parsed = JSON.parse(raw as string) as {
        midCollapsed?: boolean;
      };
      expect(parsed.midCollapsed).toBe(true);
    });
  });
});

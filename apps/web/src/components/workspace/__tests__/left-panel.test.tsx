/** @vitest-environment jsdom */

import { createRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LeftPanel } from "@/components/workspace/left-panel";
import { WorkspaceThemeProvider } from "@/contexts/workspace-theme-context";
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

const defaultProps = {
  slug: "alice",
  status: "active" as const,
  leftCollapsed: false,
  onToggleLeft: vi.fn(),
  onSyncComplete: vi.fn(),
  onNavigateDashboard: vi.fn(),
  onNavigateSettings: vi.fn(),
  sessions,
  activeSessionId: "s1" as string | null,
  unseenCompletedSessions: new Set<string>() as ReadonlySet<string>,
  onSelectSession: vi.fn(),
  onCreateSession: vi.fn(),
  agents,
  onSelectAgent: vi.fn(),
  onOpenExpertsSettings: vi.fn(),
  fileNodes,
  activeFilePath: null as string | null,
  onSelectFile: vi.fn(),
  onCreateKnowledgeFile: vi.fn().mockResolvedValue({ ok: true as const }),
  searchInputRef: createRef<HTMLInputElement>(),
};

const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

function clearCookies() {
  document.cookie.split(';').forEach((cookie) => {
    const [name] = cookie.trim().split('=');
    if (!name) return;

    document.cookie = `${name}=; Path=/; Max-Age=0`;
  });
}

function renderLeftPanel(overrides?: Partial<typeof defaultProps>) {
  return render(
    <WorkspaceThemeProvider storageScope="alice">
      <LeftPanel {...defaultProps} {...overrides} />
    </WorkspaceThemeProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
  localStorage.clear();
  clearCookies();
  // Mock fetch for connectors/providers
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ connectors: [], providers: [] }),
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LeftPanel", () => {
  it("filters sections using internal search state", () => {
    renderLeftPanel();

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

    renderLeftPanel({ onCreateKnowledgeFile });

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

  it("hides create file controls when knowledge editing is disabled", () => {
    renderLeftPanel({ canCreateKnowledgeFile: false });

    expect(screen.queryByRole("button", { name: "Create file" })).toBeNull();
  });

  it("hydrates subpanel collapsed state from storage", () => {
    localStorage.setItem(
      "arche.workspace.alice.left-panel",
      JSON.stringify({ topCollapsed: true, midCollapsed: false, bottomCollapsed: true })
    );

    renderLeftPanel();

    // The Chats section header should be present but its content collapsed
    // We verify by checking the aria-hidden or structure; simpler: check toggle button clicks work
    // The toggle buttons (SectionHeader) are always visible; we verify collapse state indirectly
    // by checking that Sessions content is hidden (grid-template-rows: 0fr)
    const chatHeaders = screen.getAllByRole("button").filter(
      (btn) => btn.textContent?.includes("Chats")
    );
    expect(chatHeaders.length).toBeGreaterThan(0);
    // topCollapsed = true means the section has flexBasis: HEADER_HEIGHT and grow: 0
    // We can check that the persisted value was loaded by verifying what gets persisted back
    expect(localStorage.getItem("arche.workspace.alice.left-panel")).toContain('"topCollapsed":true');
  });

  it("hydrates subpanel collapsed state from the cookie when localStorage is empty", () => {
    document.cookie = `arche-workspace-left-panel-alice=${encodeURIComponent(JSON.stringify({
      topCollapsed: true,
      midCollapsed: false,
      bottomCollapsed: true,
      topRatio: 0.42,
      midRatio: 0.33,
    }))}; Path=/`;

    renderLeftPanel();

    expect(localStorage.getItem("arche.workspace.alice.left-panel")).toContain('"topCollapsed":true');
    expect(localStorage.getItem("arche.workspace.alice.left-panel")).toContain('"bottomCollapsed":true');
  });

  it("hydrates subpanel collapsed state from the initial server state", () => {
    renderLeftPanel({
      initialPanelState: {
        topRatio: 0.42,
        midRatio: 0.33,
        topCollapsed: true,
        midCollapsed: false,
        bottomCollapsed: true,
      },
    });

    expect(localStorage.getItem("arche.workspace.alice.left-panel")).toContain('"topCollapsed":true');
    expect(localStorage.getItem("arche.workspace.alice.left-panel")).toContain('"bottomCollapsed":true');
  });

  it("persists subpanel collapsed state to storage on toggle", () => {
    renderLeftPanel();

    // The persist effect runs on mount with default state
    // Toggle the Chats section to collapsed
    const chatToggleBtn = screen.getAllByRole("button").find(
      (btn) => btn.querySelector("span")?.textContent?.includes("Chats") ||
               btn.textContent?.trim().startsWith("Chats")
    );

    if (!chatToggleBtn) {
      throw new Error("Could not find Chats toggle button");
    }

    fireEvent.click(chatToggleBtn);

    const stored = localStorage.getItem("arche.workspace.alice.left-panel");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.topCollapsed).toBe(true);
  });

  it("shows a new chat button when the left panel is collapsed", () => {
    const onCreateSession = vi.fn();

    renderLeftPanel({ leftCollapsed: true, onCreateSession });

    const newChatButton = screen.getByRole("button", { name: "New chat" });

    expect(newChatButton.className).toContain("bg-primary/12");
    expect(newChatButton.className).toContain("text-primary");
    expect(newChatButton.className).toContain("mb-1");

    fireEvent.click(newChatButton);

    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });
});

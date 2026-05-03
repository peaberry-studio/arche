/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubBrowserStorage } from "@/__tests__/storage";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { setWorkspaceStartPrompt } from "@/lib/workspace-start-prompt";

const { ensureInstanceRunningActionMock } = vi.hoisted(() => ({
  ensureInstanceRunningActionMock: vi.fn().mockResolvedValue({ status: "running" }),
}));

const createSessionMock = vi.fn().mockResolvedValue(undefined);
const readFileMock = vi.fn();
const sendMessageMock = vi.fn().mockResolvedValue(true);

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("@/actions/spawner", () => ({
  ensureInstanceRunningAction: ensureInstanceRunningActionMock,
}));

vi.mock("@/contexts/workspace-theme-context", () => ({
  useWorkspaceTheme: () => ({
    canDecreaseChatFontSize: true,
    canIncreaseChatFontSize: true,
    chatFontFamily: "sans",
    chatFontSize: 15,
    decreaseChatFontSize: vi.fn(),
    increaseChatFontSize: vi.fn(),
    themeId: "warm-sand",
    themes: [
      { id: "warm-sand", name: "Warm Sand", swatch: "#d6a35f" },
      { id: "slate", name: "Slate", swatch: "#64748b" },
    ],
    setChatFontFamily: vi.fn(),
    setThemeId: vi.fn(),
    isDark: false,
    toggleDark: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-workspace", () => ({
  useWorkspace: () => ({
    sessions: [
      {
        id: "root-session",
        title: "Root session",
        status: "idle",
        updatedAt: "now",
        updatedAtRaw: Date.now(),
      },
    ],
    messages: [],
    diffs: [],
    activeSessionId: "root-session",
    unseenCompletedSessions: new Set<string>(),
    isConnected: true,
    connection: { status: "connected", error: null },
    refreshDiffs: vi.fn(),
    refreshFiles: vi.fn(),
    readFile: readFileMock,
    writeFile: vi.fn(),
    discardFileChanges: vi.fn(),
    createSession: createSessionMock,
    deleteSession: vi.fn(),
    markAutopilotRunSeen: vi.fn(),
    renameSession: vi.fn(),
    selectSession: vi.fn(),
    agentCatalog: [
      { id: "assistant", displayName: "Assistant", isPrimary: true },
      { id: "ads-scripts", displayName: "Ads Scripts", isPrimary: false },
    ],
    fileTree: [],
    isStartingNewSession: false,
    sendMessage: sendMessageMock,
    abortSession: vi.fn(),
    isSending: false,
    models: [],
    agentDefaultModel: null,
    selectedModel: null,
    hasManualModelSelection: false,
    setSelectedModel: vi.fn(),
    hasMoreSessions: false,
    isLoadingMoreSessions: false,
    loadMoreSessions: vi.fn(),
    refreshSessions: vi.fn(),
    isLoadingDiffs: false,
    diffsError: null,
  }),
}));

vi.mock('@/hooks/use-skills-catalog', () => ({
  useSkillsCatalog: () => ({
    skills: [],
    hash: null,
    isLoading: false,
    loadError: null,
    reload: vi.fn(),
  }),
}))

vi.mock("@/components/workspace/chat-panel", () => ({
  ChatPanel: ({ onOpenFile }: { onOpenFile: (path: string) => void }) => (
    <div>
      <span>Chat Panel</span>
      <button type="button" onClick={() => onOpenFile("docs/plan.md")}>
        Open plan preview
      </button>
    </div>
  ),
}));

vi.mock("@/components/workspace/cosmic-loader", () => ({
  CosmicLoader: () => <div>Loader</div>,
}));

vi.mock("@/components/workspace/inspector-panel", () => ({
  InspectorPanel: ({
    onToggleRight,
    panelMode = "combined",
    rightCollapsed,
  }: {
    onToggleRight: () => void;
    panelMode?: "combined" | "files" | "review";
    rightCollapsed: boolean;
  }) => (
    <button
      type="button"
      data-collapsed={String(rightCollapsed)}
      data-panel-mode={panelMode}
      onClick={onToggleRight}
    >
      {panelMode === "files" ? "Files Panel" : panelMode === "review" ? "Review Panel" : "Inspector Panel"}
    </button>
  ),
}));

vi.mock("@/components/workspace/knowledge-graph-panel", () => ({
  KnowledgeGraphPanel: () => <div>Knowledge Graph Panel</div>,
}));

function clearCookies() {
  document.cookie.split(';').forEach((cookie) => {
    const [name] = cookie.trim().split('=');
    if (!name) return;

    document.cookie = `${name}=; Path=/; Max-Age=0`;
  });
}

function readCookieValue(cookieName: string): string | null {
  const prefix = `${cookieName}=`;

  for (const cookie of document.cookie.split(';')) {
    const trimmedCookie = cookie.trim();
    if (!trimmedCookie.startsWith(prefix)) continue;
    return decodeURIComponent(trimmedCookie.slice(prefix.length));
  }

  return null;
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });

  window.dispatchEvent(new Event("resize"));
}

function findSizedPanelContainer(element: HTMLElement | null): HTMLElement | null {
  let current = element;

  while (current) {
    if (current.style.width) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("WorkspaceShell", () => {
  beforeEach(() => {
    stubBrowserStorage();
    setViewportWidth(1440);
    createSessionMock.mockClear();
    readFileMock.mockReset();
    readFileMock.mockResolvedValue({ content: "# Plan", type: "raw", hash: "hash-plan" });
    sendMessageMock.mockClear();
    sendMessageMock.mockResolvedValue(true);
    ensureInstanceRunningActionMock.mockReset();
    ensureInstanceRunningActionMock.mockResolvedValue({ status: "running" });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();

      if (url.endsWith("/connectors")) {
        return jsonResponse({
          connectors: [
            { id: "notion", name: "Notion", type: "notion", status: "ready" },
            { id: "linear", name: "Linear", type: "linear", status: "pending" },
          ],
        });
      }

      if (url.endsWith("/providers")) {
        return jsonResponse({
          providers: [
            { providerId: "openai", status: "enabled", type: "api", version: 1 },
            { providerId: "anthropic", status: "disabled", type: "api" },
          ],
        });
      }

      if (url.endsWith("/autopilot")) {
        return jsonResponse({
          tasks: [
            {
              id: "daily-review",
              name: "Daily review",
              prompt: "Review yesterday's changes",
              targetAgentId: null,
              cronExpression: "0 9 * * *",
              timezone: "UTC",
              enabled: true,
              nextRunAt: "2026-05-02T09:00:00.000Z",
              lastRunAt: null,
              createdAt: "2026-05-01T09:00:00.000Z",
              updatedAt: "2026-05-01T09:00:00.000Z",
              latestRun: null,
            },
          ],
        });
      }

      return jsonResponse({ ok: true });
    }));
    window.localStorage.clear();
    clearCookies();
    vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 900,
      right: 1440,
      width: 1440,
      height: 900,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows an error when startup never leaves starting", async () => {
    vi.useFakeTimers();
    ensureInstanceRunningActionMock.mockResolvedValue({ status: "starting" });

    render(<WorkspaceShell slug="alice" />);

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(125_000);
    });

    expect(
      screen.getByText("Workspace startup timed out. Try restarting again.")
    ).toBeTruthy();
  });

  it("creates a new session with Command+Period", async () => {
    render(<WorkspaceShell slug="alice" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New chat" })).toBeTruthy();
    });

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ".",
        metaKey: true,
        bubbles: true,
      })
    );

    await waitFor(() => {
      expect(createSessionMock).toHaveBeenCalledWith();
    });
  });

  it("auto-starts a dashboard prompt with selected context paths", async () => {
    setWorkspaceStartPrompt(window.sessionStorage, "alice", {
      text: "Review the plan",
      contextPaths: ["docs/plan.md"],
    });

    render(<WorkspaceShell slug="alice" />);

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith("Review the plan", undefined, {
        forceNewSession: true,
        contextPaths: ["docs/plan.md"],
      });
    });
  });

  it("shows global mode navigation and account menu status", async () => {
    render(<WorkspaceShell slug="alice" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sessions" })).toBeTruthy();
    });

    expect(screen.getByRole("button", { name: "Knowledge" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tasks" })).toBeTruthy();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Workspace account menu" }), {
      button: 0,
      ctrlKey: false,
    });

    expect(await screen.findByText("Settings")).toBeTruthy();
    expect(await screen.findByText("1/2 working")).toBeTruthy();
    expect(await screen.findByText("1 active")).toBeTruthy();
    expect(screen.getByText("Appearance")).toBeTruthy();
  });

  it("clamps hidden desktop tasks mode to chat", async () => {
    render(
      <WorkspaceShell
        slug="alice"
        currentVault={{ id: "vault-1", name: "Vault", path: "/tmp/vault" }}
        initialWorkspaceMode="tasks"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sessions" }).getAttribute("aria-pressed")).toBe("true");
    });

    expect(screen.queryByRole("button", { name: "Tasks" })).toBeNull();
    expect(screen.getByText("Chat Panel")).toBeTruthy();
  });

  it("promotes a quickview file into knowledge editing", async () => {
    render(<WorkspaceShell slug="alice" />);

    fireEvent.click(await screen.findByRole("button", { name: "Open plan preview" }));

    expect(await screen.findByText("Quickview")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit file" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Knowledge" }).getAttribute("aria-pressed")).toBe("true");
    });

    expect(screen.getByRole("button", { name: "Files Panel" }).dataset.panelMode).toBe("files");
    expect(readFileMock).toHaveBeenCalledWith("docs/plan.md");
  });

  it("toggles the left panel with Command+B", async () => {
    render(<WorkspaceShell slug="alice" />);

    expect(await screen.findByRole("button", { name: "Collapse sessions panel" })).toBeTruthy();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "b",
        code: "KeyB",
        metaKey: true,
        bubbles: true,
      })
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand sessions panel" })).toBeTruthy();
    });
  });

  it("starts in knowledge mode with navigation, files, and review panels", async () => {
    render(
      <WorkspaceShell
        slug="alice"
        initialWorkspaceMode="knowledge"
        initialFilePath="docs/plan.md"
        knowledgeAgentSources={[{ id: "strategist", displayName: "Strategist", prompt: "[[docs/plan.md]]" }]}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Tree" })).toBeTruthy();
    });

    expect(screen.getByRole("button", { name: "Graph" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Files Panel" }).dataset.panelMode).toBe("files");
    expect(screen.getByRole("button", { name: "Review Panel" }).dataset.panelMode).toBe("review");
    expect(screen.queryByText("Chat Panel")).toBeNull();
  });

  it("toggles the right panel with Alt+Command+B", async () => {
    render(<WorkspaceShell slug="alice" initialWorkspaceMode="knowledge" />);

    expect(await screen.findByRole("button", { name: "Collapse knowledge panel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review Panel" }).dataset.collapsed).toBe("false");

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "b",
        code: "KeyB",
        metaKey: true,
        altKey: true,
        bubbles: true,
      })
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Review Panel" }).dataset.collapsed).toBe("true");
    });

    expect(screen.getByRole("button", { name: "Collapse knowledge panel" })).toBeTruthy();
  });

  it("restores right panel at 50% of available center area when re-opened", async () => {
    render(<WorkspaceShell slug="alice" initialWorkspaceMode="knowledge" />);

    const leftPanelButton = await screen.findByRole("button", { name: "Collapse knowledge panel" });
    const inspectorButton = screen.getByRole("button", { name: "Review Panel" });

    fireEvent.click(inspectorButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Review Panel" }).dataset.collapsed).toBe("true");
    });

    fireEvent.click(screen.getByRole("button", { name: "Review Panel" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Review Panel" }).dataset.collapsed).toBe("false");
    });

    const leftPanelWidth = Number.parseFloat(findSizedPanelContainer(leftPanelButton)?.style.width ?? "0");
    const rightPanelWidth = Number.parseFloat(
      findSizedPanelContainer(screen.getByRole("button", { name: "Review Panel" }))?.style.width ?? "0"
    );

    const expectedRightWidth = (1440 - leftPanelWidth) / 2;
    expect(rightPanelWidth).toBeCloseTo(expectedRightWidth, 0);
  });

  it("restores right panel against the collapsed left rail when the left panel is hidden", async () => {
    render(<WorkspaceShell slug="alice" initialWorkspaceMode="knowledge" />);

    const leftPanelButton = await screen.findByRole("button", { name: "Collapse knowledge panel" });
    const inspectorButton = screen.getByRole("button", { name: "Review Panel" });

    fireEvent.click(leftPanelButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand knowledge panel" })).toBeTruthy();
    });

    fireEvent.click(inspectorButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Review Panel" }).dataset.collapsed).toBe("true");
    });

    fireEvent.click(screen.getByRole("button", { name: "Review Panel" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Review Panel" }).dataset.collapsed).toBe("false");
    });

    const rightPanelWidth = Number.parseFloat(
      screen.getByRole("button", { name: "Review Panel" }).parentElement?.style.width ?? "0"
    );

    const expectedRightWidth = (1440 - 48) / 2;
    expect(rightPanelWidth).toBeCloseTo(expectedRightWidth, 0);
  });

  it("hydrates layout from the cookie when localStorage is empty", async () => {
    document.cookie = `arche-workspace-layout-alice=${encodeURIComponent(JSON.stringify({
      leftWidth: 264,
      rightWidth: 418,
      leftCollapsed: false,
      rightCollapsed: true,
      rightTab: "preview",
    }))}; Path=/`;

    render(<WorkspaceShell slug="alice" initialWorkspaceMode="knowledge" />);

    await waitFor(() => {
      expect(window.localStorage.getItem("arche.workspace.alice.layout")).toContain('"rightCollapsed":true');
    });

    expect(screen.getByRole("button", { name: "Review Panel" }).dataset.collapsed).toBe("true");

    const leftPanelButton = screen.getByRole("button", { name: "Collapse knowledge panel" });
    const leftPanelWrapper = findSizedPanelContainer(leftPanelButton);

    expect(leftPanelWrapper?.style.width).toBe("264px");
  });

  it("hydrates layout from the initial server state", async () => {
    render(
      <WorkspaceShell
        slug="alice"
        initialWorkspaceMode="knowledge"
        initialLayoutState={{
          leftWidth: 288,
          rightWidth: 410,
          leftCollapsed: true,
          rightCollapsed: true,
          rightTab: "preview",
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand knowledge panel" })).toBeTruthy();
    });

    expect(screen.getByRole("button", { name: "Review Panel" }).dataset.collapsed).toBe("true");
  });

  it("persists layout changes to localStorage and cookies", async () => {
    render(<WorkspaceShell slug="alice" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Collapse sessions panel" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Collapse sessions panel" }));

    await waitFor(() => {
      expect(window.localStorage.getItem("arche.workspace.alice.layout")).toContain('"leftCollapsed":true');
    });

    expect(readCookieValue("arche-workspace-layout-alice")).toContain('"leftCollapsed":true');
  });

  it("shows chat as default view in compact layout", async () => {
    setViewportWidth(720);
    render(<WorkspaceShell slug="alice" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open navigate panel" })).toBeTruthy();
    });

    expect(screen.getByText("Chat Panel")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open review panel" })).toBeNull();
  });

  it("switches to full-screen left panel and back in compact layout", async () => {
    setViewportWidth(720);
    render(<WorkspaceShell slug="alice" />);

    fireEvent.click(await screen.findByRole("button", { name: "Open navigate panel" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New chat" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Show chat" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Show chat" }).getAttribute("aria-pressed")).toBe("true");
    });

    expect(screen.getByText("Chat Panel")).toBeTruthy();
  });

  it("opens and closes full-screen review panel in compact knowledge layout", async () => {
    setViewportWidth(720);
    render(
      <WorkspaceShell
        slug="alice"
        initialWorkspaceMode="knowledge"
        initialFilePath="docs/plan.md"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Open review panel" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Review Panel" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Show files" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Show files" }).getAttribute("aria-pressed")).toBe("true");
    });

    expect(screen.getByRole("button", { name: "Files Panel" })).toBeTruthy();
  });
});

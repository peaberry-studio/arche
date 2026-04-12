/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubBrowserStorage } from "@/__tests__/storage";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

const { ensureInstanceRunningActionMock } = vi.hoisted(() => ({
  ensureInstanceRunningActionMock: vi.fn().mockResolvedValue({ status: "running" }),
}));

const createSessionMock = vi.fn().mockResolvedValue(undefined);

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
    themeId: "warm-sand",
    isDark: false,
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
    readFile: vi.fn(),
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
    sendMessage: vi.fn(),
    abortSession: vi.fn(),
    isSending: false,
    models: [],
    agentDefaultModel: null,
    selectedModel: null,
    hasManualModelSelection: false,
    setSelectedModel: vi.fn(),
    activeAgentName: null,
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
  ChatPanel: ({ onShowContext, pendingInsert }: { onShowContext?: () => void; pendingInsert?: string | null }) => (
    <div>
      <span>Chat Panel</span>
      <span>{pendingInsert ?? "No pending insert"}</span>
      <button type="button" onClick={() => onShowContext?.()}>
        Show Context
      </button>
    </div>
  ),
}));

vi.mock("@/components/workspace/cosmic-loader", () => ({
  CosmicLoader: () => <div>Loader</div>,
}));

vi.mock("@/components/workspace/inspector-panel", () => ({
  InspectorPanel: ({ onToggleRight, rightCollapsed }: { onToggleRight: () => void; rightCollapsed: boolean }) => (
    <button type="button" data-collapsed={String(rightCollapsed)} onClick={onToggleRight}>
      Inspector Panel
    </button>
  ),
}));

vi.mock("@/components/workspace/left-panel", () => ({
  LeftPanel: ({ leftCollapsed, onToggleLeft, onSelectAgent }: { leftCollapsed: boolean; onToggleLeft: () => void; onSelectAgent: (agent: { id: string; displayName: string; isPrimary: boolean }) => void }) => (
    <div>
      <button type="button" data-collapsed={String(leftCollapsed)} onClick={onToggleLeft}>
        Left Panel
      </button>
      <button
        type="button"
        onClick={() => onSelectAgent({ id: "ads-scripts", displayName: "Ads Scripts", isPrimary: false })}
      >
        Insert Ads Scripts
      </button>
    </div>
  ),
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

describe("WorkspaceShell", () => {
  beforeEach(() => {
    stubBrowserStorage();
    setViewportWidth(1440);
    createSessionMock.mockClear();
    ensureInstanceRunningActionMock.mockReset();
    ensureInstanceRunningActionMock.mockResolvedValue({ status: "running" });
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
      expect(screen.getByRole("button", { name: "Left Panel" })).toBeTruthy();
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

  it("inserts the expert id when selecting an expert from the left panel", async () => {
    render(<WorkspaceShell slug="alice" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Insert Ads Scripts" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Insert Ads Scripts" }));

    await waitFor(() => {
      expect(
        screen.getByText((_, element) => element?.textContent === "@ads-scripts ")
      ).toBeTruthy();
    });
  });

  it("toggles the left panel with Command+B", async () => {
    render(<WorkspaceShell slug="alice" />);

    const leftPanelButton = await screen.findByRole("button", { name: "Left Panel" });
    expect(leftPanelButton.dataset.collapsed).toBe("false");

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "b",
        code: "KeyB",
        metaKey: true,
        bubbles: true,
      })
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Left Panel" }).dataset.collapsed).toBe("true");
    });
  });

  it("toggles the right panel with Alt+Command+B", async () => {
    render(<WorkspaceShell slug="alice" />);

    const leftPanelButton = await screen.findByRole("button", { name: "Left Panel" });
    expect(leftPanelButton.dataset.collapsed).toBe("false");
    expect(screen.getByRole("button", { name: "Inspector Panel" }).dataset.collapsed).toBe("false");

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
      expect(screen.getByRole("button", { name: "Inspector Panel" }).dataset.collapsed).toBe("true");
    });

    expect(screen.getByRole("button", { name: "Left Panel" }).dataset.collapsed).toBe("false");
  });

  it("restores right panel at 50% of available center area when re-opened", async () => {
    render(<WorkspaceShell slug="alice" />);

    const leftPanelButton = await screen.findByRole("button", { name: "Left Panel" });
    const inspectorButton = screen.getByRole("button", { name: "Inspector Panel" });

    fireEvent.click(inspectorButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Inspector Panel" }).dataset.collapsed).toBe("true");
    });

    fireEvent.click(screen.getByRole("button", { name: "Inspector Panel" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Inspector Panel" }).dataset.collapsed).toBe("false");
    });

    const leftPanelWidth = Number.parseFloat(findSizedPanelContainer(leftPanelButton)?.style.width ?? "0");
    const rightPanelWidth = Number.parseFloat(
      findSizedPanelContainer(screen.getByRole("button", { name: "Inspector Panel" }))?.style.width ?? "0"
    );

    const expectedRightWidth = (1440 - leftPanelWidth - 24) / 2;
    expect(rightPanelWidth).toBeCloseTo(expectedRightWidth, 0);
  });

  it("restores right panel against the collapsed left rail when the left panel is hidden", async () => {
    render(<WorkspaceShell slug="alice" />);

    const leftPanelButton = await screen.findByRole("button", { name: "Left Panel" });
    const inspectorButton = screen.getByRole("button", { name: "Inspector Panel" });

    fireEvent.click(leftPanelButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Left Panel" }).dataset.collapsed).toBe("true");
    });

    fireEvent.click(inspectorButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Inspector Panel" }).dataset.collapsed).toBe("true");
    });

    fireEvent.click(screen.getByRole("button", { name: "Inspector Panel" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Inspector Panel" }).dataset.collapsed).toBe("false");
    });

    const rightPanelWidth = Number.parseFloat(
      screen.getByRole("button", { name: "Inspector Panel" }).parentElement?.style.width ?? "0"
    );

    const expectedRightWidth = (1440 - 48 - 24) / 2;
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

    render(<WorkspaceShell slug="alice" />);

    await waitFor(() => {
      expect(window.localStorage.getItem("arche.workspace.alice.layout")).toContain('"rightCollapsed":true');
    });

    expect(screen.getByRole("button", { name: "Inspector Panel" }).dataset.collapsed).toBe("true");

    const leftPanelButton = screen.getByRole("button", { name: "Left Panel" });
    const leftPanelWrapper = findSizedPanelContainer(leftPanelButton);

    expect(leftPanelWrapper?.style.width).toBe("264px");
  });

  it("hydrates layout from the initial server state", async () => {
    render(
      <WorkspaceShell
        slug="alice"
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
      expect(screen.getByRole("button", { name: "Left Panel" }).dataset.collapsed).toBe("true");
    });

    expect(screen.getByRole("button", { name: "Inspector Panel" }).dataset.collapsed).toBe("true");
  });

  it("persists layout changes to localStorage and cookies", async () => {
    render(<WorkspaceShell slug="alice" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Left Panel" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Left Panel" }));

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

    expect(screen.getByRole("button", { name: "Open context panel" })).toBeTruthy();
    expect(screen.getByText("Chat Panel")).toBeTruthy();
  });

  it("switches to full-screen left panel and back in compact layout", async () => {
    setViewportWidth(720);
    render(<WorkspaceShell slug="alice" />);

    fireEvent.click(await screen.findByRole("button", { name: "Open navigate panel" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Left Panel" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Show chat" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Show chat" }).getAttribute("aria-pressed")).toBe("true");
    });

    expect(screen.getByText("Chat Panel")).toBeTruthy();
  });

  it("opens and closes full-screen right panel from context action in compact layout", async () => {
    setViewportWidth(720);
    render(<WorkspaceShell slug="alice" />);

    fireEvent.click(await screen.findByRole("button", { name: "Show Context" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Close context panel" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Show chat" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Show chat" }).getAttribute("aria-pressed")).toBe("true");
    });

    expect(screen.getByText("Chat Panel")).toBeTruthy();
  });
});

/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    sessions: [],
    messages: [],
    diffs: [],
    activeSessionId: null,
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
    renameSession: vi.fn(),
    selectSession: vi.fn(),
    agentCatalog: [],
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

vi.mock("@/components/workspace/chat-panel", () => ({
  ChatPanel: () => <div>Chat Panel</div>,
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
  LeftPanel: ({ leftCollapsed, onToggleLeft }: { leftCollapsed: boolean; onToggleLeft: () => void }) => (
    <button type="button" data-collapsed={String(leftCollapsed)} onClick={onToggleLeft}>
      Left Panel
    </button>
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

describe("WorkspaceShell", () => {
  beforeEach(() => {
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
    cleanup();
    vi.restoreAllMocks();
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
    const leftPanelWrapper = leftPanelButton.parentElement;

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
});

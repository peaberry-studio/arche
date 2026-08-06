/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubBrowserStorage } from "@/__tests__/storage";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { setWorkspaceStartPrompt } from "@/lib/workspace-start-prompt";

const { ensureInstanceRunningActionMock } = vi.hoisted(() => ({
  ensureInstanceRunningActionMock: vi.fn().mockResolvedValue({ status: "running" }),
}));

const desktopBridgeMocks = vi.hoisted(() => ({
  getOptionalDesktopBridge: vi.fn(),
  listRecentVaults: vi.fn(),
  openExistingVault: vi.fn(),
  openVault: vi.fn(),
  openVaultLauncher: vi.fn(),
}));

const routerPushMock = vi.fn();
const routerReplaceMock = vi.fn();
const createSessionMock = vi.fn().mockResolvedValue(undefined);
const discardFileChangesMock = vi.fn();
const readFileMock = vi.fn();
const refreshDiffsMock = vi.fn();
const refreshFilesMock = vi.fn();
const refreshMessagesMock = vi.fn();
const selectSessionMock = vi.fn();
const sendMessageMock = vi.fn().mockResolvedValue(true);
const writeFileMock = vi.fn();
let workspaceMockOverrides: Record<string, unknown> = {};
let learningApiResponse: unknown = { runs: [], proposals: [] };

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: routerReplaceMock,
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
    refreshDiffs: refreshDiffsMock,
    refreshFiles: refreshFilesMock,
    refreshMessages: refreshMessagesMock,
    readFile: readFileMock,
    writeFile: writeFileMock,
    discardFileChanges: discardFileChangesMock,
    createSession: createSessionMock,
    deleteSession: vi.fn(),
    markFlowRunSeen: vi.fn(),
    renameSession: vi.fn(),
    selectSession: selectSessionMock,
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
    isInitialSessionsReady: true,
    isLoadingMoreSessions: false,
    sessionsError: null,
    loadMoreSessions: vi.fn(),
    refreshSessions: vi.fn(),
    isLoadingDiffs: false,
    diffsError: null,
    ...workspaceMockOverrides,
  }),
}));

vi.mock("@/lib/runtime/desktop/client", () => ({
  getOptionalDesktopBridge: desktopBridgeMocks.getOptionalDesktopBridge,
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
  ChatPanel: ({
    attachmentsEnabled = true,
    flowHumanResponseRunId,
    isReadOnly,
    onFlowHumanResponseSubmitted,
    onOpenFile,
    onReturnToMainConversation,
  }: {
    attachmentsEnabled?: boolean;
    flowHumanResponseRunId?: string | null;
    isReadOnly?: boolean;
    onFlowHumanResponseSubmitted?: () => Promise<void> | void;
    onOpenFile: (path: string) => void;
    onReturnToMainConversation?: () => void;
  }) => (
    <div
      data-testid="chat-panel"
      data-attachments-enabled={String(attachmentsEnabled)}
      data-flow-human-response-run-id={flowHumanResponseRunId ?? ""}
      data-read-only={String(Boolean(isReadOnly))}
    >
      <span>Chat Panel</span>
      <button type="button" onClick={() => onOpenFile("docs/plan.md")}>
        Open plan preview
      </button>
      {onReturnToMainConversation ? (
        <button type="button" onClick={onReturnToMainConversation}>
          Return to main conversation
        </button>
      ) : null}
      {flowHumanResponseRunId ? (
        <button type="button" onClick={() => void onFlowHumanResponseSubmitted?.()}>
          Flow response submitted
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("@/components/workspace/arc-loader", () => ({
  ArcLoader: () => <div>Loader</div>,
}));

vi.mock("@/components/workspace/inspector-panel", () => ({
  InspectorPanel: ({
    activeFilePath,
    onCloseFile,
    onDiscardFileChanges,
    onOpenFile,
    onPublish,
    onReloadFile,
    onResolveConflict,
    onSaveFile,
    onSelectFile,
    onToggleRight,
    openFiles = [],
    panelMode = "combined",
    rightCollapsed,
  }: {
    activeFilePath?: string | null;
    onCloseFile?: (path: string) => void;
    onDiscardFileChanges?: (path: string) => Promise<{ ok: true } | { ok: false; error: string }>;
    onOpenFile?: (path: string) => void;
    onPublish?: () => void;
    onReloadFile?: (path: string) => Promise<void>;
    onResolveConflict?: (path: string) => void | Promise<void>;
    onSaveFile?: (path: string, content: string, expectedHash?: string) => Promise<{ ok: true; hash?: string } | { ok: false; error: string }>;
    onSelectFile?: (path: string) => void;
    onToggleRight: () => void;
    openFiles?: Array<{ path: string }>;
    panelMode?: "combined" | "files" | "review";
    rightCollapsed: boolean;
  }) => (
    <div>
      <button
        type="button"
        data-collapsed={String(rightCollapsed)}
        data-can-discard={String(Boolean(onDiscardFileChanges))}
        data-can-publish={String(Boolean(onPublish))}
        data-can-resolve={String(Boolean(onResolveConflict))}
        data-can-save={String(Boolean(onSaveFile))}
        data-panel-mode={panelMode}
        data-open-files={openFiles.map((file) => file.path).join(",")}
        onClick={onToggleRight}
      >
        {panelMode === "files" ? "Files Panel" : panelMode === "review" ? "Review Panel" : "Inspector Panel"}
      </button>
      {panelMode === "files" && activeFilePath ? (
        <>
          <button type="button" onClick={() => onSelectFile?.(activeFilePath)}>Select active file</button>
          <button type="button" onClick={() => onCloseFile?.(activeFilePath)}>Close active file</button>
          <button type="button" onClick={() => onOpenFile?.("docs/linked.md")}>Open linked file</button>
          <button type="button" onClick={() => void onReloadFile?.(activeFilePath)}>Reload active file</button>
          <button type="button" onClick={() => void onSaveFile?.(activeFilePath, "Updated content", "expected-hash")}>Save active file</button>
          <button type="button" onClick={() => void onDiscardFileChanges?.(activeFilePath)}>Discard active file</button>
          <button type="button" onClick={() => void onResolveConflict?.(activeFilePath)}>Resolve active conflict</button>
          <button type="button" onClick={() => onPublish?.()}>Publish file changes</button>
        </>
      ) : null}
    </div>
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
    discardFileChangesMock.mockReset();
    discardFileChangesMock.mockResolvedValue({ ok: true });
    routerPushMock.mockClear();
    routerReplaceMock.mockClear();
    readFileMock.mockReset();
    readFileMock.mockResolvedValue({ content: "# Plan", type: "raw", hash: "hash-plan" });
    refreshDiffsMock.mockClear();
    refreshFilesMock.mockClear();
    refreshMessagesMock.mockReset();
    refreshMessagesMock.mockResolvedValue(undefined);
    sendMessageMock.mockClear();
    sendMessageMock.mockResolvedValue(true);
    selectSessionMock.mockClear();
    workspaceMockOverrides = {};
    learningApiResponse = { runs: [], proposals: [] };
    writeFileMock.mockReset();
    writeFileMock.mockResolvedValue({ ok: true, hash: "hash-updated" });
    desktopBridgeMocks.listRecentVaults.mockReset();
    desktopBridgeMocks.listRecentVaults.mockResolvedValue([]);
    desktopBridgeMocks.openExistingVault.mockReset();
    desktopBridgeMocks.openExistingVault.mockResolvedValue({ ok: true });
    desktopBridgeMocks.openVault.mockReset();
    desktopBridgeMocks.openVault.mockResolvedValue({ ok: true });
    desktopBridgeMocks.openVaultLauncher.mockReset();
    desktopBridgeMocks.openVaultLauncher.mockResolvedValue({ ok: true });
    desktopBridgeMocks.getOptionalDesktopBridge.mockReset();
    desktopBridgeMocks.getOptionalDesktopBridge.mockReturnValue({
      listRecentVaults: desktopBridgeMocks.listRecentVaults,
      openExistingVault: desktopBridgeMocks.openExistingVault,
      openVault: desktopBridgeMocks.openVault,
      openVaultLauncher: desktopBridgeMocks.openVaultLauncher,
    });
    ensureInstanceRunningActionMock.mockReset();
    ensureInstanceRunningActionMock.mockResolvedValue({ status: "running" });
    window.history.replaceState(null, "", "/w/alice");
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

      if (url.endsWith("/flows")) {
        return jsonResponse({
          flows: [
            {
              id: "daily-review",
              name: "Daily review",
              description: "Review yesterday's changes",
              definition: { version: 1, startNodeId: "node-1", nodes: [], edges: [] },
              cronExpression: null,
              timezone: "UTC",
              enabled: true,
              nextRunAt: null,
              lastRunAt: null,
              createdAt: "2026-05-01T09:00:00.000Z",
              updatedAt: "2026-05-01T09:00:00.000Z",
              latestRun: null,
            },
          ],
        });
      }

      if (url.endsWith("/learning")) {
        return jsonResponse(learningApiResponse);
      }

      return jsonResponse({ ok: true });
    }));
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
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

  it("shows a startup status check error when startup polling rejects", async () => {
    ensureInstanceRunningActionMock.mockRejectedValueOnce(new Error("boom"));

    render(<WorkspaceShell slug="alice" />);

    expect(await screen.findByText("Failed to start")).toBeTruthy();
    expect(screen.getByText("Unable to verify workspace startup status.")).toBeTruthy();
  });

  it("shows an OpenCode connection error after the instance is running", async () => {
    workspaceMockOverrides = {
      isConnected: false,
      connection: { status: "error", error: "socket down" },
    };

    render(<WorkspaceShell slug="alice" />);

    expect(await screen.findByText("Connecting to OpenCode")).toBeTruthy();
    expect(screen.getByText("Error: socket down")).toBeTruthy();
  });

  it("shows friendly copy for mapped connection errors", async () => {
    workspaceMockOverrides = {
      isConnected: false,
      connection: { status: "error", error: "health_check_timeout" },
    };

    render(<WorkspaceShell slug="alice" />);

    expect(await screen.findByText("Connecting to OpenCode")).toBeTruthy();
    expect(screen.getByText("The workspace is taking too long to respond. Retrying...")).toBeTruthy();
    expect(screen.queryByText("Error: health_check_timeout")).toBeNull();
  });

  it("redirects to setup when the instance requires setup", async () => {
    ensureInstanceRunningActionMock.mockResolvedValueOnce({ status: "error", error: "setup_required" });

    render(<WorkspaceShell slug="alice" />);

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/u/alice?setup=required");
    });
  });

  it("shows raw startup errors that do not need friendly formatting", async () => {
    ensureInstanceRunningActionMock.mockResolvedValueOnce({ status: "error", error: "container exploded" });

    render(<WorkspaceShell slug="alice" />);

    expect(await screen.findByText("Failed to start")).toBeTruthy();
    expect(screen.getByText("container exploded")).toBeTruthy();
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
    expect(screen.getByRole("button", { name: "Flows" })).toBeTruthy();

    const accountMenuButton = screen.getByRole("button", { name: "Workspace account menu" });
    expect(accountMenuButton.textContent).toContain("alice");

    fireEvent.pointerDown(accountMenuButton, {
      button: 0,
      ctrlKey: false,
    });

    expect(await screen.findByText("Settings")).toBeTruthy();
    expect(await screen.findAllByText("1 active")).toHaveLength(2);
    expect(screen.getByText("Appearance")).toBeTruthy();
    expect(screen.queryByText("Current vault")).toBeNull();
  });

  it("shows the desktop vault name and vault section in the account menu", async () => {
    desktopBridgeMocks.listRecentVaults.mockResolvedValue([
      { id: "current", name: "Personal Vault", path: "/vaults/personal" },
      { id: "team", name: "Team Vault", path: "/vaults/team" },
    ]);

    render(
      <WorkspaceShell
        slug="local"
        currentVault={{ id: "current", name: "Personal Vault", path: "/vaults/personal" }}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sessions" })).toBeTruthy();
    });

    const accountMenuButton = screen.getByRole("button", { name: "Workspace account menu" });
    expect(accountMenuButton.textContent).toContain("Personal Vault");
    expect(accountMenuButton.textContent).not.toContain("local");

    fireEvent.pointerDown(accountMenuButton, {
      button: 0,
      ctrlKey: false,
    });

    expect(await screen.findByText("Current vault")).toBeTruthy();
    expect(screen.getByText("/vaults/personal")).toBeTruthy();
    expect(await screen.findByText("Team Vault")).toBeTruthy();
    expect(screen.getByText("/vaults/team")).toBeTruthy();
    expect(screen.getByText("Connectors")).toBeTruthy();
    expect(screen.getByText("Providers")).toBeTruthy();
    expect(screen.getByText("Appearance")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();

    expect(desktopBridgeMocks.listRecentVaults).toHaveBeenCalledTimes(1);
  });

  it("shows unread badges for sessions, flows, and knowledge modes", async () => {
    workspaceMockOverrides = {
      sessions: [
        {
          id: "root-session",
          title: "Root session",
          status: "idle",
          updatedAt: "now",
          updatedAtRaw: 1,
        },
        {
          id: "unread-session-1",
          title: "Unread session 1",
          status: "idle",
          updatedAt: "now",
          updatedAtRaw: 2,
        },
        {
          id: "unread-session-2",
          title: "Unread session 2",
          status: "idle",
          updatedAt: "now",
          updatedAtRaw: 3,
        },
        {
          id: "flow-session",
          title: "Flow | Daily brief",
          status: "idle",
          updatedAt: "now",
          updatedAtRaw: 4,
          flow: {
            runId: "run-1",
            flowId: "flow-1",
            flowName: "Daily brief",
            status: "succeeded",
            trigger: "manual",
            hasUnseenResult: true,
          },
        },
      ],
      unseenCompletedSessions: new Set(["unread-session-1", "unread-session-2", "flow-session"]),
      diffs: [{ path: "docs/a.md" }, { path: "docs/b.md" }, { path: "docs/c.md" }],
    };

    render(<WorkspaceShell slug="alice" />);

    expect(await screen.findByRole("button", { name: /Sessions.*2 unread/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Flows.*1 unread/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Knowledge.*3 pending/ })).toBeTruthy();
  });

  it("auto-syncs the KB after the workspace connects", async () => {
    render(<WorkspaceShell slug="alice" />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/instances/alice/sync-kb", { method: "POST" });
    });
  });

  it("allows desktop vaults to start in flows mode", async () => {
    render(
      <WorkspaceShell
        slug="alice"
        currentVault={{ id: "vault-1", name: "Vault", path: "/tmp/vault" }}
        initialWorkspaceMode="flows"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Flows" }).getAttribute("aria-pressed")).toBe("true");
    });

    expect(screen.getByText("Run a flow")).toBeTruthy();
  });

  it("passes disabled workspace-agent capabilities into chat and knowledge panels", async () => {
    const { unmount } = render(<WorkspaceShell slug="alice" workspaceAgentEnabled={false} />);

    expect((await screen.findByTestId("chat-panel")).dataset.attachmentsEnabled).toBe("false");

    unmount();

    render(
      <WorkspaceShell
        slug="alice"
        initialWorkspaceMode="knowledge"
        initialFilePath="docs/plan.md"
        workspaceAgentEnabled={false}
      />
    );

    const filesPanel = await screen.findByRole("button", { name: "Files Panel" });
    expect(filesPanel.dataset.canSave).toBe("false");
    expect(filesPanel.dataset.canDiscard).toBe("false");
    expect(filesPanel.dataset.canPublish).toBe("false");
    expect(filesPanel.dataset.canResolve).toBe("false");
  });

  it("marks subagent sessions read-only and returns to the root session", async () => {
    const selectSession = vi.fn();
    workspaceMockOverrides = {
      sessions: [
        {
          id: "root-session",
          title: "Root session",
          status: "idle",
          updatedAt: "now",
          updatedAtRaw: 1,
        },
        {
          id: "child-session",
          title: "Child session",
          status: "idle",
          updatedAt: "now",
          updatedAtRaw: 2,
          parentId: "root-session",
        },
      ],
      activeSessionId: "child-session",
      selectSession,
    };

    render(<WorkspaceShell slug="alice" />);

    expect((await screen.findByTestId("chat-panel")).dataset.readOnly).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Return to main conversation" }));

    expect(selectSession).toHaveBeenCalledWith("root-session");
  });

  it("marks busy flow sessions read-only", async () => {
    workspaceMockOverrides = {
      sessions: [
        {
          id: "flow-session",
          title: "Flow | Daily brief",
          status: "busy",
          updatedAt: "now",
          updatedAtRaw: 1,
          flow: {
            runId: "run-1",
            flowId: "flow-1",
            flowName: "Daily brief",
            status: "running",
            trigger: "manual",
            hasUnseenResult: false,
          },
        },
      ],
      activeSessionId: "flow-session",
    };

    render(<WorkspaceShell slug="alice" />);

    expect((await screen.findByTestId("chat-panel")).dataset.readOnly).toBe("true");
    expect(screen.getByTestId("chat-panel").dataset.flowHumanResponseRunId).toBe("");
    expect(screen.queryByRole("button", { name: "Return to main conversation" })).toBeNull();
  });

  it("passes waiting flow runs to the chat panel and refreshes after response", async () => {
    const refreshSessions = vi.fn().mockResolvedValue(undefined);
    refreshMessagesMock.mockResolvedValue(undefined);
    workspaceMockOverrides = {
      refreshSessions,
      sessions: [
        {
          id: "flow-session",
          title: "Flow | Daily brief",
          status: "idle",
          updatedAt: "now",
          updatedAtRaw: 1,
          flow: {
            runId: "run-1",
            flowId: "flow-1",
            flowName: "Daily brief",
            status: "waiting_for_human",
            trigger: "manual",
            hasUnseenResult: false,
          },
        },
      ],
      activeSessionId: "flow-session",
    };

    render(<WorkspaceShell slug="alice" />);

    const chatPanel = await screen.findByTestId("chat-panel");
    expect(chatPanel.dataset.readOnly).toBe("true");
    expect(chatPanel.dataset.flowHumanResponseRunId).toBe("run-1");

    fireEvent.click(screen.getByRole("button", { name: "Flow response submitted" }));

    await waitFor(() => {
      expect(refreshMessagesMock).toHaveBeenCalledTimes(1);
    });
    expect(refreshSessions).toHaveBeenCalledTimes(1);
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

  it("routes knowledge file actions through workspace handlers", async () => {
    render(
      <WorkspaceShell
        slug="alice"
        initialWorkspaceMode="knowledge"
        initialFilePath="docs/plan.md"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Open linked file" }));

    await waitFor(() => {
      expect(readFileMock).toHaveBeenCalledWith("docs/linked.md");
      expect(screen.getByRole("button", { name: "Files Panel" }).dataset.openFiles).toContain("docs/linked.md");
    });

    fireEvent.click(screen.getByRole("button", { name: "Save active file" }));

    await waitFor(() => {
      expect(writeFileMock).toHaveBeenCalledWith("docs/linked.md", "Updated content", "expected-hash");
      expect(refreshDiffsMock).toHaveBeenCalled();
      expect(refreshFilesMock).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reload active file" }));
    fireEvent.click(screen.getByRole("button", { name: "Resolve active conflict" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish file changes" }));

    expect(refreshDiffsMock.mock.calls.length).toBeGreaterThan(1);
    expect(refreshFilesMock.mock.calls.length).toBeGreaterThan(1);

    readFileMock.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole("button", { name: "Discard active file" }));

    await waitFor(() => {
      expect(discardFileChangesMock).toHaveBeenCalledWith("docs/linked.md");
    });
  });

  it("handles file action failures", async () => {
    writeFileMock.mockResolvedValueOnce({ ok: false, error: "write_failed" });
    discardFileChangesMock.mockResolvedValueOnce({ ok: false, error: "discard_failed" });

    render(
      <WorkspaceShell
        slug="alice"
        initialWorkspaceMode="knowledge"
        initialFilePath="docs/plan.md"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Save active file" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard active file" }));

    await waitFor(() => {
      expect(writeFileMock).toHaveBeenCalledWith("docs/plan.md", "Updated content", "expected-hash");
      expect(discardFileChangesMock).toHaveBeenCalledWith("docs/plan.md");
    });
  });

  it("ignores protected initial file paths in knowledge mode", async () => {
    render(
      <WorkspaceShell
        slug="alice"
        initialWorkspaceMode="knowledge"
        initialFilePath="node_modules/pkg/index.js"
      />
    );

    expect(await screen.findByText("Browse your knowledge base")).toBeTruthy();
    expect(readFileMock).not.toHaveBeenCalledWith("node_modules/pkg/index.js");
  });

  it("shows fallback quickview content when preview file loading fails", async () => {
    readFileMock.mockResolvedValueOnce(null);

    render(<WorkspaceShell slug="alice" />);

    fireEvent.click(await screen.findByRole("button", { name: "Open plan preview" }));

    expect(await screen.findByText("Quickview")).toBeTruthy();
    expect(screen.getByText("Unable to load file.")).toBeTruthy();
  });

  it("closes the quickview panel after its exit timer", async () => {
    render(<WorkspaceShell slug="alice" />);

    fireEvent.click(await screen.findByRole("button", { name: "Open plan preview" }));
    expect(await screen.findByText("Quickview")).toBeTruthy();

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(screen.queryByText("Quickview")).toBeNull();
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

  it("resizes both desktop side panels with pointer drags", async () => {
    render(<WorkspaceShell slug="alice" initialWorkspaceMode="knowledge" initialFilePath="docs/plan.md" />);

    const leftSeparator = await screen.findByRole("separator", { name: "Resize left panel" });
    const rightSeparator = screen.getByRole("separator", { name: "Resize right panel" });

    fireEvent.pointerDown(leftSeparator, { clientX: 216, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 520, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    await waitFor(() => {
      const leftPanelWidth = Number.parseFloat(
        findSizedPanelContainer(screen.getByRole("button", { name: "Collapse knowledge panel" }))?.style.width ?? "0"
      );
      expect(leftPanelWidth).toBeCloseTo(520, 0);
    });

    fireEvent.pointerDown(rightSeparator, { clientX: 1008, pointerId: 2 });
    fireEvent.pointerMove(window, { clientX: 900, pointerId: 2 });
    fireEvent.pointerUp(window, { pointerId: 2 });

    await waitFor(() => {
      const rightPanelWidth = Number.parseFloat(
        findSizedPanelContainer(screen.getByRole("button", { name: "Review Panel" }))?.style.width ?? "0"
      );
      expect(rightPanelWidth).toBeGreaterThan(430);
    });

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("fits oversized persisted panel widths into a narrow desktop viewport", async () => {
    vi.mocked(HTMLDivElement.prototype.getBoundingClientRect).mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 900,
      right: 900,
      width: 900,
      height: 900,
      toJSON: () => ({}),
    });

    render(
      <WorkspaceShell
        slug="alice"
        initialWorkspaceMode="knowledge"
        initialFilePath="docs/plan.md"
        initialLayoutState={{
          leftCollapsed: false,
          leftWidth: 800,
          rightCollapsed: false,
          rightWidth: 800,
          rightTab: "review",
        }}
      />
    );

    const leftPanelButton = await screen.findByRole("button", { name: "Collapse knowledge panel" });
    const leftPanelWidth = Number.parseFloat(findSizedPanelContainer(leftPanelButton)?.style.width ?? "0");
    const rightPanelWidth = Number.parseFloat(
      findSizedPanelContainer(screen.getByRole("button", { name: "Review Panel" }))?.style.width ?? "0"
    );

    expect(leftPanelWidth).toBeLessThan(800);
    expect(rightPanelWidth).toBeGreaterThanOrEqual(320);
    expect(leftPanelWidth + rightPanelWidth).toBeLessThan(1600);
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
      findSizedPanelContainer(screen.getByRole("button", { name: "Review Panel" }))?.style.width ?? "0"
    );

    const expectedRightWidth = (1440 - 48) / 2;
    expect(rightPanelWidth).toBeCloseTo(expectedRightWidth, 0);
  });

  it("shows the flows empty state in flows mode", async () => {
    render(<WorkspaceShell slug="alice" />);

    fireEvent.click(await screen.findByRole("button", { name: "Flows" }));

    expect(await screen.findByText("Run a flow")).toBeTruthy();
  });

  it("keeps a recent local mode when stale server mode props arrive late", async () => {
    window.history.replaceState(null, "", "/w/alice?mode=knowledge&path=docs/plan.md");
    const { rerender } = render(<WorkspaceShell slug="alice" initialWorkspaceMode="knowledge" initialFilePath="docs/plan.md" />);

    fireEvent.click(await screen.findByRole("button", { name: "Flows" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Flows" }).getAttribute("aria-pressed")).toBe("true");
    });

    const params = new URLSearchParams(window.location.search);
    expect(params.get("mode")).toBe("flows");
    expect(params.get("path")).toBe("docs/plan.md");

    rerender(<WorkspaceShell slug="alice" initialWorkspaceMode="flows" />);
    rerender(<WorkspaceShell slug="alice" initialWorkspaceMode="knowledge" />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Flows" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Knowledge" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("uses the collapsed knowledge rail to switch tree and graph views", async () => {
    render(<WorkspaceShell slug="alice" initialWorkspaceMode="knowledge" initialFilePath="docs/plan.md" />);

    fireEvent.click(await screen.findByRole("button", { name: "Collapse knowledge panel" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand knowledge panel" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Show graph view" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Collapse knowledge panel" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Collapse knowledge panel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Show tree view" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Tree" })).toBeTruthy();
    });
  });

  it("caps the compact review badge label at 99 plus", async () => {
    setViewportWidth(720);
    workspaceMockOverrides = {
      diffs: Array.from({ length: 120 }, (_, index) => ({
        additions: 1,
        conflicted: false,
        deletions: 0,
        diff: "",
        path: `note-${index}.md`,
        status: "modified",
      })),
    };

    render(<WorkspaceShell slug="alice" initialWorkspaceMode="knowledge" initialFilePath="docs/plan.md" />);

    expect(await screen.findAllByText("99+")).toHaveLength(2);
  });

  it("opens the command palette with Command+K", async () => {
    render(<WorkspaceShell slug="alice" />);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        metaKey: true,
        bubbles: true,
      })
    );

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Workspace command palette" })).toBeTruthy();
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

  it("starts with the curator panel collapsed in chat mode and expands it on demand", async () => {
    render(<WorkspaceShell slug="alice" />);

    const expandButton = await screen.findByRole("button", { name: "Expand curator panel" });
    expect(screen.queryByText("Knowledge Curator")).toBeNull();

    fireEvent.click(expandButton);

    expect(await screen.findByText("Knowledge Curator")).toBeTruthy();
    expect(await screen.findByText("No pending proposals.")).toBeTruthy();
  });

  it("opens a curator learning run in the workspace session", async () => {
    learningApiResponse = {
      runs: [
        {
          id: "run-1",
          sourceSessionId: "root-session",
          internalSessionId: "internal-session-1",
          title: "Learning from session",
          trigger: "manual",
          status: "running",
          error: null,
          messageCount: 10,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      proposals: [],
    };

    render(<WorkspaceShell slug="alice" />);

    fireEvent.click(await screen.findByRole("button", { name: "Expand curator panel" }));
    expect(await screen.findByText("Learning from session")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open session" }));

    expect(selectSessionMock).toHaveBeenCalledWith("internal-session-1");
  });

  it("shows chat as default view in compact layout", async () => {
    setViewportWidth(720);
    render(<WorkspaceShell slug="alice" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open navigate panel" })).toBeTruthy();
    });

    expect(screen.getByText("Chat Panel")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open review panel" })).toBeTruthy();
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

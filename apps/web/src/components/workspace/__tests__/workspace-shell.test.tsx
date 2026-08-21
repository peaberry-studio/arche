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

const curatorDialogProps = vi.hoisted(() => ({ current: undefined as Record<string, unknown> | undefined }));

vi.mock("@/components/workspace/curator-dialog", () => ({
  CuratorDialog: (props: Record<string, unknown>) => {
    curatorDialogProps.current = props;
    return (
      <div data-testid="curator-dialog" data-open={String(props.open)} data-can-publish={String(Boolean(props.onPublish))} data-can-discard={String(Boolean(props.onDiscardFileChanges))} data-can-resolve={String(Boolean(props.onResolveConflict))}>
        <span>Curator Dialog</span>
        {props.onProposalCountChange ? (
          <button type="button" onClick={() => (props.onProposalCountChange as (count: number) => void)(3)}>
            Report proposal count
          </button>
        ) : null}
        <button type="button" onClick={() => (props.onOpenChange as (open: boolean) => void)(false)}>
          Close curator
        </button>
      </div>
    );
  },
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
    onProposalCountChange,
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
    onProposalCountChange?: (count: number) => void;
    onReloadFile?: (path: string) => Promise<void>;
    onResolveConflict?: (path: string) => void | Promise<void>;
    onSaveFile?: (path: string, content: string, expectedHash?: string) => Promise<{ ok: true; hash?: string } | { ok: false; error: string }>;
    onSelectFile?: (path: string) => void;
    onToggleRight: () => void;
    openFiles?: Array<{ path: string }>;
    panelMode?: "combined" | "files" | "knowledge" | "review";
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
        {panelMode === "files" ? "Files Panel" : panelMode === "knowledge" ? "Knowledge Panel" : panelMode === "review" ? "Review Panel" : "Inspector Panel"}
      </button>
      {panelMode === "knowledge" && onProposalCountChange ? (
        <button type="button" onClick={() => onProposalCountChange(3)}>Report proposal count</button>
      ) : null}
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
    curatorDialogProps.current = undefined;
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

  it("redirects to setup when the instance requires setup", async () => {
    ensureInstanceRunningActionMock.mockResolvedValueOnce({ status: "error", error: "setup_required" });

    render(<WorkspaceShell slug="alice" />);

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/u/alice?setup=required");
    });
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

  it("renders the sidebar chrome with nav and account menu instead of a top nav", async () => {
    render(<WorkspaceShell slug="alice" />);

    expect(await screen.findByRole("button", { name: "New chat" })).toBeTruthy();
    expect(screen.getByText("Arche")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Explore" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Curator" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Flows" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sessions" })).toBeNull();

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

  it("shows the desktop vault name and vault section in the sidebar account menu", async () => {
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
      expect(screen.getByRole("button", { name: "New chat" })).toBeTruthy();
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
    expect(desktopBridgeMocks.listRecentVaults).toHaveBeenCalledTimes(1);
  });

  it("shows a Knowledge badge that combines proposals and workspace changes", async () => {
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

    learningApiResponse = { runs: [], proposals: [{ status: "open" }] };

    render(<WorkspaceShell slug="alice" />);

    expect(await screen.findByLabelText("4 pending")).toBeTruthy();
  });

  it("auto-syncs the KB after the workspace connects", async () => {
    render(<WorkspaceShell slug="alice" />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/instances/alice/sync-kb", { method: "POST" });
    });
  });

  it("navigates to the flows manager from the sidebar nav", async () => {
    render(<WorkspaceShell slug="alice" />);

    fireEvent.click(await screen.findByRole("button", { name: "Flows" }));

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/u/alice/flows");
    });
  });

  it("passes disabled workspace-agent capabilities into chat and curator", async () => {
    render(<WorkspaceShell slug="alice" workspaceAgentEnabled={false} />);

    expect((await screen.findByTestId("chat-panel")).dataset.attachmentsEnabled).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Curator" }));

    const curator = await screen.findByTestId("curator-dialog");
    expect(curator.dataset.open).toBe("true");
    expect(curator.dataset.canPublish).toBe("false");
    expect(curator.dataset.canDiscard).toBe("false");
    expect(curator.dataset.canResolve).toBe("false");
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

  it("promotes a quickview file into Explore editing", async () => {
    render(<WorkspaceShell slug="alice" />);

    fireEvent.click(await screen.findByRole("button", { name: "Open plan preview" }));

    expect(await screen.findByText("Quickview")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit file" }));

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/w/alice/explore?path=docs%2Fplan.md");
    });

    expect(readFileMock).toHaveBeenCalledWith("docs/plan.md");
  });

  it("opens the Explore page from the sidebar nav", async () => {
    render(<WorkspaceShell slug="alice" />);

    fireEvent.click(await screen.findByRole("button", { name: "Explore" }));

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/w/alice/explore");
    });
  });

  it("toggles the sidebar with Command+B", async () => {
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

  it("opens the Curator modal over the chat workspace", async () => {
    render(<WorkspaceShell slug="alice" />);

    fireEvent.click(await screen.findByRole("button", { name: "Curator" }));

    const curator = await screen.findByTestId("curator-dialog");
    expect(curator.dataset.open).toBe("true");
    expect(screen.getByRole("button", { name: "Collapse sessions panel" })).toBeTruthy();
    expect(screen.getByText("Chat Panel")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close curator" }));

    await waitFor(() => {
      expect(screen.getByTestId("curator-dialog").dataset.open).toBe("false");
    });
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

  it("caps the Curator badge label at 99 plus", async () => {
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

    render(<WorkspaceShell slug="alice" />);

    expect(await screen.findByLabelText("120 pending")).toBeTruthy();
    expect(screen.getAllByText("99+")).toHaveLength(1);
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

    render(<WorkspaceShell slug="alice" />);

    await waitFor(() => {
      expect(window.localStorage.getItem("arche.workspace.alice.layout")).toContain('"rightCollapsed":true');
    });

    const leftPanelWrapper = screen.getByTestId("panes-left");

    expect(leftPanelWrapper.style.width).toBe("264px");
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
      expect(screen.getByRole("button", { name: "Expand sessions panel" })).toBeTruthy();
    });
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

  it("takes the Curator badge count from the dialog without refetching it", async () => {
    render(<WorkspaceShell slug="alice" />);

    fireEvent.click(await screen.findByRole("button", { name: "Curator" }));
    await screen.findByTestId("curator-dialog");

    const learningCalls = () => (globalThis.fetch as unknown as { mock: { calls: unknown[][] } })
      .mock.calls.filter(([input]) => String(input).endsWith("/learning")).length;
    await waitFor(() => expect(learningCalls()).toBeGreaterThan(0));
    const callsBefore = learningCalls();

    fireEvent.click(screen.getByRole("button", { name: "Report proposal count" }));

    expect(await screen.findByLabelText("3 pending")).toBeTruthy();
    expect(learningCalls()).toBe(callsBefore);
  });

  it("refetches the knowledge pending count when entering Curator", async () => {
    render(<WorkspaceShell slug="alice" />);

    await screen.findByRole("button", { name: "New chat" });
    const learningCalls = () => (globalThis.fetch as unknown as { mock: { calls: unknown[][] } })
      .mock.calls.filter(([input]) => String(input).endsWith("/learning")).length;
    await waitFor(() => expect(learningCalls()).toBeGreaterThan(0));
    const callsBefore = learningCalls();

    fireEvent.click(screen.getByRole("button", { name: "Curator" }));

    await waitFor(() => expect(learningCalls()).toBeGreaterThan(callsBefore));
    expect(screen.getByTestId("curator-dialog").dataset.open).toBe("true");
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
});

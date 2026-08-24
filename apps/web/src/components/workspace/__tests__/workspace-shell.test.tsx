/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubBrowserStorage } from "@/__tests__/storage";
import { WorkspaceRuntimeProvider } from "@/contexts/workspace-runtime-context";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

const { ensureInstanceRunningActionMock } = vi.hoisted(() => ({
  ensureInstanceRunningActionMock: vi.fn().mockResolvedValue({ status: "running" }),
}));

const instanceStartupMock = vi.hoisted(() => vi.fn())
const connectionMock = vi.hoisted(() => vi.fn())

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
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("@/actions/spawner", () => ({
  ensureInstanceRunningAction: ensureInstanceRunningActionMock,
}));

vi.mock("@/hooks/use-instance-startup", () => ({
  useInstanceStartup: () => instanceStartupMock(),
}));

vi.mock("@/hooks/use-workspace-connection", () => ({
  useWorkspaceConnection: () => connectionMock(),
}));

vi.mock("@/hooks/use-instance-heartbeat", () => ({
  useInstanceHeartbeat: () => undefined,
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
        <button type="button" onClick={() => (props.onOpenFile as (path: string) => void)("docs/plan.md")}>
          Open manual edit file
        </button>
        <button type="button" onClick={() => (props.onOpenChange as (open: boolean) => void)(false)}>
          Close curator
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/workspace/knowledge-graph-panel", () => ({
  KnowledgeGraphPanel: () => <div>Knowledge Graph Panel</div>,
}));

function renderWorkspaceShell(props: Parameters<typeof WorkspaceShell>[0]) {
  return render(
    <WorkspaceRuntimeProvider slug={props.slug ?? "alice"} persistenceScope={props.persistenceScope ?? props.slug ?? "alice"}>
      <WorkspaceShell {...props} />
    </WorkspaceRuntimeProvider>
  )
}

async function openCuratorFromCommandPalette() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
    })
  )
  await screen.findByRole("dialog", { name: "Workspace command palette" })
  fireEvent.click(screen.getByText("Open Curator"))
  await screen.findByTestId("curator-dialog")
}

function clearCookies() {
  document.cookie.split(';').forEach((cookie) => {
    const [name] = cookie.trim().split('=');
    if (!name) return;

    document.cookie = `${name}=; Path=/; Max-Age=0`;
  });
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
    instanceStartupMock.mockReturnValue({ instanceStatus: "running", instanceError: null });
    connectionMock.mockReturnValue({
      connection: { status: "connected" },
      isConnected: true,
    });
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

  it("shows an in-pane banner while the instance is starting", async () => {
    instanceStartupMock.mockReturnValue({ instanceStatus: "starting", instanceError: null });
    connectionMock.mockReturnValue({
      connection: { status: "connecting" },
      isConnected: false,
    });

    renderWorkspaceShell({ slug: "alice" });

    expect(await screen.findByText("Starting workspace")).toBeTruthy();
  });

  it("shows a startup failure banner when the instance failed to start", async () => {
    instanceStartupMock.mockReturnValue({ instanceStatus: "error", instanceError: "start_timeout" });

    renderWorkspaceShell({ slug: "alice" });

    expect(await screen.findByText("Failed to start")).toBeTruthy();
  });

  it("shows an in-pane OpenCode connection error banner", async () => {
    instanceStartupMock.mockReturnValue({ instanceStatus: "running", instanceError: null });
    connectionMock.mockReturnValue({
      connection: { status: "error", error: "socket down" },
      isConnected: false,
    });

    renderWorkspaceShell({ slug: "alice" });

    expect(await screen.findByText("Connecting to OpenCode")).toBeTruthy();
    expect(screen.getByText("Error: socket down")).toBeTruthy();
  });

  it("opens the empty composer with Command+Period", async () => {
    renderWorkspaceShell({ slug: "alice" });

    await waitFor(() => {
      expect(screen.getByText("Chat Panel")).toBeTruthy();
    });

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ".",
        metaKey: true,
        bubbles: true,
      })
    );

    await waitFor(() => {
      expect(selectSessionMock).toHaveBeenCalledWith(null);
    });
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(routerPushMock).toHaveBeenCalledWith("/w/alice");
  });

  it("auto-syncs the KB after the workspace connects", async () => {
    renderWorkspaceShell({ slug: "alice" });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/instances/alice/sync-kb", { method: "POST" });
    });
  });

  it("passes disabled workspace-agent capabilities into chat and curator", async () => {
    renderWorkspaceShell({ slug: "alice", workspaceAgentEnabled: false });

    expect((await screen.findByTestId("chat-panel")).dataset.attachmentsEnabled).toBe("false");

    await openCuratorFromCommandPalette();

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

    renderWorkspaceShell({ slug: "alice" });

    expect((await screen.findByTestId("chat-panel")).dataset.readOnly).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Return to main conversation" }));

    expect(selectSession).toHaveBeenCalledWith("root-session");
  });

  it("mirrors the active session into the ?session= URL param", async () => {
    window.history.replaceState(null, "", "/w/alice?session=stale-session");
    renderWorkspaceShell({ slug: "alice" });

    await screen.findByTestId("chat-panel");

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/w/alice?session=root-session");
    });
  });

  it("removes the ?session= param when no conversation is active", async () => {
    window.history.replaceState(null, "", "/w/alice?session=deleted-session");
    workspaceMockOverrides = { activeSessionId: null };
    renderWorkspaceShell({ slug: "alice" });

    await screen.findByTestId("chat-panel");

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/w/alice");
    });
  });

  it("does not rewrite the session param until sessions are ready", async () => {
    window.history.replaceState(null, "", "/w/alice?session=pending-session");
    workspaceMockOverrides = { activeSessionId: null, isInitialSessionsReady: false };
    renderWorkspaceShell({ slug: "alice" });

    await screen.findByTestId("chat-panel");

    expect(routerReplaceMock).not.toHaveBeenCalled();
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

    renderWorkspaceShell({ slug: "alice" });

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

    renderWorkspaceShell({ slug: "alice" });

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
    renderWorkspaceShell({ slug: "alice" });

    fireEvent.click(await screen.findByRole("button", { name: "Open plan preview" }));

    expect(await screen.findByText("Quickview")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit file" }));

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/w/alice/explore?path=docs%2Fplan.md");
    });

    expect(readFileMock).toHaveBeenCalledWith("docs/plan.md");
  });

it("opens the Curator modal over the chat workspace", async () => {
    renderWorkspaceShell({ slug: "alice" });

    await openCuratorFromCommandPalette();

    const curator = await screen.findByTestId("curator-dialog");
    expect(curator.dataset.open).toBe("true");
    expect(screen.getByText("Chat Panel")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close curator" }));

    await waitFor(() => {
      expect(screen.getByTestId("curator-dialog").dataset.open).toBe("false");
    });
  });

  it("closes the Curator when a manual edit file is opened in Explore", async () => {
    renderWorkspaceShell({ slug: "alice" });

    await openCuratorFromCommandPalette();
    const curator = await screen.findByTestId("curator-dialog");
    expect(curator.dataset.open).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Open manual edit file" }));

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/w/alice/explore?path=docs%2Fplan.md");
    });
    await waitFor(
      () => {
        expect(screen.getByTestId("curator-dialog").dataset.open).toBe("false");
      },
      // The dialog close is a separate state update after the navigation.
      { timeout: 5000 }
    );
  });

  it("does not render a workspace sections nav (chrome owns mobile navigation)", () => {
    setViewportWidth(390);
    renderWorkspaceShell({ slug: "alice" });

    expect(screen.queryByRole("navigation", { name: "Workspace sections" })).toBeNull();
  });

  it("shows fallback quickview content when preview file loading fails", async () => {
    readFileMock.mockResolvedValueOnce(null);

    renderWorkspaceShell({ slug: "alice" });

    fireEvent.click(await screen.findByRole("button", { name: "Open plan preview" }));

    expect(await screen.findByText("Quickview")).toBeTruthy();
    expect(screen.getByText("Unable to load file.")).toBeTruthy();
  });

  it("closes the quickview panel", async () => {
    renderWorkspaceShell({ slug: "alice" });

    fireEvent.click(await screen.findByRole("button", { name: "Open plan preview" }));
    expect(await screen.findByText("Quickview")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));

    expect(screen.queryByText("Quickview")).toBeNull();
  });

  it("opens the command palette with Command+K", async () => {
    renderWorkspaceShell({ slug: "alice" });

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

});

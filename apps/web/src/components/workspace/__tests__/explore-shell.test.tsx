/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubBrowserStorage } from "@/__tests__/storage";
import { WorkspaceRuntimeProvider } from "@/contexts/workspace-runtime-context";
import { ExploreShell } from "@/components/workspace/explore-shell";

function renderExploreShell(props: Parameters<typeof ExploreShell>[0]) {
  return render(
    <WorkspaceRuntimeProvider slug={props.slug ?? "alice"} persistenceScope={props.persistenceScope ?? props.slug ?? "alice"}>
      <ExploreShell {...props} />
    </WorkspaceRuntimeProvider>
  )
}

const { ensureInstanceRunningActionMock } = vi.hoisted(() => ({
  ensureInstanceRunningActionMock: vi.fn().mockResolvedValue({ status: "running" }),
}));

const routerPushMock = vi.fn();
const onOpenFileMock = vi.fn().mockResolvedValue(undefined);

const workspaceOverrides = vi.hoisted(() => ({
  current: {
    openFiles: [] as unknown[],
    openFilePaths: [] as string[],
    activeFilePath: null as string | null,
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock, replace: vi.fn() }),
  useSearchParams: () => null,
}));

vi.mock("@/actions/spawner", () => ({
  ensureInstanceRunningAction: ensureInstanceRunningActionMock,
}));

const instanceStartupMock = vi.hoisted(() => vi.fn())
const connectionMock = vi.hoisted(() => vi.fn())

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
    themeId: "warm-sand",
    isDark: false,
  }),
}));

vi.mock("@/hooks/use-explore-workspace", () => ({
  useExploreWorkspace: () => {
    const override = workspaceOverrides.current;
    return {
      connection: { status: "connected" as const },
      isConnected: true,
      fileTree: [],
      isLoadingFiles: false,
      refreshFiles: vi.fn(),
      readFile: vi.fn(),
      diffs: [],
      isLoadingDiffs: false,
      diffsError: null,
      refreshDiffs: vi.fn(),
      openFiles: override.openFiles,
      openFilePaths: override.openFilePaths,
      activeFilePath: override.activeFilePath,
      markdownFilePaths: [],
      onSelectFile: vi.fn(),
      onCloseFile: vi.fn(),
      onOpenFile: onOpenFileMock,
      onSaveFile: vi.fn(),
      onReloadFile: vi.fn(),
      onDiscardFileChanges: vi.fn(),
      onResolveConflict: vi.fn(),
      onPublish: vi.fn(),
      onDownloadFile: vi.fn(),
      onExportFileDocx: vi.fn(),
      onExportFilePdf: vi.fn(),
    };
  },
}));

vi.mock("@/components/workspace/knowledge-navigation-panel", () => ({
  KnowledgeNavigationPanel: ({
    onOpenFile,
    onViewChange,
    view,
  }: {
    onOpenFile: (path: string) => void;
    onViewChange: (view: "tree" | "graph") => void;
    view: "tree" | "graph";
  }) => (
    <div>
      <button type="button" onClick={() => onOpenFile("docs/plan.md")}>
        Open from tree
      </button>
      <button type="button" onClick={() => onViewChange(view === "tree" ? "graph" : "tree")}>
        {view === "tree" ? "Show Graph" : "Show Tree"}
      </button>
    </div>
  ),
}));

vi.mock("@/components/workspace/inspector-panel", () => ({
  InspectorPanel: ({
    openFiles = [],
    activeFilePath,
  }: {
    openFiles?: Array<{ path: string }>;
    activeFilePath?: string | null;
  }) => (
    <button
      type="button"
      data-open-files={openFiles.map((file) => file.path).join(",")}
      data-active-path={activeFilePath ?? ""}
    >
      Files Panel
    </button>
  ),
}));

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  window.dispatchEvent(new Event("resize"));
}

describe("ExploreShell", () => {
  beforeEach(() => {
    stubBrowserStorage();
    setViewportWidth(1440);
    routerPushMock.mockClear();
    onOpenFileMock.mockClear();
    workspaceOverrides.current = { openFiles: [], openFilePaths: [], activeFilePath: null };
    ensureInstanceRunningActionMock.mockReset();
    ensureInstanceRunningActionMock.mockResolvedValue({ status: "running" });
    instanceStartupMock.mockReturnValue({ instanceStatus: "running", instanceError: null });
    connectionMock.mockReturnValue({
      connection: { status: "connected" },
      isConnected: true,
    });
    vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 900,
      right: 1200,
      width: 1200,
      height: 900,
      toJSON: () => ({}),
    });
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows a startup failure when the instance errors", async () => {
    instanceStartupMock.mockReturnValue({ instanceStatus: "error", instanceError: "Workspace startup timed out. Try restarting again." });

    renderExploreShell({ slug: "alice", persistenceScope: "alice" });

    expect(await screen.findByText("Failed to start")).toBeTruthy();
    expect(screen.getByText("Workspace startup timed out. Try restarting again.")).toBeTruthy();
  });

  it("renders the explore tree and empty state once running", async () => {
    renderExploreShell({ slug: "alice", persistenceScope: "alice" });

    expect(await screen.findByRole("button", { name: "Open from tree" })).toBeTruthy();
    expect(await screen.findByText("Browse your knowledge base")).toBeTruthy();
  });

  it("shows the multi-file editor panel when files are open", async () => {
    workspaceOverrides.current = {
      openFilePaths: ["docs/plan.md"],
      activeFilePath: "docs/plan.md",
      openFiles: [{ path: "docs/plan.md" }],
    };

    renderExploreShell({ slug: "alice", persistenceScope: "alice" });

    const filesPanel = await screen.findByRole("button", { name: "Files Panel" });
    expect(filesPanel.dataset.openFiles).toBe("docs/plan.md");
    expect(screen.queryByText("Browse your knowledge base")).toBeNull();
  });

  it("does not render a Back to Sessions header (sidebar handles navigation)", async () => {
    renderExploreShell({ slug: "alice", persistenceScope: "alice" });

    await screen.findByRole("button", { name: "Open from tree" });
    expect(screen.queryByRole("button", { name: "Back to Sessions" })).toBeNull();
  });

  it("opens a file from the tree panel into the editor", async () => {
    renderExploreShell({ slug: "alice", persistenceScope: "alice" });

    fireEvent.click(await screen.findByRole("button", { name: "Open from tree" }));

    await waitFor(() => {
      expect(onOpenFileMock).toHaveBeenCalledWith("docs/plan.md");
    });
  });

  it("switches the nav panel between Tree and Graph views", async () => {
    renderExploreShell({ slug: "alice", persistenceScope: "alice" });

    expect(await screen.findByRole("button", { name: "Show Graph" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show Graph" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Show Tree" })).toBeTruthy();
    });
  });

  it("toggles between tree and viewer on compact layouts", async () => {
    setViewportWidth(700);
    renderExploreShell({ slug: "alice", persistenceScope: "alice" });

    expect(await screen.findByRole("button", { name: "Close file tree" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close file tree" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Open file viewer" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Close file viewer" }).getAttribute("aria-pressed")).toBe("true");
    });
    expect(screen.getByRole("button", { name: "Open file tree" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Open file tree" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Close file tree" }).getAttribute("aria-pressed")).toBe("true");
    });
  });
});

/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubBrowserStorage } from "@/__tests__/storage";
import { ExploreShell } from "@/components/workspace/explore-shell";

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
    panelMode = "combined",
    openFiles = [],
    activeFilePath,
  }: {
    panelMode?: string;
    openFiles?: Array<{ path: string }>;
    activeFilePath?: string | null;
  }) => (
    <button
      type="button"
      data-panel-mode={panelMode}
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
    ensureInstanceRunningActionMock.mockResolvedValueOnce({
      status: "error",
      error: "start_timeout",
    });

    render(<ExploreShell slug="alice" persistenceScope="alice" />);

    expect(await screen.findByText("Failed to start")).toBeTruthy();
    expect(screen.getByText("Workspace startup timed out. Try restarting again.")).toBeTruthy();
  });

  it("renders the explore header, tree, and empty state once running", async () => {
    render(<ExploreShell slug="alice" persistenceScope="alice" />);

    expect(await screen.findByText("Back to Sessions")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Open from tree" })).toBeTruthy();
    expect(await screen.findByText("Browse your knowledge base")).toBeTruthy();
  });

  it("shows the multi-file editor panel when files are open", async () => {
    workspaceOverrides.current = {
      openFilePaths: ["docs/plan.md"],
      activeFilePath: "docs/plan.md",
      openFiles: [{ path: "docs/plan.md" }],
    };

    render(<ExploreShell slug="alice" persistenceScope="alice" />);

    const filesPanel = await screen.findByRole("button", { name: "Files Panel" });
    expect(filesPanel.dataset.panelMode).toBe("files");
    expect(filesPanel.dataset.openFiles).toBe("docs/plan.md");
    expect(screen.queryByText("Browse your knowledge base")).toBeNull();
  });

  it("navigates back to sessions with the Explore header button", async () => {
    render(<ExploreShell slug="alice" persistenceScope="alice" />);

    fireEvent.click(await screen.findByRole("button", { name: "Back to Sessions" }));

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/w/alice");
    });
  });

  it("opens a file from the tree panel into the editor", async () => {
    render(<ExploreShell slug="alice" persistenceScope="alice" />);

    fireEvent.click(await screen.findByRole("button", { name: "Open from tree" }));

    await waitFor(() => {
      expect(onOpenFileMock).toHaveBeenCalledWith("docs/plan.md");
    });
  });

  it("switches the nav panel between Tree and Graph views", async () => {
    render(<ExploreShell slug="alice" persistenceScope="alice" />);

    expect(await screen.findByRole("button", { name: "Show Graph" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show Graph" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Show Tree" })).toBeTruthy();
    });
  });

  it("toggles between tree and viewer on compact layouts", async () => {
    setViewportWidth(700);
    render(<ExploreShell slug="alice" persistenceScope="alice" />);

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

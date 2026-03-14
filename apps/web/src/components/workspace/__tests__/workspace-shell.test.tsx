/** @vitest-environment jsdom */

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceShell } from "@/components/workspace/workspace-shell";

const createSessionMock = vi.fn().mockResolvedValue(undefined);

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("@/actions/spawner", () => ({
  ensureInstanceRunningAction: vi.fn().mockResolvedValue({ status: "running" }),
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
  InspectorPanel: () => <div>Inspector Panel</div>,
}));

vi.mock("@/components/workspace/left-panel", () => ({
  LeftPanel: () => <div>Left Panel</div>,
}));

describe("WorkspaceShell", () => {
  beforeEach(() => {
    createSessionMock.mockClear();
  });

  it("creates a new session with Command+Period", async () => {
    render(<WorkspaceShell slug="alice" />);

    await waitFor(() => {
      expect(document.body.textContent).toContain("Left Panel");
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
});

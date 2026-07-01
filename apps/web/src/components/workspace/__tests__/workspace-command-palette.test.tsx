/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceCommandPalette } from "@/components/workspace/workspace-command-palette"
import type { WorkspaceFileNode, WorkspaceSession } from "@/lib/opencode/types"

const listSessionsActionMock = vi.fn()
const searchFilesActionMock = vi.fn()
const loadFlowsMock = vi.fn()
const runFlowMock = vi.fn()
const setThemeIdMock = vi.fn()
const toggleDarkMock = vi.fn()

vi.mock("@/actions/opencode", () => ({
  listSessionsAction: (...args: unknown[]) => listSessionsActionMock(...args),
  searchFilesAction: (...args: unknown[]) => searchFilesActionMock(...args),
}))

vi.mock("@/contexts/workspace-theme-context", () => ({
  useWorkspaceTheme: () => ({
    themeId: "warm-sand",
    themes: [
      { id: "warm-sand", name: "Warm Sand" },
      { id: "slate", name: "Slate" },
    ],
    setThemeId: setThemeIdMock,
    toggleDark: toggleDarkMock,
  }),
}))

vi.mock("@/hooks/use-flow-runner", () => ({
  useFlowRunner: () => ({
    flows: [
      {
        id: "flow-1",
        name: "Daily report",
        description: "Prepare account summary",
        definition: { version: 1, startNodeId: "node-1", nodes: [], edges: [] },
      },
    ],
    isLoadingFlows: false,
    runningFlowId: null,
    runError: null,
    loadFlows: loadFlowsMock,
    runFlow: runFlowMock,
  }),
}))

type PaletteHandlers = {
  onCreateSession: ReturnType<typeof vi.fn>
  onModeChange: ReturnType<typeof vi.fn>
  onOpenFile: ReturnType<typeof vi.fn>
  onNavigateConnectors: ReturnType<typeof vi.fn>
  onNavigateProviders: ReturnType<typeof vi.fn>
  onNavigateSettings: ReturnType<typeof vi.fn>
  onOpenChange: ReturnType<typeof vi.fn>
  onRefreshSessions: ReturnType<typeof vi.fn>
  onSelectSession: ReturnType<typeof vi.fn>
  onToggleLeftPanel: ReturnType<typeof vi.fn>
  onToggleRightPanel: ReturnType<typeof vi.fn>
}

function makeHandlers(): PaletteHandlers {
  return {
    onCreateSession: vi.fn().mockResolvedValue(undefined),
    onModeChange: vi.fn(),
    onOpenFile: vi.fn().mockResolvedValue(undefined),
    onNavigateConnectors: vi.fn(),
    onNavigateProviders: vi.fn(),
    onNavigateSettings: vi.fn(),
    onOpenChange: vi.fn(),
    onRefreshSessions: vi.fn().mockResolvedValue(undefined),
    onSelectSession: vi.fn(),
    onToggleLeftPanel: vi.fn(),
    onToggleRightPanel: vi.fn(),
  }
}

const fileNodes: WorkspaceFileNode[] = [
  {
    id: "Company",
    name: "Company",
    path: "Company",
    type: "directory",
    children: [
      {
        id: "Company/Product Strategy.md",
        name: "Product Strategy.md",
        path: "Company/Product Strategy.md",
        type: "file",
      },
      {
        id: "Company/Research/Customer Interviews.md",
        name: "Customer Interviews.md",
        path: "Company/Research/Customer Interviews.md",
        type: "file",
      },
    ],
  },
]

const palettePlaceholder = "Search commands, files, chats, flows..."

function renderPalette(options?: { fileNodes?: WorkspaceFileNode[]; hideFlows?: boolean; handlers?: PaletteHandlers }) {
  const handlers = options?.handlers ?? makeHandlers()
  render(
    <WorkspaceCommandPalette
      fileNodes={options?.fileNodes ?? fileNodes}
      slug="alice"
      open
      hideFlows={options?.hideFlows ?? false}
      {...handlers}
    />
  )
  return handlers
}

describe("WorkspaceCommandPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listSessionsActionMock.mockResolvedValue({ ok: true, sessions: [] })
    searchFilesActionMock.mockResolvedValue({ ok: true, files: [] })
    runFlowMock.mockResolvedValue(undefined)
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    }
  })

  afterEach(() => {
    cleanup()
  })

  it("loads flows when opened and runs the selected new chat command", async () => {
    const handlers = renderPalette()

    expect(loadFlowsMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText("Go to Flows mode")).not.toBeNull()

    fireEvent.change(screen.getByPlaceholderText(palettePlaceholder), {
      target: { value: "new chat" },
    })
    fireEvent.keyDown(screen.getByPlaceholderText(palettePlaceholder), {
      key: "Enter",
    })

    await waitFor(() => expect(handlers.onOpenChange).toHaveBeenCalledWith(false))
    expect(handlers.onModeChange).toHaveBeenCalledWith("chat")
    expect(handlers.onCreateSession).toHaveBeenCalledTimes(1)
  })

  it("searches root sessions and opens a flow run result in flows mode", async () => {
    const sessions = [
      {
        id: "flow-session",
        title: "Weekly run",
        status: "idle",
        updatedAt: "now",
        updatedAtRaw: 1,
        flow: {
          runId: "run-1",
          flowId: "flow-1",
          flowName: "Weekly KPI",
          status: "succeeded",
          trigger: "manual",
          hasUnseenResult: false,
        },
      },
    ] satisfies WorkspaceSession[]
    listSessionsActionMock.mockResolvedValue({ ok: true, sessions })
    const handlers = renderPalette()

    fireEvent.change(screen.getByPlaceholderText(palettePlaceholder), {
      target: { value: "weekly" },
    })

    await waitFor(() => {
      expect(listSessionsActionMock).toHaveBeenCalledWith("alice", {
        limit: 100,
        query: "weekly",
        rootsOnly: true,
      })
    })
    expect(await screen.findByText("Weekly run")).not.toBeNull()

    fireEvent.click(screen.getByText("Weekly run"))

    await waitFor(() => expect(handlers.onOpenChange).toHaveBeenCalledWith(false))
    expect(handlers.onSelectSession).toHaveBeenCalledWith("flow-session", "flows")
  })

  it("hides flow commands and flow search results when flows are unavailable", async () => {
    const sessions = [
      {
        id: "flow-session",
        title: "Hidden flow run",
        status: "idle",
        updatedAt: "now",
        updatedAtRaw: 1,
        flow: {
          runId: "run-1",
          flowId: "flow-1",
          flowName: "Hidden flow",
          status: "succeeded",
          trigger: "manual",
          hasUnseenResult: false,
        },
      },
      {
        id: "chat-session",
        title: "Visible chat",
        status: "idle",
        updatedAt: "now",
        updatedAtRaw: 2,
      },
    ] satisfies WorkspaceSession[]
    listSessionsActionMock.mockResolvedValue({ ok: true, sessions })
    renderPalette({ hideFlows: true })

    expect(loadFlowsMock).not.toHaveBeenCalled()
    expect(screen.queryByText("Go to Flows mode")).toBeNull()

    fireEvent.change(screen.getByPlaceholderText(palettePlaceholder), {
      target: { value: "run" },
    })

    expect(await screen.findByText("Visible chat")).not.toBeNull()
    expect(screen.queryByText("Hidden flow run")).toBeNull()
  })

  it("runs theme, layout, navigation, and flow commands", async () => {
    const handlers = renderPalette()
    const input = screen.getByPlaceholderText(palettePlaceholder)

    fireEvent.change(input, { target: { value: "slate" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(setThemeIdMock).toHaveBeenCalledWith("slate"))

    fireEvent.change(input, { target: { value: "left panel" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(handlers.onToggleLeftPanel).toHaveBeenCalledTimes(1))

    fireEvent.change(input, { target: { value: "providers" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(handlers.onNavigateProviders).toHaveBeenCalledTimes(1))

    fireEvent.change(input, { target: { value: "daily report" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(runFlowMock).toHaveBeenCalledWith("flow-1"))
    expect(handlers.onModeChange).toHaveBeenCalledWith("flows")
  })

  it("finds files by fuzzy name and opens them in knowledge mode", async () => {
    searchFilesActionMock.mockResolvedValue({ ok: true, files: ["Company/Research/Customer Interviews.md"] })
    const handlers = renderPalette()
    const input = screen.getByPlaceholderText(palettePlaceholder)

    fireEvent.change(input, { target: { value: "prd strat" } })

    expect(await screen.findByText("Product Strategy.md")).not.toBeNull()
    fireEvent.click(screen.getByText("Product Strategy.md"))

    await waitFor(() => expect(handlers.onOpenChange).toHaveBeenCalledWith(false))
    expect(handlers.onModeChange).toHaveBeenCalledWith("knowledge")
    expect(handlers.onOpenFile).toHaveBeenCalledWith("Company/Product Strategy.md")
  })

  it("includes file results returned by workspace search", async () => {
    searchFilesActionMock.mockResolvedValue({ ok: true, files: ["Deep/Vault/Roadmap.md"] })
    renderPalette({ fileNodes: [] })
    const input = screen.getByPlaceholderText(palettePlaceholder)

    fireEvent.change(input, { target: { value: "road" } })

    await waitFor(() => {
      expect(searchFilesActionMock).toHaveBeenCalledWith("alice", "road")
    })
    expect(await screen.findByText("Roadmap.md")).not.toBeNull()
  })

  it("clears search loading state when search actions reject", async () => {
    listSessionsActionMock.mockRejectedValue(new Error("session unavailable"))
    searchFilesActionMock.mockRejectedValue(new Error("file search unavailable"))
    renderPalette()
    const input = screen.getByPlaceholderText(palettePlaceholder)

    fireEvent.change(input, { target: { value: "does-not-exist" } })

    await waitFor(() => {
      expect(listSessionsActionMock).toHaveBeenCalledWith("alice", {
        limit: 100,
        query: "does-not-exist",
        rootsOnly: true,
      })
    })
    await waitFor(() => expect(screen.getByText("No commands, files, or sessions found.")).not.toBeNull())
    expect(screen.queryByText("Searching...")).toBeNull()
  })

  it("supports keyboard navigation, hover selection, empty results, and dark mode", async () => {
    listSessionsActionMock.mockResolvedValue({ ok: false })
    searchFilesActionMock.mockResolvedValue({ ok: false })
    const handlers = renderPalette()
    const input = screen.getByPlaceholderText(palettePlaceholder)

    fireEvent.keyDown(input, { key: "ArrowDown" })
    fireEvent.keyDown(input, { key: "ArrowUp" })
    fireEvent.mouseMove(screen.getByText("Open connectors"))
    fireEvent.click(screen.getByText("Open connectors"))
    await waitFor(() => expect(handlers.onNavigateConnectors).toHaveBeenCalledTimes(1))

    fireEvent.change(input, { target: { value: "dark mode" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(toggleDarkMock).toHaveBeenCalledTimes(1))

    fireEvent.change(input, { target: { value: "does-not-exist" } })
    await waitFor(() => expect(screen.getByText("No commands, files, or sessions found.")).not.toBeNull())
  })
})

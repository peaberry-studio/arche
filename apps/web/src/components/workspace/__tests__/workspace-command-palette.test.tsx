/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceCommandPalette } from "@/components/workspace/workspace-command-palette"
import type { WorkspaceSession } from "@/lib/opencode/types"

const listSessionsActionMock = vi.fn()
const loadTasksMock = vi.fn()
const runTaskMock = vi.fn()
const setThemeIdMock = vi.fn()
const toggleDarkMock = vi.fn()

vi.mock("@/actions/opencode", () => ({
  listSessionsAction: (...args: unknown[]) => listSessionsActionMock(...args),
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

vi.mock("@/hooks/use-autopilot-task-runner", () => ({
  useAutopilotTaskRunner: () => ({
    tasks: [
      { id: "task-1", name: "Daily report", prompt: "Prepare account summary" },
    ],
    isLoadingTasks: false,
    runningTaskId: null,
    runError: null,
    loadTasks: loadTasksMock,
    runTask: runTaskMock,
  }),
}))

type PaletteHandlers = {
  onCreateSession: ReturnType<typeof vi.fn>
  onModeChange: ReturnType<typeof vi.fn>
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

function renderPalette(options?: { hideTasks?: boolean; handlers?: PaletteHandlers }) {
  const handlers = options?.handlers ?? makeHandlers()
  render(
    <WorkspaceCommandPalette
      slug="alice"
      open
      hideTasks={options?.hideTasks ?? false}
      {...handlers}
    />
  )
  return handlers
}

describe("WorkspaceCommandPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listSessionsActionMock.mockResolvedValue({ ok: true, sessions: [] })
    runTaskMock.mockResolvedValue(undefined)
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    }
  })

  afterEach(() => {
    cleanup()
  })

  it("loads tasks when opened and runs the selected new chat command", async () => {
    const handlers = renderPalette()

    expect(loadTasksMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText("Go to Tasks mode")).not.toBeNull()

    fireEvent.change(screen.getByPlaceholderText("Search commands, chats, tasks..."), {
      target: { value: "new chat" },
    })
    fireEvent.keyDown(screen.getByPlaceholderText("Search commands, chats, tasks..."), {
      key: "Enter",
    })

    await waitFor(() => expect(handlers.onOpenChange).toHaveBeenCalledWith(false))
    expect(handlers.onModeChange).toHaveBeenCalledWith("chat")
    expect(handlers.onCreateSession).toHaveBeenCalledTimes(1)
  })

  it("searches root sessions and opens a task run result in tasks mode", async () => {
    const sessions = [
      {
        id: "task-session",
        title: "Weekly run",
        status: "idle",
        updatedAt: "now",
        updatedAtRaw: 1,
        autopilot: { runId: "run-1", taskName: "Weekly KPI" },
      },
    ] satisfies WorkspaceSession[]
    listSessionsActionMock.mockResolvedValue({ ok: true, sessions })
    const handlers = renderPalette()

    fireEvent.change(screen.getByPlaceholderText("Search commands, chats, tasks..."), {
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
    expect(handlers.onSelectSession).toHaveBeenCalledWith("task-session", "tasks")
  })

  it("hides task commands and task search results when tasks are unavailable", async () => {
    const sessions = [
      {
        id: "task-session",
        title: "Hidden task run",
        status: "idle",
        updatedAt: "now",
        updatedAtRaw: 1,
        autopilot: { runId: "run-1", taskName: "Hidden task" },
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
    renderPalette({ hideTasks: true })

    expect(loadTasksMock).not.toHaveBeenCalled()
    expect(screen.queryByText("Go to Tasks mode")).toBeNull()

    fireEvent.change(screen.getByPlaceholderText("Search commands, chats, tasks..."), {
      target: { value: "run" },
    })

    expect(await screen.findByText("Visible chat")).not.toBeNull()
    expect(screen.queryByText("Hidden task run")).toBeNull()
  })

  it("runs theme, layout, navigation, and task commands", async () => {
    const handlers = renderPalette()
    const input = screen.getByPlaceholderText("Search commands, chats, tasks...")

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
    await waitFor(() => expect(runTaskMock).toHaveBeenCalledWith("task-1"))
    expect(handlers.onModeChange).toHaveBeenCalledWith("tasks")
  })

  it("supports keyboard navigation, hover selection, empty results, and dark mode", async () => {
    listSessionsActionMock.mockResolvedValue({ ok: false })
    const handlers = renderPalette()
    const input = screen.getByPlaceholderText("Search commands, chats, tasks...")

    fireEvent.keyDown(input, { key: "ArrowDown" })
    fireEvent.keyDown(input, { key: "ArrowUp" })
    fireEvent.mouseMove(screen.getByText("Open connectors"))
    fireEvent.click(screen.getByText("Open connectors"))
    await waitFor(() => expect(handlers.onNavigateConnectors).toHaveBeenCalledTimes(1))

    fireEvent.change(input, { target: { value: "dark mode" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(toggleDarkMock).toHaveBeenCalledTimes(1))

    fireEvent.change(input, { target: { value: "does-not-exist" } })
    await waitFor(() => expect(screen.getByText("No commands or sessions found.")).not.toBeNull())
  })
})

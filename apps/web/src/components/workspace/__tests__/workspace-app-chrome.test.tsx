/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceAppChrome } from "@/components/workspace/workspace-app-chrome";
import { WorkspaceRuntimeProvider } from "@/contexts/workspace-runtime-context";

const instanceStartupMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-instance-startup", () => ({
  useInstanceStartup: () => instanceStartupMock(),
}));

const connectionMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-workspace-connection", () => ({
  useWorkspaceConnection: () => connectionMock(),
}));

const heartbeatMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-instance-heartbeat", () => ({
  useInstanceHeartbeat: () => heartbeatMock(),
}));

const sessionsMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/workspace/use-workspace-sessions", () => ({
  useWorkspaceSessions: () => sessionsMock(),
}));

const navigation = vi.hoisted(() => ({
  pathname: "/w/alice" as string | null,
  push: vi.fn(),
  replace: vi.fn(),
  searchParams: null as URLSearchParams | null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({
    push: navigation.push,
    replace: navigation.replace,
  }),
  useSearchParams: () => navigation.searchParams,
}));

vi.mock("@/contexts/workspace-theme-context", () => ({
  useWorkspaceTheme: () => ({
    themeId: "warm-sand",
    isDark: false,
  }),
}));

vi.mock("@/components/workspace/workspace-account-menu", () => ({
  WorkspaceAccountMenu: () => <div data-testid="workspace-account-menu">Account</div>,
}));

vi.mock("@/components/workspace/workspace-sidebar", () => ({
  WorkspaceSidebar: (props: { activeSessionId: string | null; accountMenu?: (collapsed: boolean) => React.ReactNode; curatorOpen: boolean; onCreateSession: () => void; onSelectSession: (id: string) => void }) => (
    <div data-testid="workspace-sidebar" data-active-session={props.activeSessionId ?? ""} data-curator={String(props.curatorOpen)}>
      <button type="button" aria-pressed={false}>Knowledge Base</button>
      <button type="button">Curator</button>
      <button type="button">Agents</button>
      <button type="button">Skills</button>
      <button type="button">Flows</button>
      <button type="button" onClick={() => void props.onCreateSession()}>New chat</button>
      <button type="button" onClick={() => props.onSelectSession("session-1")}>Pick session</button>
      {props.accountMenu ? props.accountMenu(false) : null}
    </div>
  ),
}));

function renderChrome(children: React.ReactNode) {
  return render(
    <WorkspaceRuntimeProvider slug="alice" persistenceScope="alice">
      <WorkspaceAppChrome slug="alice" persistenceScope="alice">
        {children}
      </WorkspaceAppChrome>
    </WorkspaceRuntimeProvider>
  )
}

describe("WorkspaceAppChrome", () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    navigation.pathname = "/w/alice"
    navigation.searchParams = null
    navigation.push.mockReset()
    navigation.replace.mockReset()
    instanceStartupMock.mockReturnValue({ instanceStatus: "running", instanceError: null })
    connectionMock.mockReturnValue({
      connection: { status: "connected" },
      isConnected: true,
    })
    heartbeatMock.mockReturnValue(undefined)
    sessionsMock.mockReturnValue({
      sessions: [],
      activeSessionId: null,
      createSession: vi.fn(async () => null),
      selectSession: vi.fn(),
      sessionActions: {},
    })
  })

  it("renders the sidebar around a chat child", () => {
    renderChrome(<div data-testid="chat-child">Chat</div>)

    expect(screen.getByTestId("workspace-sidebar")).toBeTruthy()
    expect(screen.getByTestId("chat-child")).toBeTruthy()
  })

  it("renders the sidebar around an explore child", () => {
    renderChrome(<div data-testid="explore-child">Explore</div>)

    expect(screen.getByTestId("workspace-sidebar")).toBeTruthy()
    expect(screen.getByTestId("explore-child")).toBeTruthy()
  })

  it("does not render a Back to Sessions header", () => {
    renderChrome(<div>Explore</div>)

    expect(screen.queryByRole("button", { name: "Back to Sessions" })).toBeNull()
  })

  it("renders the sidebar with nav and account menu", () => {
    renderChrome(<div>Chat</div>)

    expect(screen.getByTestId("workspace-sidebar")).toBeTruthy()
    expect(screen.getByTestId("workspace-account-menu")).toBeTruthy()
  })

  it("routes a session selection from explore back to the chat URL", () => {
    navigation.pathname = "/w/alice/explore"
    renderChrome(<div>Explore</div>)

    fireEvent.click(screen.getByRole("button", { name: "Pick session" }))

    expect(navigation.push).toHaveBeenCalledWith("/w/alice?session=session-1")
  })

  it("routes a session selection out of a catalog view", () => {
    navigation.pathname = "/w/alice"
    navigation.searchParams = new URLSearchParams("catalog=agents")
    renderChrome(<div>Catalog</div>)

    fireEvent.click(screen.getByRole("button", { name: "Pick session" }))

    expect(navigation.push).toHaveBeenCalledWith("/w/alice?session=session-1")
  })

  it("routes a session selection out of the flows overlay", () => {
    navigation.pathname = "/w/alice"
    navigation.searchParams = new URLSearchParams("flows=list")
    renderChrome(<div>Chat</div>)

    fireEvent.click(screen.getByRole("button", { name: "Pick session" }))

    expect(navigation.push).toHaveBeenCalledWith("/w/alice?session=session-1")
  })

  it("keeps session selection state-only on the plain chat route", () => {
    navigation.pathname = "/w/alice"
    navigation.searchParams = new URLSearchParams()
    renderChrome(<div>Chat</div>)

    fireEvent.click(screen.getByRole("button", { name: "Pick session" }))

    expect(navigation.push).not.toHaveBeenCalled()
    expect(navigation.replace).not.toHaveBeenCalled()
  })

  it("routes a new chat back to the workspace root from explore", async () => {
    navigation.pathname = "/w/alice/explore"
    renderChrome(<div>Explore</div>)

    fireEvent.click(screen.getByRole("button", { name: "New chat" }))

    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/w/alice"))
  })
})

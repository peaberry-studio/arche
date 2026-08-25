/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceAccountMenu } from "@/components/workspace/workspace-account-menu";

const desktopBridgeMocks = vi.hoisted(() => ({
  getOptionalDesktopBridge: vi.fn(),
  listRecentVaults: vi.fn(),
  openExistingVault: vi.fn(),
  openVault: vi.fn(),
  openVaultLauncher: vi.fn(),
}));

vi.mock("@/lib/runtime/desktop/client", () => ({
  getOptionalDesktopBridge: desktopBridgeMocks.getOptionalDesktopBridge,
}));

vi.mock("@/contexts/workspace-theme-context", () => ({
  useWorkspaceTheme: () => ({
    canDecreaseChatFontSize: true,
    canIncreaseChatFontSize: true,
    chatFontFamily: "sans",
    chatFontSize: 15,
    decreaseChatFontSize: vi.fn(),
    increaseChatFontSize: vi.fn(),
    isDark: false,
    setChatFontFamily: vi.fn(),
    setThemeId: vi.fn(),
    themeId: "warm-sand",
    themes: [
      { id: "warm-sand", name: "Warm Sand", swatch: "#d6a35f" },
      { id: "slate", name: "Slate", swatch: "#64748b" },
    ],
    toggleDark: vi.fn(),
  }),
}));

vi.mock("@/components/workspace/sync-kb-button", () => ({
  SyncKbButton: () => <button type="button">Sync KB</button>,
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function openWorkspaceMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Workspace account menu" }), {
    button: 0,
    ctrlKey: false,
  });
}

function renderMenu(
  currentVault: { id: string; name: string; path: string } | null = {
    id: "current",
    name: "Current Vault",
    path: "/vaults/current",
  },
  overrides: Record<string, unknown> = {}
) {
  const props = {
    slug: "local",
    currentUserId: "user-1",
    currentVault,
    status: "active",
    onNavigateConnectors: vi.fn(),
    onNavigateProviders: vi.fn(),
    onNavigateSettings: vi.fn(),
    ...overrides,
  } as Parameters<typeof WorkspaceAccountMenu>[0];
  render(<WorkspaceAccountMenu {...props} />);
}

describe("WorkspaceAccountMenu", () => {
  beforeEach(() => {
    desktopBridgeMocks.listRecentVaults.mockResolvedValue([
      { id: "current", name: "Current Vault", path: "/vaults/current" },
      { id: "team", name: "Team Vault", path: "/vaults/team" },
    ]);
    desktopBridgeMocks.openExistingVault.mockResolvedValue({ ok: true });
    desktopBridgeMocks.openVault.mockResolvedValue({ ok: true });
    desktopBridgeMocks.openVaultLauncher.mockResolvedValue({ ok: true });
    desktopBridgeMocks.getOptionalDesktopBridge.mockReturnValue({
      listRecentVaults: desktopBridgeMocks.listRecentVaults,
      openExistingVault: desktopBridgeMocks.openExistingVault,
      openVault: desktopBridgeMocks.openVault,
      openVaultLauncher: desktopBridgeMocks.openVaultLauncher,
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();

      if (url.endsWith("/connectors")) {
        return jsonResponse({ connectors: [] });
      }

      if (url.endsWith("/providers")) {
        return jsonResponse({ providers: [] });
      }

      return jsonResponse({ ok: true });
    }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the user dropdown trigger labelled from the slug", () => {
    renderMenu(null);

    const accountMenuButton = screen.getByRole("button", { name: "Workspace account menu" });
    expect(accountMenuButton.textContent).toContain("local");
  });

  it("opens the vault menu on click (desktop)", async () => {
    renderMenu();

    await waitFor(() => {
      expect(desktopBridgeMocks.listRecentVaults).toHaveBeenCalledTimes(1);
    });

    openWorkspaceMenu();

    expect(await screen.findByText("Current vault")).toBeTruthy();
    expect(screen.getByText("/vaults/current")).toBeTruthy();
    expect(await screen.findByText("Team Vault")).toBeTruthy();
  });

  it("shows connectors with status when available", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
        return jsonResponse({ providers: [] });
      }

      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderMenu();

    openWorkspaceMenu();

    expect(await screen.findByText("Connectors")).toBeTruthy();
    expect(await screen.findByText("1 active")).toBeTruthy();
  });

  it("shows providers with status when available", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();

      if (url.endsWith("/connectors")) {
        return jsonResponse({ connectors: [] });
      }

      if (url.endsWith("/providers")) {
        return jsonResponse({
          providers: [
            { providerId: "openai", status: "enabled", type: "api", version: 1 },
            { providerId: "anthropic", status: "disabled", type: "api" },
          ],
        });
      }

      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderMenu();

    openWorkspaceMenu();

    expect(await screen.findByText("Providers")).toBeTruthy();
    expect(await screen.findByText("1 active")).toBeTruthy();
  });

  it("shows appearance options", async () => {
    renderMenu();

    openWorkspaceMenu();

    expect(await screen.findByText("Appearance")).toBeTruthy();
    expect(screen.getByLabelText("Warm Sand")).toBeTruthy();
    expect(screen.getByLabelText("Slate")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sans" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Serif" })).toBeTruthy();
  });

  it("shows the settings option", async () => {
    renderMenu();

    openWorkspaceMenu();

    expect(await screen.findByText("Settings")).toBeTruthy();
  });

  it("handles vault actions including recent vaults and errors", async () => {
    desktopBridgeMocks.openVault.mockResolvedValueOnce({ ok: false, error: "vault_already_open" });
    desktopBridgeMocks.openVaultLauncher.mockResolvedValueOnce({ ok: false, error: "vault_launch_failed" });

    renderMenu();

    await waitFor(() => {
      expect(desktopBridgeMocks.listRecentVaults).toHaveBeenCalledTimes(1);
    });

    openWorkspaceMenu();

    fireEvent.click(await screen.findByText("Team Vault"));

    await waitFor(() => {
      expect(desktopBridgeMocks.openVault).toHaveBeenCalledWith("/vaults/team");
    });
    expect(screen.getByText("That vault is already open in another Arche process.")).toBeTruthy();

    fireEvent.click(screen.getByText("Create New Vault..."));

    expect(await screen.findByText("Arche could not open the selected vault.")).toBeTruthy();

    fireEvent.click(screen.getByText("Open Vault..."));

    await waitFor(() => {
      expect(desktopBridgeMocks.openExistingVault).toHaveBeenCalledTimes(1);
    });
  });

  it("renders an icon-only trigger when collapsed", async () => {
    renderMenu(null, { collapsed: true });

    const accountMenuButton = screen.getByRole("button", { name: "Workspace account menu" });
    expect(accountMenuButton.textContent).not.toContain("local");

    openWorkspaceMenu();

    expect(await screen.findByText("Settings")).toBeTruthy();
  });

  it("does not fetch connector or provider status until the menu opens", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    renderMenu();

    await waitFor(() => {
      expect(desktopBridgeMocks.listRecentVaults).toHaveBeenCalledTimes(1);
    });

    const integrationCalls = () => fetchMock.mock.calls.filter(
      ([input]) => String(input).endsWith("/connectors") || String(input).endsWith("/providers")
    );
    expect(integrationCalls()).toHaveLength(0);

    openWorkspaceMenu();

    await waitFor(() => {
      expect(integrationCalls().length).toBeGreaterThan(0);
    });
  });
});

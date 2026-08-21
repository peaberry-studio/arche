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

function renderTopNav(
  currentVault: { id: string; name: string; path: string } | null = {
    id: "current",
    name: "Current Vault",
    path: "/vaults/current",
  }
) {
  render(
    <WorkspaceAccountMenu
      slug="local"
      currentVault={currentVault}
      status="active"
      onNavigateConnectors={vi.fn()}
      onNavigateProviders={vi.fn()}
      onNavigateSettings={vi.fn()}
    />
  );
}

describe("WorkspaceAccountMenu desktop vault menu", () => {
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

  it("opens recent vaults and shows desktop action errors from the workspace menu", async () => {
    desktopBridgeMocks.openVault.mockResolvedValueOnce({ ok: false, error: "vault_already_open" });
    desktopBridgeMocks.openVaultLauncher.mockResolvedValueOnce({ ok: false, error: "vault_launch_failed" });

    renderTopNav();

    await waitFor(() => {
      expect(desktopBridgeMocks.listRecentVaults).toHaveBeenCalledTimes(1);
    });

    openWorkspaceMenu();

    expect(await screen.findByText("Team Vault")).toBeTruthy();
    expect(screen.getByText("/vaults/current")).toBeTruthy();
    expect(screen.queryByText("Recent vaults")).toBeTruthy();

    fireEvent.click(screen.getByText("Team Vault"));

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
    await waitFor(() => {
      expect(screen.queryByText("Arche could not open the selected vault.")).toBeNull();
    });
  });

  it("closes the workspace menu without an error when opening a vault is cancelled", async () => {
    desktopBridgeMocks.openExistingVault.mockResolvedValueOnce({ ok: false, error: "cancelled" });

    renderTopNav();

    await waitFor(() => {
      expect(desktopBridgeMocks.listRecentVaults).toHaveBeenCalledTimes(1);
    });

    openWorkspaceMenu();

    expect(await screen.findByText("Open Vault...")).toBeTruthy();

    fireEvent.click(screen.getByText("Open Vault..."));

    await waitFor(() => {
      expect(desktopBridgeMocks.openExistingVault).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByText("Current vault")).toBeNull();
    });
    expect(screen.queryByText("cancelled")).toBeNull();
  });

  it("renders without recent vaults when the desktop bridge is unavailable", async () => {
    desktopBridgeMocks.getOptionalDesktopBridge.mockReturnValue(null);

    renderTopNav();

    openWorkspaceMenu();

    expect(await screen.findByText("Current vault")).toBeTruthy();
    expect(screen.queryByText("Recent vaults")).toBeNull();

    fireEvent.click(screen.getByText("Create New Vault..."));
    fireEvent.click(screen.getByText("Open Vault..."));

    expect(desktopBridgeMocks.openVaultLauncher).not.toHaveBeenCalled();
    expect(desktopBridgeMocks.openExistingVault).not.toHaveBeenCalled();
  });

  it("keeps web mode on the slug menu without a vault section", async () => {
    renderTopNav(null);

    const accountMenuButton = screen.getByRole("button", { name: "Workspace account menu" });
    expect(accountMenuButton.textContent).toContain("local");

    openWorkspaceMenu();

    expect(await screen.findByText("Connectors")).toBeTruthy();
    expect(screen.queryByText("Current vault")).toBeNull();
    expect(desktopBridgeMocks.listRecentVaults).not.toHaveBeenCalled();
  });
});

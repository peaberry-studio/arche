/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopVaultSwitcher } from "@/components/desktop/desktop-vault-switcher";

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

function openVaultMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: /Current Vault/i }), {
    button: 0,
    ctrlKey: false,
  });
}

describe("DesktopVaultSwitcher", () => {
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
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens recent vaults and shows desktop action errors", async () => {
    desktopBridgeMocks.openVault.mockResolvedValueOnce({ ok: false, error: "vault_already_open" });
    desktopBridgeMocks.openVaultLauncher.mockResolvedValueOnce({ ok: false, error: "vault_launch_failed" });

    render(
      <DesktopVaultSwitcher
        currentVault={{ id: "current", name: "Current Vault", path: "/vaults/current" }}
      />
    );

    await waitFor(() => {
      expect(desktopBridgeMocks.listRecentVaults).toHaveBeenCalledTimes(1);
    });

    openVaultMenu();

    expect(await screen.findByText("Team Vault")).toBeTruthy();
    expect(screen.queryByText("/vaults/current")).toBeTruthy();

    fireEvent.click(screen.getByText("Team Vault"));

    await waitFor(() => {
      expect(desktopBridgeMocks.openVault).toHaveBeenCalledWith("/vaults/team");
    });
    expect(screen.getByText("That vault is already open in another Arche process.")).toBeTruthy();

    openVaultMenu();
    fireEvent.click(await screen.findByText("Create New Vault..."));

    expect(await screen.findByText("Arche could not open the selected vault.")).toBeTruthy();

    openVaultMenu();
    fireEvent.click(await screen.findByText("Open Existing Vault..."));

    await waitFor(() => {
      expect(screen.queryByText("Arche could not open the selected vault.")).toBeNull();
    });
  });

  it("renders without recent vaults when the desktop bridge is unavailable", async () => {
    desktopBridgeMocks.getOptionalDesktopBridge.mockReturnValue(null);

    render(
      <DesktopVaultSwitcher
        currentVault={{ id: "current", name: "Current Vault", path: "/vaults/current" }}
      />
    );

    openVaultMenu();

    expect(await screen.findByText("Current vault")).toBeTruthy();
    expect(screen.queryByText("Recent vaults")).toBeNull();

    fireEvent.click(screen.getByText("Create New Vault..."));
    openVaultMenu();
    fireEvent.click(await screen.findByText("Open Existing Vault..."));

    expect(desktopBridgeMocks.openVaultLauncher).not.toHaveBeenCalled();
    expect(desktopBridgeMocks.openExistingVault).not.toHaveBeenCalled();
  });
});

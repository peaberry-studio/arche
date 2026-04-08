import { contextBridge, ipcRenderer } from 'electron'

type DesktopVaultSummary = {
  id: string
  name: string
  path: string
  lastOpenedAt?: string
}

type DesktopApiResult =
  | { ok: true }
  | { ok: false; error: string }

type CreateVaultArgs = {
  parentPath: string
  name: string
}

contextBridge.exposeInMainWorld('arche', {
  platform: process.platform,
  isDesktop: true,
  desktop: {
    createVault: (args: CreateVaultArgs) =>
      ipcRenderer.invoke('desktop:create-vault', args) as Promise<DesktopApiResult>,
    getCurrentVault: () =>
      ipcRenderer.invoke('desktop:get-current-vault') as Promise<DesktopVaultSummary | null>,
    listRecentVaults: () =>
      ipcRenderer.invoke('desktop:list-recent-vaults') as Promise<DesktopVaultSummary[]>,
    openExistingVault: () =>
      ipcRenderer.invoke('desktop:open-existing-vault') as Promise<DesktopApiResult>,
    openVault: (vaultPath: string) =>
      ipcRenderer.invoke('desktop:open-vault', vaultPath) as Promise<DesktopApiResult>,
    openVaultLauncher: () =>
      ipcRenderer.invoke('desktop:open-vault-launcher') as Promise<DesktopApiResult>,
    pickVaultParentDirectory: () =>
      ipcRenderer.invoke('desktop:pick-vault-parent-directory') as Promise<string | null>,
  },
})

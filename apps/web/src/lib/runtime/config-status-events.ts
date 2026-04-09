export type ConfigChangeReason = 'config' | 'provider_sync'

export const WORKSPACE_CONFIG_STATUS_CHANGED_EVENT = 'arche:workspace-config-status-changed'

export function getConfigChangeMessage(reason: ConfigChangeReason | null): string {
  if (reason === 'provider_sync') {
    return 'Provider changes need a workspace restart to apply.'
  }

  return 'Configuration changes detected. Restart to apply them.'
}

export function notifyWorkspaceConfigChanged(): void {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new Event(WORKSPACE_CONFIG_STATUS_CHANGED_EVENT))
}

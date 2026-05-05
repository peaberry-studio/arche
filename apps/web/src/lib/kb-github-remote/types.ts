export type KbGithubRemoteIntegrationSummary = {
  appId: string | null
  appSlug: string | null
  appConfigured: boolean
  hasPrivateKey: boolean
  installationId: number | null
  repoFullName: string | null
  ready: boolean
  lastSyncAt: string | null
  lastSyncStatus: 'success' | 'error' | 'conflicts' | null
  lastError: string | null
  remoteBranch: string | null
  version: number
  updatedAt: string | null
}

export type KbGithubRemoteRepo = {
  fullName: string
  cloneUrl: string
  private: boolean
}

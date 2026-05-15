export type KbGithubRemoteSyncStatus = 'success' | 'error' | 'conflicts' | null

export type KbGithubRemoteIntegrationSummary = {
  appConfigured: boolean
  appId: string | null
  appSlug: string | null
  hasPrivateKey: boolean
  installationAccount: string | null
  installationId: number | null
  lastError: string | null
  lastSyncAt: string | null
  lastSyncStatus: KbGithubRemoteSyncStatus
  ready: boolean
  repoDefaultBranch: string | null
  repoFullName: string | null
  updatedAt: string | null
  version: number
}

export type KbGithubRemoteRepo = {
  defaultBranch: string
  fullName: string
  private: boolean
}

export type KbGithubRemoteWorkspaceConfig = {
  branch: string
  repoCloneUrl: string
  token: string
}

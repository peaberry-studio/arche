export type KbGithubRemoteIntegrationSummary = {
  repoUrl: string | null
  configured: boolean
  hasPat: boolean
  lastSyncAt: string | null
  lastSyncStatus: 'success' | 'error' | 'conflicts' | null
  lastError: string | null
  remoteBranch: string | null
  version: number
  updatedAt: string | null
}

export type KbGithubRemoteIntegrationGetResponse = KbGithubRemoteIntegrationSummary

export type KbGithubRemoteIntegrationMutateRequest = {
  repoUrl?: string
  pat?: string
}

export type KbGithubRemoteIntegrationMutateResponse = KbGithubRemoteIntegrationGetResponse

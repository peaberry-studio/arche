export type GoogleWorkspaceIntegrationSummary = {
  clientId: string | null
  configured: boolean
  hasClientSecret: boolean
  version: number
  updatedAt: string | null
}

export type GoogleWorkspaceIntegrationGetResponse = {
  clientId: string | null
  configured: boolean
  hasClientSecret: boolean
  version: number
  updatedAt: string | null
}

export type GoogleWorkspaceIntegrationMutateRequest = {
  clientId?: string
  clientSecret?: string
}

export type GoogleWorkspaceIntegrationMutateResponse = GoogleWorkspaceIntegrationGetResponse

export type RuntimeUser = {
  id: string
  email: string
  slug: string
  role: string
}

export type RuntimeSessionResult = {
  user: RuntimeUser
  sessionId: string
} | null

export type RuntimeSession = {
  getUser: () => Promise<RuntimeSessionResult>
}

export type WorkspaceHostConnection = {
  baseUrl: string
  authHeader: string
}

export type WorkspaceHostStatus = {
  status: 'running' | 'starting' | 'stopped' | 'error'
  startedAt: Date | null
  stoppedAt: Date | null
  lastActivityAt: Date | null
}

export type WorkspaceHost = {
  start: (slug: string, userId: string) => Promise<
    | { ok: true; status: string }
    | { ok: false; error: string; detail?: string }
  >
  stop: (slug: string, userId: string) => Promise<
    | { ok: true; status: string }
    | { ok: false; error: string }
  >
  getStatus: (slug: string) => Promise<WorkspaceHostStatus | null>
  getConnection: (slug: string) => Promise<WorkspaceHostConnection | null>
  getAgentConnection: (slug: string) => Promise<WorkspaceHostConnection | null>
}

export type RuntimePaths = {
  kbConfigRoot: () => string
  kbContentRoot: () => string
  usersBasePath: () => string
  userDataPath: (slug: string) => string
}

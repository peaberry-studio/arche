export { getRuntimeMode, isWeb, isDesktop, type RuntimeMode } from '@/lib/runtime/mode'
export { getRuntimeCapabilities, type RuntimeCapabilities } from '@/lib/runtime/capabilities'
export { getSession } from '@/lib/runtime/session'
export {
  getWorkspaceAgentConnection,
  getWorkspaceConnection,
  getWorkspaceStatus,
  startWorkspace,
  stopWorkspace,
} from '@/lib/runtime/workspace-host'
export type {
  RuntimeUser,
  RuntimeSessionResult,
  RuntimeSession,
  WorkspaceHostConnection,
  WorkspaceHostStatus,
  WorkspaceHost,
  RuntimePaths,
} from '@/lib/runtime/types'

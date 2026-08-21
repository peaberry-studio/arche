export type WorkspaceMode = 'chat' | 'explore' | 'knowledge'

/**
 * The union accepted by mode-change entry points. `flows` is not a workspace
 * mode; it redirects to the flows manager, so it is a valid request but never
 * becomes the active mode.
 */
export type WorkspaceModeRequest = WorkspaceMode | 'flows'

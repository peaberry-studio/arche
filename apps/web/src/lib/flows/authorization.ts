import type { FlowVisibility } from '@/lib/flows/types'

export type FlowPermissionActor = {
  id: string
  role: string
}

export type FlowPermissionRecord = {
  organizationCanRun: boolean
  userId: string
  visibility: FlowVisibility
}

export type FlowRunPermissionRecord = {
  executionUserId: string | null
  flow: FlowPermissionRecord
}

export type FlowActorScope = {
  actor: FlowPermissionActor
  workspaceUserId: string
}

export function createFlowActorScope(actor: FlowPermissionActor, workspaceUserId: string): FlowActorScope {
  return { actor, workspaceUserId }
}

export function isAdminFlowActor(actor: FlowPermissionActor): boolean {
  return actor.role === 'ADMIN'
}

export function isFlowOwner(actor: FlowPermissionActor, flow: FlowPermissionRecord): boolean {
  return actor.id === flow.userId
}

export function isFlowRunExecutionUser(actor: FlowPermissionActor, run: FlowRunPermissionRecord): boolean {
  return actor.id === (run.executionUserId ?? run.flow.userId)
}

export function flowVisibleToWorkspaceWhere(scope: FlowActorScope) {
  return {
    deletedAt: null,
    OR: [
      { userId: scope.workspaceUserId },
      { visibility: 'team' as const },
    ],
  }
}

export function runVisibleToWorkspaceWhere(scope: FlowActorScope) {
  return {
    OR: [
      { flow: { userId: scope.workspaceUserId } },
      { executionUserId: scope.workspaceUserId },
    ],
  }
}

export function runExecutesInWorkspaceWhere(scope: FlowActorScope) {
  return {
    OR: [
      { executionUserId: scope.workspaceUserId },
      { executionUserId: null, flow: { userId: scope.workspaceUserId } },
    ],
  }
}

import {
  isAdminFlowActor,
  isFlowOwner,
  isFlowRunExecutionUser,
  type FlowPermissionActor,
  type FlowPermissionRecord,
  type FlowRunPermissionRecord,
} from '@/lib/flows/authorization'

export function canViewFlow(actor: FlowPermissionActor, flow: FlowPermissionRecord): boolean {
  return isFlowOwner(actor, flow) || isAdminFlowActor(actor) || flow.visibility === 'team'
}

export function canRunFlow(actor: FlowPermissionActor, flow: FlowPermissionRecord): boolean {
  return isFlowOwner(actor, flow) || isAdminFlowActor(actor) || (flow.visibility === 'team' && flow.organizationCanRun)
}

export function canEditFlow(actor: FlowPermissionActor, flow: FlowPermissionRecord): boolean {
  return isFlowOwner(actor, flow) || isAdminFlowActor(actor)
}

export function canManageFlow(actor: FlowPermissionActor, flow: FlowPermissionRecord): boolean {
  return canEditFlow(actor, flow)
}

export function canCopyFlow(actor: FlowPermissionActor, flow: FlowPermissionRecord): boolean {
  return canViewFlow(actor, flow)
}

export function canViewFlowRun(actor: FlowPermissionActor, run: FlowRunPermissionRecord): boolean {
  return isAdminFlowActor(actor) || isFlowRunExecutionUser(actor, run)
}

export function canCancelFlowRun(actor: FlowPermissionActor, run: FlowRunPermissionRecord): boolean {
  return isAdminFlowActor(actor) || isFlowRunExecutionUser(actor, run)
}

import type { FlowVisibility } from '@/lib/flows/types'

type FlowPermissionActor = {
  id: string
  role: string
}

type FlowPermissionRecord = {
  organizationCanRun: boolean
  userId: string
  visibility: FlowVisibility
}

type FlowRunPermissionRecord = {
  executionUserId: string | null
  flow: FlowPermissionRecord
}

function isAdmin(actor: FlowPermissionActor): boolean {
  return actor.role === 'ADMIN'
}

function isOwner(actor: FlowPermissionActor, flow: FlowPermissionRecord): boolean {
  return actor.id === flow.userId
}

function isExecutionUser(actor: FlowPermissionActor, run: FlowRunPermissionRecord): boolean {
  return actor.id === (run.executionUserId ?? run.flow.userId)
}

export function canViewFlow(actor: FlowPermissionActor, flow: FlowPermissionRecord): boolean {
  return isOwner(actor, flow) || isAdmin(actor) || flow.visibility === 'team'
}

export function canRunFlow(actor: FlowPermissionActor, flow: FlowPermissionRecord): boolean {
  return isOwner(actor, flow) || isAdmin(actor) || (flow.visibility === 'team' && flow.organizationCanRun)
}

export function canEditFlow(actor: FlowPermissionActor, flow: FlowPermissionRecord): boolean {
  return isOwner(actor, flow) || isAdmin(actor)
}

export function canManageFlow(actor: FlowPermissionActor, flow: FlowPermissionRecord): boolean {
  return canEditFlow(actor, flow)
}

export function canCopyFlow(actor: FlowPermissionActor, flow: FlowPermissionRecord): boolean {
  return canViewFlow(actor, flow)
}

export function canViewFlowRun(actor: FlowPermissionActor, run: FlowRunPermissionRecord): boolean {
  return isAdmin(actor) || isExecutionUser(actor, run)
}

export function canCancelFlowRun(actor: FlowPermissionActor, run: FlowRunPermissionRecord): boolean {
  return isAdmin(actor) || isExecutionUser(actor, run)
}

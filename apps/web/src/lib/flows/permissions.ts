type FlowPermissionActor = {
  id: string
  role: string
}

type FlowPermissionRecord = {
  organizationCanRun: boolean
  userId: string
  visibility: string
}

function isAdmin(actor: FlowPermissionActor): boolean {
  return actor.role === 'ADMIN'
}

function isOwner(actor: FlowPermissionActor, flow: FlowPermissionRecord): boolean {
  return actor.id === flow.userId
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

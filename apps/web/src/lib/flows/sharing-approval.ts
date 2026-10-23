import { createHash } from 'node:crypto'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(Reflect.get(value, key))]))
  }
  return value
}

export function getFlowDefinitionRevision(definition: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(definition ?? null))).digest('hex')
}

export function hasFlowSharingApproval(flow: { definition?: unknown; organizationApprovedHash?: string | null }): boolean {
  return !!flow.organizationApprovedHash && flow.definition !== undefined &&
    flow.organizationApprovedHash === getFlowDefinitionRevision(flow.definition)
}

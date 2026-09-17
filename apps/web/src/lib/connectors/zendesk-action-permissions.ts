import {
  getStoredConnectorToolPermissions,
  type ConnectorToolPermissionMap,
} from '@/lib/connectors/tool-permissions'
import {
  ZENDESK_ACTION_KEYS,
  ZENDESK_ACTION_PERMISSIONS_CONFIG_KEY,
  ZENDESK_ACTION_PERMISSIONS_VERSION,
  type ZendeskActionName,
  type ZendeskActionPermissions,
  type ZendeskActionPermissionsConfig,
  type ZendeskActionPolicy,
  type ZendeskConnectorPermissions,
} from '@/lib/connectors/zendesk-types'
import { hasOwnProperty, isRecord } from '@/lib/connectors/zendesk-values'

const LEGACY_TOOL_NAME_TO_ACTION: Record<string, ZendeskActionName | null> = {
  search_tickets: 'search_tickets',
  get_ticket: 'get_ticket',
  list_ticket_comments: 'list_ticket_comments',
  create_ticket: null,
  update_ticket: null,
}

const LEGACY_ACTION_COVERAGE: Record<ZendeskActionName, {
  booleans: (keyof ZendeskConnectorPermissions)[]
  legacyTool: 'create_ticket' | 'update_ticket' | null
}> = {
  search_tickets: { booleans: ['allowRead'], legacyTool: null },
  get_ticket: { booleans: ['allowRead'], legacyTool: null },
  list_ticket_comments: { booleans: ['allowRead'], legacyTool: null },
  create_ticket_public: {
    booleans: ['allowCreateTickets', 'allowPublicComments'],
    legacyTool: 'create_ticket',
  },
  create_ticket_internal: {
    booleans: ['allowCreateTickets', 'allowInternalComments'],
    legacyTool: 'create_ticket',
  },
  update_ticket_fields: { booleans: ['allowUpdateTickets'], legacyTool: 'update_ticket' },
  update_ticket_with_public_comment: {
    booleans: ['allowUpdateTickets', 'allowPublicComments'],
    legacyTool: 'update_ticket',
  },
  update_ticket_with_internal_note: {
    booleans: ['allowUpdateTickets', 'allowInternalComments'],
    legacyTool: 'update_ticket',
  },
}

const RESTRICTIVE_ORDER: Record<ZendeskActionPolicy, number> = {
  allow: 0,
  ask: 1,
  deny: 2,
}

function mostRestrictive(left: ZendeskActionPolicy, right: ZendeskActionPolicy): ZendeskActionPolicy {
  return RESTRICTIVE_ORDER[left] >= RESTRICTIVE_ORDER[right] ? left : right
}

export function parseZendeskActionPermissionsConfig(
  value: unknown
): { ok: true; value: ZendeskActionPermissionsConfig } | { ok: false; message: string } {
  if (!isRecord(value)) {
    return { ok: false, message: 'zendeskActionPermissions must be an object' }
  }

  if (value.version !== ZENDESK_ACTION_PERMISSIONS_VERSION) {
    return { ok: false, message: `zendeskActionPermissions.version must be ${ZENDESK_ACTION_PERMISSIONS_VERSION}` }
  }

  if (!isRecord(value.actions)) {
    return { ok: false, message: 'zendeskActionPermissions.actions must be an object' }
  }

  const actions: Partial<Record<ZendeskActionName, ZendeskActionPolicy>> = {}
  for (const key of ZENDESK_ACTION_KEYS) {
    if (!hasOwnProperty(value.actions, key)) {
      return { ok: false, message: `zendeskActionPermissions.actions.${key} is required` }
    }

    const policy = value.actions[key]
    if (policy !== 'deny' && policy !== 'ask' && policy !== 'allow') {
      return { ok: false, message: `zendeskActionPermissions.actions.${key} must be deny, ask or allow` }
    }

    actions[key] = policy
  }

  return {
    ok: true,
    value: {
      version: ZENDESK_ACTION_PERMISSIONS_VERSION,
      actions: actions as ZendeskActionPermissions,
    },
  }
}

function combinePolicy(
  left: ZendeskActionPolicy | undefined,
  right: ZendeskActionPolicy | undefined
): ZendeskActionPolicy {
  if (left && right) return mostRestrictive(left, right)
  return left ?? right ?? 'allow'
}

function toActionPolicyFromBoolean(value: boolean | undefined): ZendeskActionPolicy {
  if (value === false) return 'deny'
  return 'allow'
}

function toActionPolicyFromStored(
  stored: ConnectorToolPermissionMap,
  toolName: string
): ZendeskActionPolicy | undefined {
  return stored[toolName] as ZendeskActionPolicy | undefined
}

function normalizeLegacyActionPermissions(input: {
  permissions: ZendeskConnectorPermissions
  storedToolPermissions: ConnectorToolPermissionMap
}): ZendeskActionPermissions {
  const actions = {} as ZendeskActionPermissions

  for (const action of ZENDESK_ACTION_KEYS) {
    const coverage = LEGACY_ACTION_COVERAGE[action]
    let policy: ZendeskActionPolicy | undefined

    for (const booleanKey of coverage.booleans) {
      policy = combinePolicy(policy, toActionPolicyFromBoolean(input.permissions[booleanKey]))
    }

    if (coverage.legacyTool) {
      policy = combinePolicy(policy, toActionPolicyFromStored(input.storedToolPermissions, coverage.legacyTool))
    } else {
      policy = combinePolicy(policy, toActionPolicyFromStored(input.storedToolPermissions, action))
    }

    actions[action] = policy ?? 'allow'
  }

  return actions
}

export function normalizeZendeskActionPermissions(config: Record<string, unknown>): ZendeskActionPermissions {
  const canonical = config[ZENDESK_ACTION_PERMISSIONS_CONFIG_KEY]
  if (canonical !== undefined) {
    const parsed = parseZendeskActionPermissionsConfig(canonical)
    if (parsed.ok) {
      return parsed.value.actions
    }
  }

  const permissions = isRecord(config.permissions) ? config.permissions : {}
  const legacyPermissions: ZendeskConnectorPermissions = {
    allowRead: typeof permissions.allowRead === 'boolean' ? permissions.allowRead : true,
    allowCreateTickets: typeof permissions.allowCreateTickets === 'boolean' ? permissions.allowCreateTickets : true,
    allowUpdateTickets: typeof permissions.allowUpdateTickets === 'boolean' ? permissions.allowUpdateTickets : true,
    allowPublicComments: typeof permissions.allowPublicComments === 'boolean' ? permissions.allowPublicComments : true,
    allowInternalComments: typeof permissions.allowInternalComments === 'boolean' ? permissions.allowInternalComments : true,
  }

  return normalizeLegacyActionPermissions({
    permissions: legacyPermissions,
    storedToolPermissions: getStoredConnectorToolPermissions(config) ?? {},
  })
}

// Resolves the effective canonical map from an already-parsed connector
// config: the stored canonical map wins, otherwise the legacy permission
// fields (booleans plus stored read/create/update tool policies) migrate in
// memory so legacy restrictions stay effective without a settings save.
export function resolveZendeskActionPermissions(config: {
  permissions: ZendeskConnectorPermissions
  zendeskActionPermissions?: ZendeskActionPermissions
  storedToolPermissions?: ConnectorToolPermissionMap
}): ZendeskActionPermissions {
  if (config.zendeskActionPermissions) {
    return config.zendeskActionPermissions
  }

  return normalizeLegacyActionPermissions({
    permissions: config.permissions,
    storedToolPermissions: config.storedToolPermissions ?? {},
  })
}

// Runtime projection for the MCP config builder: the canonical action names
// are the atomic MCP tool names, so the normalized map keys directly into the
// exact OpenCode permission expansion. Denied actions stay in the map (defense
// in depth if tool discovery is stale); retired composite names never appear.
export function getZendeskRuntimeToolPermissions(
  config: Record<string, unknown>
): ConnectorToolPermissionMap {
  return { ...normalizeZendeskActionPermissions(config) }
}

export type ZendeskLegacyProjection = {
  permissions: ZendeskConnectorPermissions
  legacyToolPermissions: ConnectorToolPermissionMap
}

export function buildLegacyProjectionFromActionPermissions(
  actions: ZendeskActionPermissions
): ZendeskLegacyProjection {
  const booleans: ZendeskConnectorPermissions = {
    allowRead: true,
    allowCreateTickets: true,
    allowUpdateTickets: true,
    allowPublicComments: true,
    allowInternalComments: true,
  }

  for (const action of ZENDESK_ACTION_KEYS) {
    const policy = actions[action]
    for (const booleanKey of LEGACY_ACTION_COVERAGE[action].booleans) {
      if (policy === 'deny') {
        booleans[booleanKey] = false
      }
    }
  }

  const legacyToolPermissions: ConnectorToolPermissionMap = {}
  for (const [legacyToolName, action] of Object.entries(LEGACY_TOOL_NAME_TO_ACTION)) {
    if (action) {
      legacyToolPermissions[legacyToolName] = actions[action]
      continue
    }

    const coveredActions = ZENDESK_ACTION_KEYS.filter(
      (candidate) => LEGACY_ACTION_COVERAGE[candidate].legacyTool === legacyToolName
    )
    let policy: ZendeskActionPolicy = 'allow'
    for (const coveredAction of coveredActions) {
      policy = mostRestrictive(policy, actions[coveredAction])
    }
    legacyToolPermissions[legacyToolName] = policy
  }

  return { permissions: booleans, legacyToolPermissions }
}

export function mergeLegacyToolPermissions(
  current: ConnectorToolPermissionMap | null,
  projection: ConnectorToolPermissionMap
): ConnectorToolPermissionMap {
  return { ...(current ?? {}), ...projection }
}

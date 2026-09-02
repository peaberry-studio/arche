export type FlowRunStatus = 'running' | 'waiting_for_human' | 'succeeded' | 'failed' | 'cancelled'

export type FlowRunTrigger = 'on_create' | 'schedule' | 'manual' | 'resume'

export type FlowRunStepStatus = 'pending' | 'running' | 'waiting_for_human' | 'succeeded' | 'skipped' | 'failed'

export type FlowNodeType = 'agent' | 'human' | 'condition' | 'slack' | 'merge' | 'compaction'

export type FlowVisibility = 'private' | 'team'

export type FlowUserSummary = {
  slug: string
}

export type FlowPermissions = {
  canCopy: boolean
  canEdit: boolean
  canManage: boolean
  canRun: boolean
  canView: boolean
  isOwner: boolean
}

export type FlowConnectorRequirementSummary = {
  agentId: string
  agentName: string
  capabilityId: string
  connectorName: string | null
  connectorType: string
}

export type FlowSlackTarget =
  | { type: 'dm'; userId: string }
  | { type: 'channel'; channelId: string }

export type FlowSlackMessageMode = 'fixed' | 'previous_output' | 'template'

export type FlowConditionMode = 'rules' | 'ai'

export type FlowConditionOperator =
  | 'contains'
  | 'equals'
  | 'not_equals'
  | 'starts_with'
  | 'ends_with'
  | 'exists'
  | 'not_exists'
  | 'matches'

export type FlowConditionRule = {
  id: string
  variable: string
  operator: FlowConditionOperator
  value?: string
  targetNodeId: string
}

export type AgentFlowNode = {
  id: string
  type: 'agent'
  name: string
  targetAgentId: string | null
  promptTemplate: string
  compactOutput: boolean
  requiredConnectors?: string[]
}

export type HumanFlowNode = {
  id: string
  type: 'human'
  name: string
  instructions: string
  required: boolean
}

export type ConditionFlowNode = {
  id: string
  type: 'condition'
  name: string
  mode: FlowConditionMode
  rules?: FlowConditionRule[]
  evaluatorPrompt?: string
}

export type SlackFlowNode = {
  id: string
  type: 'slack'
  name: string
  target: FlowSlackTarget
  messageMode: FlowSlackMessageMode
  messageTemplate: string
}

export type MergeFlowNode = {
  id: string
  type: 'merge'
  name: string
}

export type ForkFlowNode = {
  id: string
  type: 'fork'
  name: string
  joinNodeId: string
}

export type CompactionFlowNode = {
  id: string
  type: 'compaction'
  name: string
  promptTemplate: string
}

export type FlowNode =
  | AgentFlowNode
  | HumanFlowNode
  | ConditionFlowNode
  | SlackFlowNode
  | MergeFlowNode
  | CompactionFlowNode
  | ForkFlowNode

export type FlowEdge = {
  id: string
  sourceNodeId: string
  targetNodeId: string
  label?: string
}

export type FlowLayoutNode = {
  nodeId: string
  x: number
  y: number
}

export type FlowLayout = {
  nodes: FlowLayoutNode[]
}

export type FlowDefinition = {
  version: 1
  startNodeId: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  layout?: FlowLayout
}

export type FlowRunStepListItem = {
  id: string
  nodeId: string
  nodeName: string | null
  nodeType: FlowNodeType
  status: FlowRunStepStatus
  input: unknown
  rawOutput: string | null
  compactedOutput: string | null
  humanResponse: string | null
  error: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

export type FlowRunListItem = {
  id: string
  flowId: string
  executionUserId: string | null
  executionUser: FlowUserSummary | null
  status: FlowRunStatus
  trigger: FlowRunTrigger
  scheduledFor: string
  startedAt: string
  finishedAt: string | null
  error: string | null
  openCodeSessionId: string | null
  sessionTitle: string | null
  currentNodeId: string | null
  attempt: number
  retryScheduledFor: string | null
  lastRetryError: string | null
  steps: FlowRunStepListItem[]
}

export type FlowListItem = {
  id: string
  owner: FlowUserSummary | null
  name: string
  description: string | null
  definition: FlowDefinition
  cronExpression: string | null
  timezone: string
  enabled: boolean
  visibility: FlowVisibility
  organizationCanRun: boolean
  permissions: FlowPermissions
  nextRunAt: string | null
  lastRunAt: string | null
  createdAt: string
  updatedAt: string
  latestRun: FlowRunListItem | null
}

export type FlowDetail = FlowListItem & {
  connectorRequirements?: FlowConnectorRequirementSummary[]
  missingConnectorRequirements?: FlowConnectorRequirementSummary[]
  runs: FlowRunListItem[]
}

export type FlowPayload = {
  name: string
  description: string | null
  definition: FlowDefinition
  cronExpression: string | null
  timezone: string
  enabled: boolean
  visibility?: FlowVisibility
  organizationCanRun?: boolean
}

export type FlowSessionMetadata = {
  runId: string
  flowId: string
  flowName: string
  status: FlowRunStatus
  trigger: FlowRunTrigger
  hasUnseenResult: boolean
}

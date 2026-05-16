import type { FlowNodeType } from '@/lib/flows/types'

export const FLOW_CANVAS_NODE_TYPE_OPTIONS: Array<{ label: string; type: FlowNodeType }> = [
  { label: 'Agent', type: 'agent' },
  { label: 'Human', type: 'human' },
  { label: 'Condition', type: 'condition' },
  { label: 'Slack', type: 'slack' },
  { label: 'Merge', type: 'merge' },
  { label: 'Compaction', type: 'compaction' },
]

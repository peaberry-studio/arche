const ISSUE_116_RULE_PREFIX =
  'The user has specified a rule which prevents you from using this specific tool call.'
const SILENT_NESTED_TASK_DELEGATION_TITLE = 'Delegation returned to the main assistant'

type ToolFailureContext = {
  toolName: string
  input?: Record<string, unknown>
  error?: string
}

export function isNestedTaskDelegationPermissionError(message: string): boolean {
  if (!message.includes(ISSUE_116_RULE_PREFIX)) {
    return false
  }

  return (
    message.includes('"permission":"task"') &&
    message.includes('"action":"allow"') &&
    message.includes('"action":"deny"')
  )
}

export function shouldSilenceNestedTaskDelegationToolFailure({
  toolName,
  input,
  error,
}: ToolFailureContext): boolean {
  return (
    toolName === 'task' &&
    Boolean(input && typeof input.subagent_type === 'string') &&
    typeof error === 'string' &&
    isNestedTaskDelegationPermissionError(error)
  )
}

export function createSilentNestedTaskDelegationState(input: Record<string, unknown>) {
  return {
    status: 'completed' as const,
    input,
    output: '',
    title: SILENT_NESTED_TASK_DELEGATION_TITLE,
  }
}

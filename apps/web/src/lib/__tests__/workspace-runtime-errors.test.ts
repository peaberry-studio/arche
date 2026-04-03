import { describe, expect, it } from 'vitest'

import {
  createSilentNestedTaskDelegationState,
  isNestedTaskDelegationPermissionError,
  shouldSilenceNestedTaskDelegationToolFailure,
} from '@/lib/workspace-runtime-errors'

const ISSUE_116_ERROR =
  'The user has specified a rule which prevents you from using this specific tool call. ' +
  'Here are some of the relevant rules ' +
  '[{"permission":"*","pattern":"*","action":"allow"},{"permission":"task","pattern":"*","action":"allow"},{"permission":"task","pattern":"*","action":"deny"}]'

describe('workspace runtime error helpers', () => {
  it('matches the raw task permission rules payload from issue 116', () => {
    expect(isNestedTaskDelegationPermissionError(ISSUE_116_ERROR)).toBe(true)
  })

  it('does not match arbitrary task failures without the issue signature', () => {
    expect(isNestedTaskDelegationPermissionError("tool 'task' denied")).toBe(false)
  })

  it('does not match unrelated permission failures', () => {
    expect(isNestedTaskDelegationPermissionError("tool 'bash' denied")).toBe(false)
  })

  it('requires task tool context and subagent_type before silencing a tool failure', () => {
    expect(
      shouldSilenceNestedTaskDelegationToolFailure({
        toolName: 'task',
        input: {},
        error: ISSUE_116_ERROR,
      }),
    ).toBe(false)

    expect(
      shouldSilenceNestedTaskDelegationToolFailure({
        toolName: 'bash',
        input: { subagent_type: 'seo' },
        error: ISSUE_116_ERROR,
      }),
    ).toBe(false)
  })

  it('marks only nested task delegation permission failures as silent', () => {
    expect(
      shouldSilenceNestedTaskDelegationToolFailure({
        toolName: 'task',
        input: { subagent_type: 'seo' },
        error: ISSUE_116_ERROR,
      }),
    ).toBe(true)
  })

  it('creates a silent completed state for nested task delegation failures', () => {
    expect(
      createSilentNestedTaskDelegationState({
        subagent_type: 'seo',
      }),
    ).toEqual({
      status: 'completed',
      input: { subagent_type: 'seo' },
      output: '',
      title: 'Delegation returned to the main assistant',
    })
  })
})

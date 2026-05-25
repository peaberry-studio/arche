import { describe, expect, it } from 'vitest'

import {
  createFlowActorScope,
  flowVisibleToWorkspaceWhere,
  runExecutesInWorkspaceWhere,
  runVisibleToWorkspaceWhere,
} from '@/lib/flows/authorization'

describe('flow authorization scopes', () => {
  it('builds workspace flow visibility predicates from one explicit scope', () => {
    const scope = createFlowActorScope({ id: 'actor-1', role: 'USER' }, 'workspace-1')

    expect(flowVisibleToWorkspaceWhere(scope)).toEqual({
      deletedAt: null,
      OR: [
        { userId: 'workspace-1' },
        { visibility: 'team' },
      ],
    })
  })

  it('separates visible run scope from execution workspace scope', () => {
    const scope = createFlowActorScope({ id: 'actor-1', role: 'ADMIN' }, 'workspace-1')

    expect(runVisibleToWorkspaceWhere(scope)).toEqual({
      OR: [
        { flow: { userId: 'workspace-1' } },
        { executionUserId: 'workspace-1' },
      ],
    })
    expect(runExecutesInWorkspaceWhere(scope)).toEqual({
      OR: [
        { executionUserId: 'workspace-1' },
        { executionUserId: null, flow: { userId: 'workspace-1' } },
      ],
    })
  })
})

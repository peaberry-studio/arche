import { describe, expect, it } from 'vitest'

import { renderRuntimeConfig } from '@/lib/harness/adapters/opencode-v1/runtime-config'
import { createRuntimeConfigModel } from '@/lib/harness/runtime-config'
import {
  applyAgentExecutionGuards,
  applyDefaultAgentModel,
  denyAgentKnowledgeWrites,
  injectAgentKnowledgePolicy,
  injectAgentToolCallerIdentity,
  injectSelfDelegationGuards,
} from '@/lib/spawner/agent-config-transforms'
import { serializeRuntimeConfig } from '@/lib/spawner/runtime-config'
import { withWorkspacePermissionGuards } from '@/lib/spawner/runtime-config-utils'

describe('V1 runtime config renderer', () => {
  it.each([null, 123, 'invalid'])('preserves legacy non-object agent entries byte-for-byte: %s', (entry) => {
    const source = { agent: { worker: entry } }
    const rendered = renderRuntimeConfig(createRuntimeConfigModel(source))
    if (!rendered.ok) throw new Error(rendered.error.message)
    expect(rendered.data.opencodeConfigContent).toBe(serializeRuntimeConfig(withWorkspacePermissionGuards(source)))
  })

  it.each(['primary', 'all', 'subagent'])('preserves the original serialized bytes for %s agents', (mode) => {
    const source = {
      $schema: 'https://opencode.ai/config.json',
      default_agent: 'assistant',
      default_model: ' openai/default ',
      permission: { edit: 'allow', bash: { '*': 'ask', 'git status *': 'allow' } },
      tools: { 'arche_tools_*': false },
      agent: {
        assistant: { mode, prompt: 'Help the user.', tools: { task: true, read: true, write: true } },
        worker: { mode, steps: 200, prompt: 'Do the work.', model: 'anthropic/worker', tools: { task: true } },
      },
      mcp: { arche_tools: { type: 'local', enabled: true, command: ['node', '/opt/arche/arche-tools/server.js'] } },
      provider: { example: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://gateway.example/v1' } } },
      snapshot: false,
    }
    let original = applyDefaultAgentModel(source)
    original = applyAgentExecutionGuards(original)
    original = injectSelfDelegationGuards(original)
    original = injectAgentToolCallerIdentity(original)
    original = injectAgentKnowledgePolicy(original)
    original = denyAgentKnowledgeWrites(original)
    original = withWorkspacePermissionGuards(original)

    const rendered = renderRuntimeConfig(createRuntimeConfigModel(source, { agentsMd: '# Instructions' }))

    expect(rendered.ok).toBe(true)
    if (!rendered.ok) throw new Error(rendered.error.message)
    expect(rendered.data.opencodeConfigContent).toBe(serializeRuntimeConfig(original))
    expect(rendered.data.agentsMd).toBe('# Instructions')
    expect(rendered.data.skillDirectory).toBe('.opencode/skill')
    expect(source.agent.worker.tools.task).toBe(true)
  })
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { client } from './mcp-client.js'

test('MCP lists the complete inventory with JSON schemas and no harness plugin', async () => {
  const result = await client.listTools()
  assert.deepEqual(result.tools.map((tool) => tool.name).sort(), [
    'chart_create', 'diagram_create', 'document_inspect', 'email_draft', 'flow_propose',
    'learning_propose', 'presentation_inspect', 'session_history_query',
    'spreadsheet_inspect', 'spreadsheet_query', 'spreadsheet_sample', 'spreadsheet_stats',
  ])
  for (const tool of result.tools) assert.equal(tool.inputSchema.type, 'object')
  const learning = result.tools.find((tool) => tool.name === 'learning_propose')
  assert.equal(learning.inputSchema.properties.caller_agent.type, 'string')
})

test('MCP preserves the JSON output and structured attachment payload', async () => {
  const result = await client.callTool({
    name: 'chart_create',
    arguments: { type: 'bar', title: 'Sales', xField: 'month', yField: 'sales', data: [{ month: 'Jan', sales: 1 }] },
  })
  assert.equal(result.isError, undefined)
  assert.deepEqual(result.structuredContent, JSON.parse(result.content[0].text))
  assert.equal(result.structuredContent.format, 'arche-chart/v1')
})

test('unknown MCP tools cannot resolve object prototype properties', async () => {
  for (const name of ['missing_tool', 'toString', '__proto__']) {
    const result = await client.callTool({ name, arguments: {} })
    assert.equal(result.structuredContent.error, 'unknown_tool')
  }
})

test('identity tools fail without caller context and do not call the API', async () => {
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => { requests += 1; throw new Error('unexpected_request') }
  try {
    for (const name of ['learning_propose', 'session_history_query']) {
      for (const args of [{}, { caller_agent: 'curator' }, { caller_session_id: 'session-1' }]) {
        const result = await client.callTool({ name, arguments: args })
        assert.equal(result.isError, true)
        assert.equal(result.structuredContent.error, 'caller_identity_unavailable')
      }
    }
    assert.equal(requests, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('identity accepts explicit fallback or session metadata, preserving workspace API auth', async () => {
  const originalFetch = globalThis.fetch
  const env = { ...process.env }
  process.env.ARCHE_INTERNAL_API_BASE_URL = 'http://internal.test'
  process.env.ARCHE_WORKSPACE_SLUG = 'workspace-test'
  process.env.OPENCODE_SERVER_PASSWORD = 'test-only'
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    return Response.json({ proposal: { id: 'proposal-1' }, sessions: [] })
  }
  try {
    for (const metadata of [false, true]) {
      const caller = { caller_agent: 'curator', ...(metadata ? {} : { caller_session_id: 'session-1' }) }
      const meta = metadata ? { 'ai.opencode/sessionID': 'session-1' } : undefined
      const learning = await client.callTool({
        name: 'learning_propose',
        arguments: { ...caller, title: 'Useful fact', operation: 'create', kbPath: 'facts.md', proposedContent: 'A durable fact.' },
        ...(meta ? { _meta: meta } : {}),
      })
      assert.equal(learning.structuredContent.ok, true)
      const history = await client.callTool({ name: 'session_history_query', arguments: caller, ...(meta ? { _meta: meta } : {}) })
      assert.equal(history.structuredContent.ok, true)
    }
    assert.equal(calls.length, 4)
    for (const call of calls) {
      assert.equal(call.init.headers['x-arche-workspace-slug'], 'workspace-test')
      assert.match(call.init.headers.Authorization, /^Basic /)
      assert.equal(call.body.caller_agent, undefined)
      assert.equal(call.body.caller_session_id, undefined)
    }
    assert.equal(calls[0].body.agent, 'curator')
    const conflict = await client.callTool({ name: 'learning_propose', arguments: { caller_agent: 'curator', caller_session_id: 'other' }, _meta: { 'ai.opencode/sessionID': 'session-1' } })
    assert.equal(conflict.structuredContent.error, 'caller_identity_unavailable')
    assert.equal(calls.length, 4)
  } finally {
    globalThis.fetch = originalFetch
    for (const key of ['ARCHE_INTERNAL_API_BASE_URL', 'ARCHE_WORKSPACE_SLUG', 'OPENCODE_SERVER_PASSWORD']) {
      if (env[key] === undefined) delete process.env[key]
      else process.env[key] = env[key]
    }
  }
})

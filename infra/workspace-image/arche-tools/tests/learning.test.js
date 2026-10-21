import test from 'node:test'
import assert from 'node:assert/strict'

import { mcpTool } from './mcp-client.js'

const propose = mcpTool('learning_propose')

test('learning_propose description is the quality gate for KB proposals', () => {
  const description = propose.description

  assert.match(description, /inspect the existing KB files/i)
  assert.match(description, /update an existing file|new one/i)
  assert.match(description, /duplicates/i)
  assert.match(description, /skip transient/i)
  assert.match(description, /nothing durable/i)
  assert.match(description, /never writes/i)
})

test('learning_propose returns a pending proposal to merge and forwards supersedesId', async (t) => {
  const previous = {
    baseUrl: process.env.ARCHE_INTERNAL_API_BASE_URL,
    slug: process.env.ARCHE_WORKSPACE_SLUG,
    serverAuth: process.env.OPENCODE_SERVER_PASSWORD,
  }
  process.env.ARCHE_INTERNAL_API_BASE_URL = 'http://web.test'
  process.env.ARCHE_WORKSPACE_SLUG = 'alice'
  process.env.OPENCODE_SERVER_PASSWORD = 'fixture'
  const pending = { id: 'change-1', title: 'Old fact', operation: 'update', proposedContent: '# Notes\nold fact\n', reason: 'r', status: 'open' }
  const bodies = []
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body)
    bodies.push(body)
    return body.supersedesId === 'change-1'
      ? Response.json({ proposal: { id: 'change-2' } })
      : Response.json({ error: 'pending_proposal_exists', pending }, { status: 409 })
  })
  t.after(() => {
    for (const [key, name] of [['baseUrl', 'ARCHE_INTERNAL_API_BASE_URL'], ['slug', 'ARCHE_WORKSPACE_SLUG'], ['serverAuth', 'OPENCODE_SERVER_PASSWORD']]) {
      if (previous[key] === undefined) delete process.env[name]
      else process.env[name] = previous[key]
    }
  })
  const input = { title: 'New fact', kbPath: 'notes.md', operation: 'update', proposedContent: '# Notes\nnew fact\n' }
  const context = { agent: 'knowledge-curator', sessionID: 'session-1' }

  const conflict = JSON.parse(await propose.execute(input, context))
  assert.equal(conflict.ok, false)
  assert.equal(conflict.error, 'pending_proposal_exists')
  assert.deepEqual(conflict.pending, pending)
  assert.match(conflict.next, /supersedesId/)

  const merged = JSON.parse(await propose.execute({ ...input, proposedContent: '# Notes\nold fact\nnew fact\n', supersedesId: 'change-1' }, context))
  assert.deepEqual(merged, { ok: true, proposal: { id: 'change-2' } })
  assert.equal(bodies[1].supersedesId, 'change-1')
})

test('learning_propose tells the agent how to handle a pending proposal', () => {
  assert.match(propose.description, /pending_proposal_exists/)
  assert.match(propose.description, /supersedesId/)
})

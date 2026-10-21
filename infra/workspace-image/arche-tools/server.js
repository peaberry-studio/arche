import { pathToFileURL } from 'node:url'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import * as chart from './tools/chart.js'
import * as diagram from './tools/diagram.js'
import * as document from './tools/document.js'
import * as email from './tools/email.js'
import * as flow from './tools/flow.js'
import * as learning from './tools/learning.js'
import * as presentation from './tools/presentation.js'
import * as scratch from './tools/scratch.js'
import * as sessionHistory from './tools/session_history.js'
import * as spreadsheet from './tools/spreadsheet.js'

const modules = { chart, diagram, document, email, flow, learning, presentation, scratch, session_history: sessionHistory, spreadsheet }
const identityTools = new Set(['learning_propose', 'session_history_query'])
// Tools scoped to the calling session; they need its id but not the agent.
const sessionTools = new Set(['scratch_dir', 'scratch_publish'])

export const tools = Object.fromEntries(Object.entries(modules).flatMap(([moduleName, definitions]) =>
  Object.entries(definitions).map(([name, definition]) => [`${moduleName}_${name}`, definition]),
))

function nonemptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function toolResult(output) {
  const value = JSON.parse(output)
  return {
    content: [{ type: 'text', text: output }],
    structuredContent: value,
    ...(value.ok === false ? { isError: true } : {}),
  }
}

export function createArcheToolsServer() {
  const server = new Server({ name: 'arche-tools', version: '1.0.0' }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.entries(tools).map(([name, definition]) => ({
      name,
      description: definition.description,
      inputSchema: z.toJSONSchema(z.object({
        ...definition.args,
        ...(identityTools.has(name) ? {
          caller_agent: z.string().min(1).optional().describe('Your current agent id, supplied by runtime instructions. Never guess.'),
        } : {}),
        ...(identityTools.has(name) || sessionTools.has(name) ? {
          caller_session_id: z.string().min(1).optional().describe('Your current session id, only when known. Never guess. Not needed when the harness supplies session metadata.'),
        } : {}),
      })),
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    if (!Object.hasOwn(tools, params.name)) return toolResult(JSON.stringify({ ok: false, error: 'unknown_tool' }))
    const definition = tools[params.name]

    let args = params.arguments ?? {}
    let context
    if (identityTools.has(params.name)) {
      const { caller_agent: agent, caller_session_id: sessionID, ...toolArgs } = args
      const metadataSession = nonemptyString(params._meta?.['ai.opencode/sessionID'])
      const explicitSession = nonemptyString(sessionID)
      if (metadataSession && explicitSession && metadataSession !== explicitSession) {
        return toolResult(JSON.stringify({ ok: false, error: 'caller_identity_unavailable' }))
      }
      context = { agent: nonemptyString(agent), sessionID: metadataSession ?? explicitSession }
      if (!context.agent || !context.sessionID) {
        return toolResult(JSON.stringify({ ok: false, error: 'caller_identity_unavailable' }))
      }
      args = toolArgs
    } else if (sessionTools.has(params.name)) {
      const { caller_session_id: sessionID, ...toolArgs } = args
      const metadataSession = nonemptyString(params._meta?.['ai.opencode/sessionID'])
      const explicitSession = nonemptyString(sessionID)
      if (metadataSession && explicitSession && metadataSession !== explicitSession) {
        return toolResult(JSON.stringify({ ok: false, error: 'caller_identity_unavailable' }))
      }
      context = { sessionID: metadataSession ?? explicitSession }
      if (!context.sessionID) return toolResult(JSON.stringify({ ok: false, error: 'caller_identity_unavailable' }))
      args = toolArgs
    }

    return toolResult(await definition.execute(args, context))
  })

  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await createArcheToolsServer().connect(new StdioServerTransport())
}

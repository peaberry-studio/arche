import { after } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { createArcheToolsServer, tools } from '../server.js'

const server = createArcheToolsServer()
export const client = new Client({ name: 'arche-tools-test', version: '1.0.0' })
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
after(async () => {
  await client.close()
  await server.close()
})

export function mcpTool(name) {
  const sessionMetadata = name === 'scratch_dir' || name === 'scratch_publish'
  return {
    description: tools[name].description,
    async execute(args, context) {
      const result = await client.callTool({
        name,
        arguments: {
          ...args,
          ...(context?.agent ? { caller_agent: context.agent } : {}),
          ...(context?.sessionID && !sessionMetadata ? { caller_session_id: context.sessionID } : {}),
        },
        ...(context?.sessionID && sessionMetadata ? { _meta: { 'ai.opencode/sessionID': context.sessionID } } : {}),
      })
      return result.content[0].text
    },
  }
}

import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { quiesce, startReconnectServe, waitFor, within } from './probe-harness.mjs'

// Captures the scripted reconnect conversation against the installed
// `opencode` 2.x binary, with snapshots taken at quiescent cut points
// (mid-text, queued prompt, mid-tool permission, mid-subagent, end). Prints
// the sanitized capture to stdout.
const serve = await startReconnectServe()
const { client, stub, workspace, root, version } = serve
const subscriber = new AbortController()
const events = []
const cuts = []
let subscription

async function collect(fetchPage) {
  const items = []
  let cursor
  for (;;) {
    const page = await fetchPage(cursor).catch((error) => { throw new Error(`page after cursor ${cursor} (${items.length} items): ${error._tag ?? error.message}`) })
    items.push(...page.data)
    if (!page.cursor.next) return items
    cursor = page.cursor.next
  }
}

try {
  subscription = (async () => { for await (const event of client.event.subscribe({ signal: subscriber.signal })) events.push(event) })().catch(() => undefined)
  await waitFor(() => events.some((event) => event.type === 'server.connected'), 'SSE')
  const location = await client.location.get()

  const snapshot = async (label) => {
    const eventIndex = await quiesce(events)
    const sessions = await collect((cursor) => client.session.list({ directory: location.directory, limit: 100, cursor }))
    const messages = {}
    const inbox = {}
    for (const session of sessions) {
      messages[session.id] = await collect((cursor) => client.message.list({ sessionID: session.id, limit: 100, ...(cursor ? { cursor } : { order: 'asc' }) }))
      inbox[session.id] = await client.session.inbox.list({ sessionID: session.id })
    }
    const result = { label, eventIndex, sessions, messages, inbox, permissions: (await client.permission.request.list()).data, active: await client.session.active() }
    if (events.length !== eventIndex) throw new Error(`Snapshot ${label} raced live events`)
    cuts.push(result)
  }

  const session = await client.session.create({ title: 'reconnect', agent: 'probe', model: { providerID: 'fixture', id: 'fixture' }, location: { directory: workspace } })
  await client.session.prompt({ sessionID: session.id, text: 'MIXED_PROBE' })
  await within(stub.reached.text.promise, 'text barrier')
  await snapshot('mid-text')
  await client.session.prompt({ sessionID: session.id, text: 'QUEUED_PROBE' })
  await snapshot('queued')
  stub.release('text')
  await waitFor(async () => (await client.permission.request.list()).data.length > 0, 'permission ask')
  await snapshot('mid-tool')
  const [ask] = (await client.permission.request.list()).data
  await client.permission.reply({ sessionID: ask.sessionID, requestID: ask.id, decision: 'once' })
  await within(stub.reached.child.promise, 'child barrier')
  await snapshot('mid-child')
  stub.release('child')
  await waitFor(async () => Object.keys(await client.session.active()).length === 0 && stub.requests.some((request) => request.kind === 'final'), 'idle', 60_000)
  await snapshot('end')
  await delay(100)
  const serialized = JSON.stringify({ runtime: 'opencode-v2', version, requests: stub.requests, schemas: stub.schemas, events, cuts }, null, 2)
    .replaceAll(workspace, '/workspace').replaceAll(root, '/isolated')
    .replaceAll(resolve(process.cwd(), '../..'), '/repository')
    .replaceAll(dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim()), '/repository')
    .replaceAll(homedir(), '/home')
  console.log(serialized)
} catch (error) {
  console.error(error, JSON.stringify({ requests: stub.requests, types: events.map((event) => event.type), failures: events.filter((event) => /failed/.test(event.type)).map((event) => event.data) }))
  process.exitCode = 1
} finally {
  subscriber.abort()
  stub.releaseAll()
  await subscription
  await serve.stop()
}

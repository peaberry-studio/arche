import { readFileSync } from 'node:fs'

import type { OpenCodeEvent } from '@opencode/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { translateOpenCodeEvent as translateV2 } from '@/lib/harness/adapters/opencode-v2/events'
import { createOpenCodeV2Runtime } from '@/lib/harness/adapters/opencode-v2/runtime'
import type { HarnessMessage } from '@/lib/harness/contract'
import type { ArcheEvent, ArchePermission } from '@/lib/harness/events'
import { createEmptyChatStore, hydratePermissionsIntoStore, hydrateSessionIntoStore, reduceArcheEvent, type ChatStore } from '@/lib/workspace-events/reducer'

const auth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/harness/runtime-connection', () => ({ getInstanceBasicAuth: auth }))

type Cut<Native> = Native & { label: string; eventIndex: number }
type V2Capture = {
  version: string
  events: OpenCodeEvent[]
  cuts: Array<Cut<{ sessions: Array<{ id: string }>; messages: Record<string, unknown[]>; inbox: Record<string, unknown[]>; permissions: unknown[]; active: Record<string, unknown> }>>
}
type Snapshot = { label: string; eventIndex: number; messages: Record<string, HarnessMessage[]>; permissions: Record<string, ArchePermission[]>; busy: Set<string> }
type Replay = { events: ArcheEvent[][]; snapshots: Snapshot[]; view: (store: ChatStore) => unknown }
type Scenario = { disconnectAt: number; subscribeAt: number; appliedUntil: number }

function load<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./captures/${name}`, import.meta.url), 'utf8'))
}

function group(permissions: ArchePermission[]): Record<string, ArchePermission[]> {
  const grouped: Record<string, ArchePermission[]> = {}
  for (const permission of permissions) grouped[permission.sessionId] = [...grouped[permission.sessionId] ?? [], permission]
  return grouped
}

function view(store: ChatStore, withoutStepParts = false) {
  return {
    messages: withoutStepParts ? Object.fromEntries(Object.entries(store.messages).map(([id, messages]) => [id, messages.map((message) => ({
      ...message, parts: message.parts.filter((part) => part.type !== 'step-start' && part.type !== 'step-finish'),
    }))])) : store.messages,
    permissions: store.permissions,
    busy: Object.entries(store.sessionStatus).flatMap(([id, status]) => status === 'busy' ? [id] : []).sort(),
    pendingParts: store.pendingParts,
    pendingUpdates: store.pendingUpdates ?? {},
  }
}

function reduce(store: ChatStore, events: ArcheEvent[][]): ChatStore {
  for (const translated of events) for (const event of translated) store = reduceArcheEvent(store, event).store
  return store
}

function hydrate(store: ChatStore, snapshot: Snapshot, statusBefore: ChatStore['sessionStatus'] = {}, baseline: ChatStore['permissions'] = {}): ChatStore {
  for (const [sessionId, messages] of Object.entries(snapshot.messages)) {
    store = hydrateSessionIntoStore(store, sessionId, messages)
    if (store.sessionStatus[sessionId] === statusBefore[sessionId]) {
      store = { ...store, sessionStatus: { ...store.sessionStatus, [sessionId]: snapshot.busy.has(sessionId) ? 'busy' : 'idle' } }
    }
  }
  return hydratePermissionsIntoStore(store, snapshot.permissions, baseline)
}

function connect(replay: Replay, snapshot: Snapshot, { disconnectAt, subscribeAt, appliedUntil }: Scenario): ChatStore {
  let store = reduce(createEmptyChatStore(), replay.events.slice(0, disconnectAt))
  const statusBefore = store.sessionStatus
  const baseline = store.permissions
  store = reduce(store, replay.events.slice(subscribeAt, appliedUntil))
  return reduce(hydrate(store, snapshot, statusBefore, baseline), replay.events.slice(appliedUntil))
}

function differences(actual: unknown, expected: unknown, path = ''): string[] {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return []
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)])
    return [...keys].flatMap((key) => differences(Reflect.get(actual, key), Reflect.get(expected, key), `${path}.${key}`))
  }
  return [path]
}

function category(path: string): string {
  if (path.startsWith('.permissions')) return 'permission'
  if (path.startsWith('.busy')) return 'status'
  if (path.startsWith('.pending')) return 'pending'
  if (path.includes('.state')) return 'tool-state'
  if (path.includes('timestamp')) return 'timestamp'
  return 'content'
}

function scenarios(replay: Replay, index: number): { live: Array<[string, Scenario]>; stale: Array<[string, Scenario]> } {
  const k = replay.snapshots[index].eventIndex
  const previous = index ? replay.snapshots[index - 1].eventIndex : 0
  const next = replay.snapshots[index + 1]?.eventIndex ?? replay.events.length
  const live: Array<[string, Scenario]> = [['fresh', { disconnectAt: 0, subscribeAt: k, appliedUntil: k }]]
  for (let at = previous; at < k; at++) live.push([`subscribed@${at}`, { disconnectAt: 0, subscribeAt: at, appliedUntil: k }])
  for (let at = 1; at <= k; at++) live.push([`disconnected@${at}`, { disconnectAt: at, subscribeAt: k, appliedUntil: k }])
  const stale: Array<[string, Scenario]> = []
  for (let at = k + 1; at <= next; at++) {
    for (const disconnectAt of new Set([0, previous, k])) stale.push([`stale@${disconnectAt}-${at}`, { disconnectAt, subscribeAt: k, appliedUntil: at }])
  }
  return { live, stale }
}

function failures(replay: Replay, index: number, kind: 'live' | 'stale'): Record<string, string[]> {
  const expected = replay.view(reduce(createEmptyChatStore(), replay.events))
  return Object.fromEntries(scenarios(replay, index)[kind].flatMap(([label, scenario]) => {
    const paths = differences(replay.view(connect(replay, replay.snapshots[index], scenario)), expected)
    return paths.length ? [[label, paths]] : []
  }))
}

function categories(replay: Replay, kind: 'live' | 'stale' | 'at-cut'): Record<string, string[]> {
  return Object.fromEntries(replay.snapshots.map((snapshot, index) => {
    const paths = kind === 'at-cut'
      ? differences(replay.view(hydrate(createEmptyChatStore(), snapshot)), replay.view(reduce(createEmptyChatStore(), replay.events.slice(0, snapshot.eventIndex))))
      : Object.values(failures(replay, index, kind)).flat()
    return [snapshot.label, [...new Set(paths.map(category))].sort()]
  }))
}

function serve(cut: V2Capture['cuts'][number]) {
  return vi.fn(async (input: string | URL) => {
    const url = new URL(input)
    if (url.pathname === '/api/permission/request') return Response.json({ location: { directory: '/workspace' }, data: cut.permissions })
    const match = url.pathname.match(/^\/api\/session\/([^/]+)(\/message|\/inbox)?$/)
    if (!match) throw new Error(`Unexpected request: ${url.pathname}`)
    const [, id, suffix] = match
    if (!suffix) return Response.json({ data: cut.sessions.find((session) => session.id === id) })
    if (suffix === '/inbox') return Response.json({ data: cut.inbox[id] })
    if (url.searchParams.has('cursor')) {
      return url.searchParams.has('order')
        ? Response.json({ _tag: 'InvalidCursorError', message: 'Invalid cursor' }, { status: 400 })
        : Response.json({ data: [], cursor: { next: null, previous: null } })
    }
    return Response.json({ data: cut.messages[id], cursor: { next: 'after-last', previous: null } })
  })
}

async function v2Replay(capture: V2Capture): Promise<Replay> {
  const events = capture.events.map((event) => {
    const translated = translateV2(event)
    if (!translated.ok) throw new Error(translated.error.detail)
    return translated.data
  })
  const snapshots: Snapshot[] = []
  for (const cut of capture.cuts) {
    vi.stubGlobal('fetch', serve(cut))
    const runtime = createOpenCodeV2Runtime('alice')
    const messages: Record<string, HarnessMessage[]> = {}
    for (const session of cut.sessions) {
      const listed = await runtime.listMessages(session.id)
      if (!listed.ok) throw new Error(listed.error.detail ?? listed.error.code)
      messages[session.id] = listed.data
    }
    const permissions = await runtime.listPermissions()
    if (!permissions.ok) throw new Error(permissions.error.code)
    snapshots.push({ label: cut.label, eventIndex: cut.eventIndex, messages, permissions: group(permissions.data), busy: new Set(Object.keys(cut.active)) })
  }
  return { events, snapshots, view: (store) => view(store) }
}

describe('reconnect convergence against a captured OpenCode 2.0.32 run', () => {
  const v2Capture = load<V2Capture>('reconnect-v2.json')
  let v2: Replay

  beforeAll(async () => {
    auth.mockResolvedValue({ baseUrl: 'http://runtime', authHeader: 'Basic fixture-only' })
    v2 = await v2Replay(v2Capture)
    vi.unstubAllGlobals()
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('replays the capture of the pinned runtime at every cut point', () => {
    expect(v2Capture.version).toBe('2.0.32')
    const labels = ['mid-text', 'queued', 'mid-tool', 'mid-child', 'end']
    expect(v2.snapshots.map((snapshot) => snapshot.label)).toEqual(labels)
    expect(v2Capture.cuts[1].inbox[v2Capture.cuts[1].sessions[0].id]).toHaveLength(1)
    expect(Object.keys(v2Capture.cuts[3].messages)).toHaveLength(2)
  })

  it('the final snapshot equals the continuously reduced live stream, accounting parts included', () => {
    const continuous = reduce(createEmptyChatStore(), v2.events)
    expect(v2.view(hydrate(createEmptyChatStore(), v2.snapshots[4]))).toEqual(v2.view(continuous))
    expect(Object.values(continuous.messages).flat().filter((message) => message.parts.some((part) => part.type === 'step-finish'))).toHaveLength(5)
  })

  it.each(['mid-text', 'queued', 'mid-tool', 'mid-child', 'end'])('a client reconnecting at %s converges to the continuous client', (label) => {
    const index = v2.snapshots.findIndex((snapshot) => snapshot.label === label)
    expect(failures(v2, index, 'live')).toEqual({})
  })

  it('at the cut point differs from the continuous client only in in-flight content, pending permissions and unpersisted subagent progress', () => {
    expect(categories(v2, 'at-cut')).toEqual({ 'mid-text': ['content'], queued: ['content'], 'mid-tool': ['permission'], 'mid-child': ['content', 'tool-state'], end: [] })
  })

  it('limits stale-snapshot races to permission and tool state', () => {
    expect(categories(v2, 'stale')).toEqual({ 'mid-text': [], queued: [], 'mid-tool': ['permission', 'tool-state'], 'mid-child': ['tool-state'], end: [] })
  })

  it('a reconnect that missed the enqueue still shows the queued input and its delivery time', () => {
    const queued = v2.snapshots[1]
    const sessionId = v2Capture.cuts[1].sessions[0].id
    const pending = queued.messages[sessionId].at(-1)
    expect(pending).toMatchObject({ role: 'user', content: 'QUEUED_PROBE' })
    const delivered = reduce(createEmptyChatStore(), v2.events).messages[sessionId].find((message) => message.id === pending?.id)
    expect(delivered?.timestampRaw).toBeGreaterThan(pending?.timestampRaw ?? Infinity)
    expect(connect(v2, queued, { disconnectAt: 0, subscribeAt: queued.eventIndex, appliedUntil: queued.eventIndex }).messages[sessionId]).toContainEqual(delivered)
  })
})

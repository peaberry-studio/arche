import { fork, type ChildProcess } from 'node:child_process'
import * as path from 'node:path'

import type { EmbedRequest, EmbedResponse } from '@/lib/mcp/kb-search-model'

// The model holds ~440 MB that a process does not return to the OS once loaded, so it runs
// in a child process (src/kb-search-embedder.ts) that is stopped after this long without requests.
const EMBEDDER_IDLE_MS = 10 * 60 * 1000
const EMBEDDER_ENTRY = path.join(process.cwd(), 'src', 'kb-search-embedder.ts')

type PendingRequest = { resolve: (vectors: Float32Array[]) => void; reject: (error: Error) => void }
type Embedder = { process: ChildProcess; pending: Map<number, PendingRequest> }

let current: Embedder | null = null
let idleTimer: NodeJS.Timeout | null = null
let nextRequestId = 0

export async function embedPassages(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return []
  return embed(texts)
}

export async function embedQuery(text: string): Promise<Float32Array> {
  const [vector] = await embed([text])
  return vector
}

function embed(texts: string[]): Promise<Float32Array[]> {
  const embedder = current ?? startEmbedder()
  clearIdleTimer()
  const id = nextRequestId++
  return new Promise((resolve, reject) => {
    embedder.pending.set(id, { resolve, reject })
    embedder.process.send({ id, texts } satisfies EmbedRequest, (error) => {
      if (error) settle(embedder, { id, ok: false, error: error.message })
    })
  })
}

function startEmbedder(): Embedder {
  // Runs from source through tsx at runtime; the Next build must not try to bundle it.
  const child = fork(/* turbopackIgnore: true */ EMBEDDER_ENTRY, [], { execArgv: ['--import', 'tsx'], serialization: 'advanced' })
  const embedder: Embedder = { process: child, pending: new Map() }
  current = embedder

  child.on('message', (message: EmbedResponse) => settle(embedder, message))
  child.on('error', (error) => stopEmbedder(embedder, error))
  child.once('exit', (code, signal) => stopEmbedder(embedder, new Error(`Embedder process exited (${code ?? signal})`)))
  return embedder
}

function settle(embedder: Embedder, response: EmbedResponse): void {
  const request = embedder.pending.get(response.id)
  if (!request) return
  embedder.pending.delete(response.id)
  if (response.ok) request.resolve(response.vectors)
  else request.reject(new Error(response.error))
  if (embedder === current && embedder.pending.size === 0) scheduleIdleStop(embedder)
}

function stopEmbedder(embedder: Embedder, error: Error): void {
  if (embedder === current) {
    current = null
    clearIdleTimer()
  }
  for (const request of embedder.pending.values()) request.reject(error)
  embedder.pending.clear()
  if (embedder.process.exitCode === null) embedder.process.kill()
}

function scheduleIdleStop(embedder: Embedder): void {
  idleTimer = setTimeout(() => stopEmbedder(embedder, new Error('Embedder process stopped while idle')), EMBEDDER_IDLE_MS)
  idleTimer.unref()
}

function clearIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
}

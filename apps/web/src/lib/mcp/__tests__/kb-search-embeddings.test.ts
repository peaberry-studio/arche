import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EmbedRequest } from '@/lib/mcp/kb-search-model'

const IDLE_MS = 10 * 60 * 1000

class FakeEmbedderProcess extends EventEmitter {
  exitCode: number | null = null
  readonly requests: EmbedRequest[] = []
  sendError: Error | null = null
  readonly kill = vi.fn(() => true)

  send(request: EmbedRequest, callback?: (error: Error | null) => void) {
    this.requests.push(request)
    callback?.(this.sendError)
    return true
  }

  reply(request: EmbedRequest) {
    this.emit('message', { id: request.id, ok: true, vectors: request.texts.map((_, index) => Float32Array.from([index, 1])) })
  }

  replyAll() {
    for (const request of this.requests.splice(0)) this.reply(request)
  }

  exit(code: number | null, signal: string | null = null) {
    this.exitCode = code ?? 1
    this.emit('exit', code, signal)
  }
}

const childProcess = vi.hoisted(() => ({ fork: vi.fn() }))
vi.mock('node:child_process', () => ({ fork: childProcess.fork }))

let children: FakeEmbedderProcess[] = []

async function loadModule() {
  return import('@/lib/mcp/kb-search-embeddings')
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('kb search embeddings', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    children = []
    childProcess.fork.mockImplementation(() => {
      const child = new FakeEmbedderProcess()
      children.push(child)
      return child
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts the embedder process lazily with tsx and structured-clone messages', async () => {
    const { embedPassages } = await loadModule()
    expect(childProcess.fork).not.toHaveBeenCalled()

    const result = embedPassages(['first', 'second'])
    await flush()
    children[0].replyAll()

    await expect(result).resolves.toEqual([Float32Array.from([0, 1]), Float32Array.from([1, 1])])
    expect(childProcess.fork).toHaveBeenCalledWith(expect.stringMatching(/src\/kb-search-embedder\.ts$/), [], {
      execArgv: ['--import', 'tsx'],
      serialization: 'advanced',
    })
  })

  it('does not start the embedder for an empty batch', async () => {
    const { embedPassages } = await loadModule()

    await expect(embedPassages([])).resolves.toEqual([])
    expect(childProcess.fork).not.toHaveBeenCalled()
  })

  it('embeds a query as a single text', async () => {
    const { embedQuery } = await loadModule()

    const result = embedQuery('where is the site hosted')
    await flush()
    expect(children[0].requests.map((request) => request.texts)).toEqual([['where is the site hosted']])
    children[0].replyAll()

    await expect(result).resolves.toEqual(Float32Array.from([0, 1]))
  })

  it('shares one process across concurrent requests and matches replies by id', async () => {
    const { embedPassages, embedQuery } = await loadModule()

    const passages = embedPassages(['a', 'b'])
    const query = embedQuery('c')
    await flush()
    const [passageRequest, queryRequest] = children[0].requests
    children[0].reply(queryRequest)
    children[0].reply(passageRequest)

    await expect(query).resolves.toEqual(Float32Array.from([0, 1]))
    await expect(passages).resolves.toHaveLength(2)
    expect(childProcess.fork).toHaveBeenCalledTimes(1)
  })

  it('rejects when the embedder answers with an error', async () => {
    const { embedQuery } = await loadModule()

    const result = embedQuery('a')
    await flush()
    children[0].emit('message', { id: children[0].requests[0].id, ok: false, error: 'offline' })

    await expect(result).rejects.toThrow('offline')
  })

  it('rejects pending requests when the embedder exits and starts a new one on the next call', async () => {
    const { embedQuery } = await loadModule()

    const result = embedQuery('a')
    await flush()
    children[0].exit(137)
    await expect(result).rejects.toThrow('Embedder process exited')

    const retry = embedQuery('b')
    await flush()
    children[1].replyAll()
    await expect(retry).resolves.toEqual(Float32Array.from([0, 1]))
    expect(childProcess.fork).toHaveBeenCalledTimes(2)
  })

  it('rejects a request that cannot be sent to the embedder', async () => {
    childProcess.fork.mockImplementationOnce(() => {
      const child = new FakeEmbedderProcess()
      child.sendError = new Error('channel closed')
      children.push(child)
      return child
    })
    const { embedQuery } = await loadModule()

    await expect(embedQuery('a')).rejects.toThrow('channel closed')
  })

  it('rejects pending requests when the embedder cannot be started', async () => {
    const { embedQuery } = await loadModule()

    const result = embedQuery('a')
    await flush()
    children[0].emit('error', new Error('spawn tsx ENOENT'))

    await expect(result).rejects.toThrow('spawn tsx ENOENT')
  })

  it('stops the embedder after the idle timeout and starts a new one when needed', async () => {
    vi.useFakeTimers()
    const { embedQuery } = await loadModule()

    const first = embedQuery('a')
    await vi.advanceTimersByTimeAsync(0)
    children[0].replyAll()
    await first

    await vi.advanceTimersByTimeAsync(IDLE_MS - 1)
    expect(children[0].kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(children[0].kill).toHaveBeenCalledTimes(1)

    const second = embedQuery('b')
    await vi.advanceTimersByTimeAsync(0)
    children[1].replyAll()
    await expect(second).resolves.toEqual(Float32Array.from([0, 1]))
  })

  it('keeps serving from a new embedder when the idle one exits late', async () => {
    vi.useFakeTimers()
    const { embedQuery } = await loadModule()

    const first = embedQuery('a')
    await vi.advanceTimersByTimeAsync(0)
    children[0].replyAll()
    await first
    await vi.advanceTimersByTimeAsync(IDLE_MS)

    const second = embedQuery('b')
    await vi.advanceTimersByTimeAsync(0)
    children[0].exit(null, 'SIGTERM')
    children[1].replyAll()

    await expect(second).resolves.toEqual(Float32Array.from([0, 1]))
    const third = embedQuery('c')
    await vi.advanceTimersByTimeAsync(0)
    children[1].replyAll()
    await expect(third).resolves.toEqual(Float32Array.from([0, 1]))
    expect(childProcess.fork).toHaveBeenCalledTimes(2)
  })

  it('does not stop the embedder while a request is pending', async () => {
    vi.useFakeTimers()
    const { embedQuery } = await loadModule()

    const first = embedQuery('a')
    await vi.advanceTimersByTimeAsync(0)
    children[0].replyAll()
    await first

    await vi.advanceTimersByTimeAsync(IDLE_MS - 1)
    const slow = embedQuery('b')
    await vi.advanceTimersByTimeAsync(IDLE_MS)
    expect(children[0].kill).not.toHaveBeenCalled()

    children[0].replyAll()
    await expect(slow).resolves.toEqual(Float32Array.from([0, 1]))
  })
})

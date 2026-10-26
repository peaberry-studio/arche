import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createEmbedRequestHandler, ensureModelFiles, loadEmbeddingModel, serveEmbedRequests } from './kb-search-embedder'

const transformers = vi.hoisted(() => ({
  env: { allowRemoteModels: true, localModelPath: '/models/', useFSCache: true },
  extractor: vi.fn(),
  pipeline: vi.fn(),
}))

vi.mock('@huggingface/transformers', () => ({
  env: transformers.env,
  pipeline: transformers.pipeline,
}))

const MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'

function sha256(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

function modelFile(filePath: string, content: string) {
  return { path: filePath, sha256: sha256(content), content }
}

function fetchServing(files: Array<{ path: string; content: string }>) {
  return vi.fn(async (url: string) => {
    const file = files.find((candidate) => url.endsWith(`/${candidate.path}`))
    return file ? new Response(file.content) : new Response('missing', { status: 404 })
  })
}

function fakeModel() {
  return vi.fn(async (texts: string[]) => texts.map((_, index) => Float32Array.from([index, 1])))
}

describe('kb search embedder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('embeds texts in bounded batches and answers with the request id', async () => {
    const embed = fakeModel()
    const handle = createEmbedRequestHandler(async () => embed)

    const response = await handle({ id: 7, texts: Array.from({ length: 40 }, (_, index) => `text ${index}`) })

    expect(response.id).toBe(7)
    expect(response.ok && response.vectors).toHaveLength(40)
    expect(embed.mock.calls.map(([texts]) => texts.length)).toEqual([16, 16, 8])
  })

  it('loads the model once across requests', async () => {
    const loadModel = vi.fn(async () => fakeModel())
    const handle = createEmbedRequestHandler(loadModel)

    await Promise.all([handle({ id: 1, texts: ['a'] }), handle({ id: 2, texts: ['b'] })])
    await handle({ id: 3, texts: ['c'] })

    expect(loadModel).toHaveBeenCalledTimes(1)
  })

  it('answers with an error when the model fails to load and retries the load next time', async () => {
    const loadModel = vi.fn<() => Promise<ReturnType<typeof fakeModel>>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(fakeModel())
    const handle = createEmbedRequestHandler(loadModel)

    await expect(handle({ id: 1, texts: ['a'] })).resolves.toEqual({ id: 1, ok: false, error: 'offline' })
    await expect(handle({ id: 2, texts: ['a'] })).resolves.toEqual({ id: 2, ok: true, vectors: [Float32Array.from([0, 1])] })
    expect(loadModel).toHaveBeenCalledTimes(2)
  })

  it('answers with an error when inference fails and keeps the loaded model', async () => {
    const embed = fakeModel().mockRejectedValueOnce(new Error('inference failed'))
    const loadModel = vi.fn(async () => embed)
    const handle = createEmbedRequestHandler(loadModel)

    await expect(handle({ id: 1, texts: ['a'] })).resolves.toEqual({ id: 1, ok: false, error: 'inference failed' })
    await expect(handle({ id: 2, texts: ['a'] })).resolves.toMatchObject({ id: 2, ok: true })
    expect(loadModel).toHaveBeenCalledTimes(1)
  })

  it('handles one request at a time', async () => {
    const events: string[] = []
    const handle = createEmbedRequestHandler(async () => async (texts: string[]) => {
      events.push(`start ${texts[0]}`)
      await new Promise((resolve) => setTimeout(resolve, 5))
      events.push(`end ${texts[0]}`)
      return texts.map(() => Float32Array.from([1]))
    })

    await Promise.all([handle({ id: 1, texts: ['a'] }), handle({ id: 2, texts: ['b'] })])

    expect(events).toEqual(['start a', 'end a', 'start b', 'end b'])
  })

  it('logs the full error of a failed request', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new Error('onnx session failed')
    const handle = createEmbedRequestHandler(async () => {
      throw failure
    })

    await handle({ id: 1, texts: ['a'] })

    expect(errorSpy).toHaveBeenCalledWith('[kb-search-embedder] Request failed', failure)
    errorSpy.mockRestore()
  })

  it('exits when the web process closes the channel', () => {
    const handlers = new Map<string, () => void>()
    const onSpy = vi.spyOn(process, 'on').mockImplementation(((event: string, handler: () => void) => {
      handlers.set(event, handler)
      return process
    }) as typeof process.on)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as typeof process.exit)

    serveEmbedRequests()
    handlers.get('disconnect')?.()

    expect(exitSpy).toHaveBeenCalledWith(0)
    onSpy.mockRestore()
    exitSpy.mockRestore()
  })
})

describe('kb search embedding model files', () => {
  let modelDirectory: string

  beforeEach(async () => {
    vi.clearAllMocks()
    modelDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-search-model-'))
  })

  afterEach(async () => {
    await fs.rm(modelDirectory, { recursive: true, force: true })
  })

  it('downloads missing files from the pinned revision', async () => {
    const files = [modelFile('config.json', '{}'), modelFile('onnx/model_quantized.onnx', 'weights')]
    const fetchFile = fetchServing(files)

    await ensureModelFiles(modelDirectory, files, fetchFile)

    expect(fetchFile.mock.calls.map(([url]) => url)).toEqual([
      `https://huggingface.co/${MODEL}/resolve/2c4055b12046f11709e9df2c122e59ffbdc2f900/config.json`,
      `https://huggingface.co/${MODEL}/resolve/2c4055b12046f11709e9df2c122e59ffbdc2f900/onnx/model_quantized.onnx`,
    ])
    await expect(fs.readFile(path.join(modelDirectory, MODEL, 'onnx/model_quantized.onnx'), 'utf-8')).resolves.toBe('weights')
  })

  it('does not download files that are already present', async () => {
    const files = [modelFile('config.json', '{}')]
    await fs.mkdir(path.join(modelDirectory, MODEL), { recursive: true })
    await fs.writeFile(path.join(modelDirectory, MODEL, 'config.json'), '{}')
    const fetchFile = fetchServing(files)

    await ensureModelFiles(modelDirectory, files, fetchFile)

    expect(fetchFile).not.toHaveBeenCalled()
  })

  it('rejects a download whose hash does not match and keeps no file', async () => {
    const expected = modelFile('config.json', '{}')
    const fetchFile = fetchServing([{ path: 'config.json', content: '{"tampered":true}' }])

    await expect(ensureModelFiles(modelDirectory, [expected], fetchFile)).rejects.toThrow('config.json')
    await expect(fs.readdir(path.join(modelDirectory, MODEL))).resolves.toEqual([])
  })

  it('rejects a failed download', async () => {
    const fetchFile = fetchServing([])

    await expect(ensureModelFiles(modelDirectory, [modelFile('config.json', '{}')], fetchFile)).rejects.toThrow('404')
  })

  it('loads the quantized model from local files only and embeds with mean pooling and normalization', async () => {
    const files = [modelFile('config.json', '{}')]
    transformers.pipeline.mockResolvedValue(transformers.extractor)
    transformers.extractor.mockResolvedValue({ tolist: () => [[0.6, 0.8]] })

    const embed = await loadEmbeddingModel(modelDirectory, files, fetchServing(files))
    const vectors = await embed(['where is the site hosted'])

    expect(transformers.env).toEqual({ allowRemoteModels: false, localModelPath: modelDirectory, useFSCache: false })
    expect(transformers.pipeline).toHaveBeenCalledWith('feature-extraction', MODEL, { dtype: 'q8' })
    expect(transformers.extractor).toHaveBeenCalledWith(['where is the site hosted'], { pooling: 'mean', normalize: true })
    expect(vectors).toEqual([Float32Array.from([0.6, 0.8])])
  })
})

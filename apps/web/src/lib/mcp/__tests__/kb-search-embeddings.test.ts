import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  extractor: vi.fn(),
  pipeline: vi.fn(),
}))

vi.mock('@huggingface/transformers', () => ({
  pipeline: mocks.pipeline,
}))

function tensorOf(rows: number[][]) {
  return { tolist: () => rows }
}

describe('kb search embeddings', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.pipeline.mockResolvedValue(mocks.extractor)
    mocks.extractor.mockImplementation(async (texts: string[]) => tensorOf(texts.map((_, index) => [index, 1])))
  })

  it('embeds passages with mean pooling and normalization', async () => {
    const { embedPassages } = await import('@/lib/mcp/kb-search-embeddings')
    const vectors = await embedPassages(['first', 'second'])

    expect(mocks.pipeline).toHaveBeenCalledWith('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', { dtype: 'q8' })
    expect(mocks.extractor).toHaveBeenCalledWith(['first', 'second'], { pooling: 'mean', normalize: true })
    expect(vectors).toEqual([Float32Array.from([0, 1]), Float32Array.from([1, 1])])
  })

  it('embeds a query as a single text', async () => {
    const { embedQuery } = await import('@/lib/mcp/kb-search-embeddings')
    await embedQuery('where is the site hosted')

    expect(mocks.extractor).toHaveBeenCalledWith(['where is the site hosted'], { pooling: 'mean', normalize: true })
  })

  it('embeds passages in bounded batches', async () => {
    const { embedPassages } = await import('@/lib/mcp/kb-search-embeddings')
    const vectors = await embedPassages(Array.from({ length: 40 }, (_, index) => `text ${index}`))

    expect(vectors).toHaveLength(40)
    expect(mocks.extractor.mock.calls.map(([texts]) => texts.length)).toEqual([16, 16, 8])
  })

  it('loads the model once across calls', async () => {
    const { embedPassages, embedQuery } = await import('@/lib/mcp/kb-search-embeddings')
    await Promise.all([embedPassages(['a']), embedQuery('b')])
    await embedQuery('c')

    expect(mocks.pipeline).toHaveBeenCalledTimes(1)
  })

  it('propagates a load failure and retries the load on the next call', async () => {
    mocks.pipeline.mockRejectedValueOnce(new Error('offline'))

    const { embedQuery } = await import('@/lib/mcp/kb-search-embeddings')
    await expect(embedQuery('a')).rejects.toThrow('offline')
    await expect(embedQuery('a')).resolves.toEqual(Float32Array.from([0, 1]))
    expect(mocks.pipeline).toHaveBeenCalledTimes(2)
  })
})

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readVectorCache, writeVectorCache } from '@/lib/mcp/kb-search-vector-cache'

const MODEL = 'ixjosemi/paraphrase-multilingual-MiniLM-L12-v2-es-en@da6cf6363bf76060ecadc865da58cabfb4c2d212'

function vectorOf(seed: number): Float32Array {
  return Float32Array.from({ length: 384 }, (_, index) => (seed + index) / 1000)
}

let cacheDir: string

describe('kb search vector cache', () => {
  beforeEach(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-search-cache-'))
    vi.stubEnv('ARCHE_KB_SEARCH_CACHE_DIR', cacheDir)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    await fs.rm(cacheDir, { recursive: true, force: true })
  })

  it('round-trips vectors by key', async () => {
    const vectors = new Map([['a', vectorOf(1)], ['b', vectorOf(2)]])

    await writeVectorCache(vectors)

    await expect(readVectorCache()).resolves.toEqual(vectors)
  })

  it('creates the cache directory when it does not exist', async () => {
    vi.stubEnv('ARCHE_KB_SEARCH_CACHE_DIR', path.join(cacheDir, 'nested', 'dir'))

    await writeVectorCache(new Map([['a', vectorOf(1)]]))

    await expect(readVectorCache()).resolves.toEqual(new Map([['a', vectorOf(1)]]))
  })

  it('returns no vectors when nothing was cached yet', async () => {
    await expect(readVectorCache()).resolves.toEqual(new Map())
    expect(console.error).not.toHaveBeenCalled()
  })

  it('ignores vectors cached for another model', async () => {
    await fs.writeFile(path.join(cacheDir, 'vectors.json'), JSON.stringify({ model: 'other@1', vectors: { a: 'AAAA' } }))

    await expect(readVectorCache()).resolves.toEqual(new Map())
  })

  it('ignores and logs an unreadable cache file', async () => {
    await fs.writeFile(path.join(cacheDir, 'vectors.json'), '{not json')

    await expect(readVectorCache()).resolves.toEqual(new Map())
    expect(console.error).toHaveBeenCalledWith('[kb-search] Ignoring unreadable vector cache', expect.anything())
  })

  it('drops cached vectors with the wrong dimensions', async () => {
    const short = Buffer.from(Float32Array.from([1, 2, 3]).buffer).toString('base64')
    const valid = Buffer.from(vectorOf(1).buffer).toString('base64')
    await fs.writeFile(path.join(cacheDir, 'vectors.json'), JSON.stringify({ model: MODEL, vectors: { short, valid } }))

    await expect(readVectorCache()).resolves.toEqual(new Map([['valid', vectorOf(1)]]))
  })

  it('removes its temporary file when replacing the cache fails', async () => {
    await fs.mkdir(path.join(cacheDir, 'vectors.json', 'blocker'), { recursive: true })

    await expect(writeVectorCache(new Map([['a', vectorOf(1)]]))).rejects.toThrow()
    await expect(fs.readdir(cacheDir)).resolves.toEqual(['vectors.json'])
  })

  it('replaces the cache file atomically without leaving temporary files', async () => {
    await writeVectorCache(new Map([['a', vectorOf(1)]]))
    await writeVectorCache(new Map([['b', vectorOf(2)]]))

    await expect(fs.readdir(cacheDir)).resolves.toEqual(['vectors.json'])
    await expect(readVectorCache()).resolves.toEqual(new Map([['b', vectorOf(2)]]))
  })
})

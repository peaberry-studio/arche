import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, EMBEDDING_MODEL_REVISION } from '@/lib/mcp/kb-search-model'

// Section vectors survive restarts so a new process embeds only sections it has not seen.
// The cache is derived data: an unreadable or foreign file is a cache miss.

const MODEL_KEY = `${EMBEDDING_MODEL}@${EMBEDDING_MODEL_REVISION}`
const CACHE_FILE_NAME = 'vectors.json'

type VectorCacheFile = { model: string; vectors: Record<string, string> }

export async function readVectorCache(): Promise<Map<string, Float32Array>> {
  let file: VectorCacheFile
  try {
    file = JSON.parse(await readFile(cacheFilePath(), 'utf-8'))
  } catch (error) {
    if (!isMissingFile(error)) console.error('[kb-search] Ignoring unreadable vector cache', error)
    return new Map()
  }
  if (file?.model !== MODEL_KEY || typeof file.vectors !== 'object' || file.vectors === null) return new Map()

  const vectors = new Map<string, Float32Array>()
  for (const [key, encoded] of Object.entries(file.vectors)) {
    const vector = decodeVector(encoded)
    if (vector) vectors.set(key, vector)
  }
  return vectors
}

export async function writeVectorCache(vectors: Map<string, Float32Array>): Promise<void> {
  const target = cacheFilePath()
  const file: VectorCacheFile = {
    model: MODEL_KEY,
    vectors: Object.fromEntries([...vectors].map(([key, vector]) => [key, encodeVector(vector)])),
  }
  // Blue-green deploys run two web processes on one cache, so replace the file atomically.
  const temporary = `${target}.${randomUUID()}.tmp`
  await mkdir(path.dirname(target), { recursive: true })
  try {
    await writeFile(temporary, JSON.stringify(file))
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

function cacheFilePath(): string {
  const directory = process.env.ARCHE_KB_SEARCH_CACHE_DIR?.trim() || path.join(os.tmpdir(), 'arche-kb-search')
  return path.join(directory, CACHE_FILE_NAME)
}

function encodeVector(vector: Float32Array): string {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64')
}

function decodeVector(encoded: unknown): Float32Array | null {
  if (typeof encoded !== 'string') return null
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.byteLength !== EMBEDDING_DIMENSIONS * Float32Array.BYTES_PER_ELEMENT) return null
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

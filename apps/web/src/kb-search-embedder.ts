import { createHash } from 'node:crypto'
import { access, mkdir, rename, writeFile } from 'node:fs/promises'
import * as path from 'node:path'

import type { FeatureExtractionPipeline } from '@huggingface/transformers'

import {
  EMBEDDING_MODEL,
  EMBEDDING_MODEL_REVISION,
  type EmbedRequest,
  type EmbedResponse,
} from '@/lib/mcp/kb-search-model'

// Runs as a child of the web process (see kb-search-embeddings.ts): once loaded, the model's
// memory is never returned to the OS, so it lives in a process that can exit when idle.

type ModelFile = { path: string; sha256: string }
type FetchFile = (url: string) => Promise<Response>

const EMBEDDING_BATCH_SIZE = 16
const MODEL_DIRECTORY = path.join(process.cwd(), 'node_modules', '.cache', 'arche-kb-search-model')
// Every file the q8 feature-extraction pipeline reads, from the pinned revision. The library's own
// loader probes the unpinned `main` branch for tokenizer_config.json on every load, so the model is
// kept in its own directory and loaded with remote access disabled.
const MODEL_FILES: ModelFile[] = [
  { path: 'config.json', sha256: '05b570bff786faa5c4604152aa16f19f77ed6dfc31e47dd0f3dd987078693ac7' },
  { path: 'tokenizer.json', sha256: 'b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441' },
  { path: 'tokenizer_config.json', sha256: '3f5961b9ac86288cccdb97f32fb848d6187c78e1603958c53f3ea1f296b7d8a2' },
  { path: 'onnx/model_quantized.onnx', sha256: '66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc' },
]

type EmbedTexts = (texts: string[]) => Promise<Float32Array[]>

export function createEmbedRequestHandler(loadModel: () => Promise<EmbedTexts>): (request: EmbedRequest) => Promise<EmbedResponse> {
  let model: Promise<EmbedTexts> | null = null
  let queue: Promise<unknown> = Promise.resolve()

  const getModel = () => {
    model ??= loadModel().catch((error: unknown) => {
      model = null
      throw error
    })
    return model
  }

  const embedRequest = async ({ id, texts }: EmbedRequest): Promise<EmbedResponse> => {
    try {
      const embed = await getModel()
      const vectors: Float32Array[] = []
      for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
        vectors.push(...await embed(texts.slice(start, start + EMBEDDING_BATCH_SIZE)))
      }
      return { id, ok: true, vectors }
    } catch (error) {
      console.error('[kb-search-embedder] Request failed', error)
      return { id, ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // Inference already uses every core, so requests run one at a time.
  return (request) => {
    const response = queue.then(() => embedRequest(request))
    queue = response
    return response
  }
}

// Downloads the pinned model files that are missing and verifies each one before keeping it.
export async function ensureModelFiles(
  modelDirectory: string,
  files: ModelFile[] = MODEL_FILES,
  fetchFile: FetchFile = fetch,
): Promise<void> {
  for (const file of files) {
    const target = path.join(modelDirectory, EMBEDDING_MODEL, file.path)
    if (await exists(target)) continue

    await mkdir(path.dirname(target), { recursive: true })
    const response = await fetchFile(`https://huggingface.co/${EMBEDDING_MODEL}/resolve/${EMBEDDING_MODEL_REVISION}/${file.path}`)
    if (!response.ok) throw new Error(`Downloading ${file.path} failed with HTTP ${response.status}`)
    const content = Buffer.from(await response.arrayBuffer())
    const digest = createHash('sha256').update(content).digest('hex')
    if (digest !== file.sha256) throw new Error(`Downloaded ${file.path} has SHA-256 ${digest}, expected ${file.sha256}`)

    const temporary = `${target}.${process.pid}.tmp`
    await writeFile(temporary, content)
    await rename(temporary, target)
  }
}

export async function loadEmbeddingModel(
  modelDirectory: string = MODEL_DIRECTORY,
  files: ModelFile[] = MODEL_FILES,
  fetchFile: FetchFile = fetch,
): Promise<EmbedTexts> {
  await ensureModelFiles(modelDirectory, files, fetchFile)
  const { env, pipeline } = await import('@huggingface/transformers')
  env.localModelPath = modelDirectory
  env.allowRemoteModels = false
  env.useFSCache = false
  const extractor: FeatureExtractionPipeline = await pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: 'q8' })
  return async (texts) => {
    const output = await extractor(texts, { pooling: 'mean', normalize: true })
    return (output.tolist() as number[][]).map((row) => Float32Array.from(row))
  }
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true, () => false)
}

export function serveEmbedRequests(): void {
  const handle = createEmbedRequestHandler(() => loadEmbeddingModel())
  process.on('message', (request: EmbedRequest) => {
    void handle(request).then((response) => process.send?.(response))
  })
  process.on('disconnect', () => process.exit(0))
}

// Image builds run this once so the pinned model ships with the image and runtime needs no network.
async function prefetchEmbeddingModel(): Promise<void> {
  const embed = await loadEmbeddingModel()
  await embed(['prefetch'])
}

if (!process.env.VITEST) {
  if (process.argv.includes('--prefetch')) {
    void prefetchEmbeddingModel().catch((error: unknown) => {
      console.error('[kb-search-embedder] Prefetching the embedding model failed', error)
      process.exit(1)
    })
  } else {
    serveEmbedRequests()
  }
}

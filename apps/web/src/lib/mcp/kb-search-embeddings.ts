import type { FeatureExtractionPipeline } from '@huggingface/transformers'

const EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
// Pinned so a fresh download keeps the weights the 0.4 similarity threshold was calibrated on.
const EMBEDDING_MODEL_REVISION = '2c4055b12046f11709e9df2c122e59ffbdc2f900'
const EMBEDDING_BATCH_SIZE = 16

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null

export async function embedPassages(texts: string[]): Promise<Float32Array[]> {
  const vectors: Float32Array[] = []
  for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
    vectors.push(...await embed(texts.slice(start, start + EMBEDDING_BATCH_SIZE)))
  }
  return vectors
}

export async function embedQuery(text: string): Promise<Float32Array> {
  const [vector] = await embed([text])
  return vector
}

async function embed(texts: string[]): Promise<Float32Array[]> {
  const extractor = await loadExtractor()
  const output = await extractor(texts, { pooling: 'mean', normalize: true })
  return (output.tolist() as number[][]).map((row) => Float32Array.from(row))
}

// Imported lazily: the library loads onnxruntime-node's native binding on import, so a
// platform without a binding must fail the search, not every module that imports this one.
function loadExtractor(): Promise<FeatureExtractionPipeline> {
  extractorPromise ??= import('@huggingface/transformers')
    .then(({ pipeline }) => pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: 'q8', revision: EMBEDDING_MODEL_REVISION }))
    .catch((error: unknown) => {
      extractorPromise = null
      throw error
    })
  return extractorPromise
}

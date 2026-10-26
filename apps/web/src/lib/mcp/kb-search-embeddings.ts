import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'

const EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
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

function loadExtractor(): Promise<FeatureExtractionPipeline> {
  extractorPromise ??= pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: 'q8' }).catch((error: unknown) => {
    extractorPromise = null
    throw error
  })
  return extractorPromise
}

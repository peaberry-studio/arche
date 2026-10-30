// paraphrase-multilingual-MiniLM-L12-v2 with its vocabulary trimmed to Spanish and English, which
// halves the memory of the embedder process. Built by scripts/trim-kb-search-model.py.
export const EMBEDDING_MODEL = 'ixjosemi/paraphrase-multilingual-MiniLM-L12-v2-es-en'
// Pinned so a fresh download keeps the weights the 0.4 similarity threshold was checked against.
export const EMBEDDING_MODEL_REVISION = 'da6cf6363bf76060ecadc865da58cabfb4c2d212'
export const EMBEDDING_DIMENSIONS = 384

export type EmbedRequest = { id: number; texts: string[] }

export type EmbedResponse =
  | { id: number; ok: true; vectors: Float32Array[] }
  | { id: number; ok: false; error: string }

export const EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
// Pinned so a fresh download keeps the weights the 0.4 similarity threshold was calibrated on.
export const EMBEDDING_MODEL_REVISION = '2c4055b12046f11709e9df2c122e59ffbdc2f900'
export const EMBEDDING_DIMENSIONS = 384

export type EmbedRequest = { id: number; texts: string[] }

export type EmbedResponse =
  | { id: number; ok: true; vectors: Float32Array[] }
  | { id: number; ok: false; error: string }

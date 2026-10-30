import { tokenize } from '@/lib/mcp/kb-search-sections'

// Deterministic stand-in for the embedding model: each concept is one
// dimension, so texts sharing a concept are similar even without shared words.
const CONCEPTS = [
  ['hosting', 'aloja', 'alojamiento', 'vercel'],
  ['deploy', 'despliegue', 'ansible', 'vps'],
  ['analytics', 'analitica', 'ga4', 'consent'],
  ['kubernetes', 'cluster'],
  ['shared', 'keyword'],
]

export function fakeEmbedding(text: string): Float32Array {
  const tokens = new Set(tokenize(text))
  const vector = CONCEPTS.map((words) => (words.some((word) => tokens.has(word)) ? 1 : 0))
  const norm = Math.hypot(...vector) || 1
  return Float32Array.from(vector.map((value) => value / norm))
}

import { isRecord } from '@/lib/records'
import { sanitizeVegaLiteSpec, type SanitizedChart } from '@/lib/vega/sanitize-spec'

const MAX_TITLE_CHARS = 160
const MAX_SOURCE_NOTE_CHARS = 300

/** The `arche-chart/v1` envelope emitted by the chart_create / chart_render tools. */
export type ChartOutput = SanitizedChart & {
  title: string
  sourceNote?: string
}

function getBoundedString(value: unknown, maxChars: number): string | undefined {
  const text = typeof value === 'string' && value.trim() ? value.trim() : undefined
  if (!text || text.length > maxChars) return undefined
  return text
}

export function parseChartOutput(rawOutput?: string): ChartOutput | null {
  const source = rawOutput?.trim()
  if (!source) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return null
  }

  if (!isRecord(parsed) || parsed.ok !== true || parsed.format !== 'arche-chart/v1') return null
  if (!isRecord(parsed.chart)) return null

  const title = getBoundedString(parsed.chart.title, MAX_TITLE_CHARS)
  if (!title) return null

  const sourceNote = parsed.chart.sourceNote === undefined
    ? undefined
    : getBoundedString(parsed.chart.sourceNote, MAX_SOURCE_NOTE_CHARS)
  if (parsed.chart.sourceNote !== undefined && !sourceNote) return null

  const sanitized = sanitizeVegaLiteSpec(parsed.chart.spec)
  if (!sanitized) return null

  return sourceNote ? { ...sanitized, title, sourceNote } : { ...sanitized, title }
}

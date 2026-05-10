import { isRecord } from '@/lib/records'

const CHART_SCHEMA = 'https://vega.github.io/schema/vega-lite/v5.json'
const MAX_ROWS = 1000
const MAX_COLUMNS = 50
const MAX_TITLE_CHARS = 160
const MAX_SOURCE_NOTE_CHARS = 300
const URL_PATTERN = /\b(?:https?:\/\/|www\.)|\b(?:javascript|data):/i
const HTML_PATTERN = /[<>]/
const SAFE_MARKS = new Set(['bar', 'line', 'area', 'point', 'arc'])
const UNSAFE_SPEC_KEYS = new Set(['href', 'src', 'url'])

export type ChartSpec = {
  $schema: typeof CHART_SCHEMA
  data: { values: Record<string, unknown>[] }
  encoding: Record<string, unknown>
  mark: string
  [key: string]: unknown
}

export type ChartOutput = {
  title: string
  sourceNote?: string
  spec: ChartSpec
}

const getString = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

function isSafeString(value: string, allowSchema = false): boolean {
  if (allowSchema) return value === CHART_SCHEMA
  return !HTML_PATTERN.test(value) && !URL_PATTERN.test(value)
}

function getSafeString(value: unknown, maxChars: number): string | undefined {
  const text = getString(value)
  if (!text || text.length > maxChars) return undefined
  return isSafeString(text) ? text : undefined
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord)
}

function hasTooManyColumns(values: Record<string, unknown>[]): boolean {
  const columns = new Set<string>()

  for (const row of values) {
    for (const key of Object.keys(row)) {
      columns.add(key)
      if (columns.size > MAX_COLUMNS) return true
    }
  }

  return false
}

function hasUnsafeSpecValue(value: unknown, key = ''): boolean {
  if (UNSAFE_SPEC_KEYS.has(key.toLowerCase())) return true

  if (typeof value === 'string') {
    return !isSafeString(value, key === '$schema')
  }

  if (typeof value === 'number') return !Number.isFinite(value)
  if (!value || typeof value !== 'object') return false

  if (Array.isArray(value)) {
    return value.some((entry) => hasUnsafeSpecValue(entry, key))
  }

  return Object.entries(value).some(([entryKey, entryValue]) => hasUnsafeSpecValue(entryValue, entryKey))
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

  const title = getSafeString(parsed.chart.title, MAX_TITLE_CHARS)
  if (!title) return null

  const sourceNote = parsed.chart.sourceNote === undefined
    ? undefined
    : getSafeString(parsed.chart.sourceNote, MAX_SOURCE_NOTE_CHARS)
  if (parsed.chart.sourceNote !== undefined && !sourceNote) return null

  const spec = parsed.chart.spec
  if (!isRecord(spec)) return null
  if (spec.$schema !== CHART_SCHEMA) return null
  if (typeof spec.mark !== 'string' || !SAFE_MARKS.has(spec.mark)) return null
  if (!isRecord(spec.data) || !isRecordArray(spec.data.values)) return null
  if (spec.data.values.length === 0 || spec.data.values.length > MAX_ROWS) return null
  if (hasTooManyColumns(spec.data.values)) return null
  if (!isRecord(spec.encoding)) return null
  if (hasUnsafeSpecValue(spec)) return null

  const chartSpec: ChartSpec = {
    ...spec,
    $schema: CHART_SCHEMA,
    data: { values: spec.data.values },
    mark: spec.mark,
    encoding: spec.encoding,
  }

  return sourceNote ? { title, sourceNote, spec: chartSpec } : { title, spec: chartSpec }
}

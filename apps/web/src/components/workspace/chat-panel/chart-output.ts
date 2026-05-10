import { isRecord } from '@/lib/records'

const CHART_SCHEMA = 'https://vega.github.io/schema/vega-lite/v5.json'
const MAX_ROWS = 1000
const MAX_COLUMNS = 50
const MAX_TITLE_CHARS = 160
const MAX_SOURCE_NOTE_CHARS = 300
const URL_PATTERN = /\b(?:https?:\/\/|www\.)|\b(?:javascript|data):/i
const HTML_PATTERN = /[<>]/
const MAX_DIMENSION = 2000
const SAFE_MARKS = new Set(['bar', 'line', 'area', 'point', 'arc'])
const SAFE_AUTOSIZE_CONTAINS = new Set(['content', 'padding'])
const SAFE_AUTOSIZE_KEYS = new Set(['contains', 'type'])
const SAFE_AUTOSIZE_TYPES = new Set(['fit', 'none', 'pad'])
const SAFE_TOP_LEVEL_SPEC_KEYS = new Set([
  '$schema',
  'autosize',
  'data',
  'encoding',
  'height',
  'mark',
  'title',
  'width',
])
const UNSAFE_SPEC_KEYS = new Set(['href', 'src', 'url'])

type ChartAutosize = {
  contains?: string
  type?: string
}

export type ChartSpec = {
  $schema: typeof CHART_SCHEMA
  autosize?: ChartAutosize
  data: { values: Record<string, unknown>[] }
  encoding: Record<string, unknown>
  height?: number | string
  mark: string
  title?: string
  width?: number | string
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

function hasUnsupportedTopLevelSpecKey(spec: Record<string, unknown>): boolean {
  return Object.keys(spec).some((key) => !SAFE_TOP_LEVEL_SPEC_KEYS.has(key))
}

function getSafeDimension(value: unknown): number | string | undefined {
  if (value === 'container') return value
  if (typeof value !== 'number') return undefined
  return Number.isFinite(value) && value > 0 && value <= MAX_DIMENSION ? value : undefined
}

function getSafeAutosize(value: unknown): ChartAutosize | undefined {
  if (!isRecord(value)) return undefined
  if (Object.keys(value).some((key) => !SAFE_AUTOSIZE_KEYS.has(key))) return undefined

  const autosize: ChartAutosize = {}
  if (value.type !== undefined) {
    if (typeof value.type !== 'string' || !SAFE_AUTOSIZE_TYPES.has(value.type)) return undefined
    autosize.type = value.type
  }
  if (value.contains !== undefined) {
    if (typeof value.contains !== 'string' || !SAFE_AUTOSIZE_CONTAINS.has(value.contains)) return undefined
    autosize.contains = value.contains
  }

  return autosize
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
  if (hasUnsupportedTopLevelSpecKey(spec)) return null
  if (spec.$schema !== CHART_SCHEMA) return null
  if (typeof spec.mark !== 'string' || !SAFE_MARKS.has(spec.mark)) return null
  if (!isRecord(spec.data) || !isRecordArray(spec.data.values)) return null
  if (spec.data.values.length === 0 || spec.data.values.length > MAX_ROWS) return null
  if (hasTooManyColumns(spec.data.values)) return null
  if (!isRecord(spec.encoding)) return null
  if (hasUnsafeSpecValue(spec)) return null

  const specTitle = spec.title === undefined ? undefined : getSafeString(spec.title, MAX_TITLE_CHARS)
  if (spec.title !== undefined && !specTitle) return null

  const width = spec.width === undefined ? undefined : getSafeDimension(spec.width)
  if (spec.width !== undefined && width === undefined) return null

  const height = spec.height === undefined ? undefined : getSafeDimension(spec.height)
  if (spec.height !== undefined && height === undefined) return null

  const autosize = spec.autosize === undefined ? undefined : getSafeAutosize(spec.autosize)
  if (spec.autosize !== undefined && !autosize) return null

  const chartSpec: ChartSpec = {
    $schema: CHART_SCHEMA,
    data: { values: spec.data.values },
    encoding: spec.encoding,
    mark: spec.mark,
  }

  if (autosize) chartSpec.autosize = autosize
  if (height !== undefined) chartSpec.height = height
  if (specTitle) chartSpec.title = specTitle
  if (width !== undefined) chartSpec.width = width

  return sourceNote ? { title, sourceNote, spec: chartSpec } : { title, spec: chartSpec }
}

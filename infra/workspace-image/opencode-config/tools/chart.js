import { z } from 'zod'

import { toToolOutput } from '../shared/attachment-tools.js'

const MAX_ROWS = 1000
const MAX_COLUMNS = 50
const MAX_TITLE_CHARS = 160
const MAX_FIELD_CHARS = 80
const MAX_CELL_STRING_CHARS = 500
const MAX_SOURCE_NOTE_CHARS = 300
const VEGA_LITE_SCHEMA = 'https://vega.github.io/schema/vega-lite/v5.json'

const CHART_TYPES = ['bar', 'line', 'area', 'scatter', 'pie']
const UNSAFE_TEXT_PATTERN = /[<>]|\b(?:https?:\/\/|www\.)|\b(?:javascript|data):/i
const CHART_INPUT_EXAMPLE = {
  type: 'bar',
  title: 'Variation by segment',
  xField: 'segment',
  yField: 'change_percent',
  data: [
    { segment: 'Mexico', change_percent: 60 },
    { segment: 'Rest of countries', change_percent: -9.1 },
  ],
  sourceNote: 'Mixpanel, last 7 full days vs previous 7 days',
}
const INVALID_CHART_INPUT_HINT = [
  'chart_create requires inline data in the data field as an array of row objects.',
  'Do not put CSV, JSON, or numeric values only in sourceNote; sourceNote is metadata only.',
  'Every row must include the xField and yField keys, and every yField value must be a finite number.',
  `Example input: ${JSON.stringify(CHART_INPUT_EXAMPLE)}`,
].join(' ')

const chartTypeSchema = z.enum(CHART_TYPES)
const cellValueSchema = z.union([
  z.string().max(MAX_CELL_STRING_CHARS),
  z.number().finite(),
  z.boolean(),
  z.null(),
])
const chartRowSchema = z.record(z.string(), cellValueSchema)

const createArgsSchema = z.object({
  type: chartTypeSchema,
  title: z.string().min(1).max(MAX_TITLE_CHARS),
  xField: z.string().min(1).max(MAX_FIELD_CHARS),
  yField: z.string().min(1).max(MAX_FIELD_CHARS),
  data: z.array(chartRowSchema).min(1).max(MAX_ROWS),
  sourceNote: z.string().max(MAX_SOURCE_NOTE_CHARS).optional(),
}).strict()

function normalizeLineEndings(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

function normalizeSafeText(value, maxChars, allowEmpty = false) {
  const text = normalizeLineEndings(value)
  if (!allowEmpty && !text) return null
  if (text.length > maxChars) return null
  if (UNSAFE_TEXT_PATTERN.test(text)) return null
  return text
}

function isValidCellValue(value) {
  if (value === null) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean') return true
  if (typeof value !== 'string') return false
  return value.length <= MAX_CELL_STRING_CHARS && !UNSAFE_TEXT_PATTERN.test(value)
}

function normalizeRows(rows) {
  const columns = new Set()
  const normalizedRows = []

  for (const row of rows) {
    const nextRow = {}
    const rowKeys = new Set()

    for (const [rawKey, value] of Object.entries(row)) {
      const key = normalizeSafeText(rawKey, MAX_FIELD_CHARS)
      if (!key || rowKeys.has(key)) return null
      if (!isValidCellValue(value)) return null

      rowKeys.add(key)
      columns.add(key)
      if (columns.size > MAX_COLUMNS) return null

      nextRow[key] = typeof value === 'string' ? normalizeLineEndings(value) : value
    }

    normalizedRows.push(nextRow)
  }

  return { columns, rows: normalizedRows }
}

function hasPresentValue(row, field) {
  const value = row[field]
  return value !== null && value !== undefined && value !== ''
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function inferFieldType(rows, field) {
  return rows.every((row) => isFiniteNumber(row[field])) ? 'quantitative' : 'nominal'
}

function validateChartData(type, rows, xField, yField) {
  for (const row of rows) {
    if (!hasPresentValue(row, xField)) return false
    if (!isFiniteNumber(row[yField])) return false
    if (type === 'scatter' && !isFiniteNumber(row[xField])) return false
    if (type === 'pie' && row[yField] < 0) return false
  }

  return true
}

function buildSpec({ type, title, xField, yField, data }) {
  const baseSpec = {
    $schema: VEGA_LITE_SCHEMA,
    title,
    data: { values: data },
    width: 'container',
    height: type === 'pie' ? 300 : 320,
    autosize: { type: 'fit', contains: 'padding' },
  }

  if (type === 'pie') {
    return {
      ...baseSpec,
      mark: 'arc',
      encoding: {
        theta: { field: yField, type: 'quantitative' },
        color: { field: xField, type: 'nominal' },
      },
    }
  }

  const xType = type === 'scatter' ? 'quantitative' : inferFieldType(data, xField)
  const mark = type === 'scatter' ? 'point' : type
  return {
    ...baseSpec,
    mark,
    encoding: {
      x: { field: xField, type: xType },
      y: { field: yField, type: 'quantitative' },
    },
  }
}

function normalizeChartInput(input) {
  const title = normalizeSafeText(input.title, MAX_TITLE_CHARS)
  const xField = normalizeSafeText(input.xField, MAX_FIELD_CHARS)
  const yField = normalizeSafeText(input.yField, MAX_FIELD_CHARS)
  const sourceNote = input.sourceNote === undefined
    ? undefined
    : normalizeSafeText(input.sourceNote, MAX_SOURCE_NOTE_CHARS, true)
  const normalizedData = normalizeRows(input.data)

  if (!title || !xField || !yField || sourceNote === null || !normalizedData) {
    return null
  }

  if (!normalizedData.columns.has(xField) || !normalizedData.columns.has(yField)) {
    return null
  }

  if (!validateChartData(input.type, normalizedData.rows, xField, yField)) {
    return null
  }

  return {
    type: input.type,
    title,
    xField,
    yField,
    data: normalizedData.rows,
    sourceNote: sourceNote || undefined,
  }
}

function invalidChartInputOutput() {
  return toToolOutput({
    ok: false,
    error: 'invalid_chart_input',
    hint: INVALID_CHART_INPUT_HINT,
    example: CHART_INPUT_EXAMPLE,
  })
}

export const create = {
  description: [
    'Create a safe Vega-Lite chart from inline row data.',
    'Always pass the numeric rows in the required data field; sourceNote is only a short metadata note, ' +
      'not a place for CSV/JSON/data values.',
    `Example input: ${JSON.stringify(CHART_INPUT_EXAMPLE)}`,
  ].join(' '),
  args: {
    type: chartTypeSchema.describe('Chart type: bar, line, area, scatter, or pie.'),
    title: z.string().min(1).max(MAX_TITLE_CHARS).describe('Short chart title. Plain text only.'),
    xField: z.string().min(1).max(MAX_FIELD_CHARS).describe('Field name for the x-axis or category labels.'),
    yField: z.string().min(1).max(MAX_FIELD_CHARS).describe('Numeric field name for the y-axis or values.'),
    data: z.array(chartRowSchema).min(1).max(MAX_ROWS).describe(
      'Required inline chart data as row objects, for example [{"segment":"Mexico","change_percent":60}]. ' +
        'Maximum 1000 rows and 50 columns.',
    ),
    sourceNote: z.string().max(MAX_SOURCE_NOTE_CHARS).optional().describe(
      'Optional plain-text note explaining the data source. Do not put the chart data here.',
    ),
  },
  async execute(args) {
    const parsed = createArgsSchema.safeParse(args)
    if (!parsed.success) {
      return invalidChartInputOutput()
    }

    const chartInput = normalizeChartInput(parsed.data)
    if (!chartInput) {
      return invalidChartInputOutput()
    }

    return toToolOutput({
      ok: true,
      format: 'arche-chart/v1',
      chart: {
        title: chartInput.title,
        sourceNote: chartInput.sourceNote,
        spec: buildSpec(chartInput),
      },
    })
  },
}

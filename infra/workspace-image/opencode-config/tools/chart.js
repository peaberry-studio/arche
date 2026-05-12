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
const CHART_INPUT_CONTRACT_HINT = [
  'chart_create requires inline data in the data field as an array of row objects.',
  'Do not put CSV, JSON, or numeric values only in sourceNote; sourceNote is metadata only.',
  'Every row must include the xField and yField keys, and every yField value must be a finite number.',
  `Example input: ${JSON.stringify(CHART_INPUT_EXAMPLE)}`,
].join(' ')
const INVALID_CHART_INPUT_REASON_HINTS = {
  column_limit_exceeded: `The data field can include at most ${MAX_COLUMNS} distinct columns across all rows.`,
  invalid_chart_type: `The type field must be one of: ${CHART_TYPES.join(', ')}.`,
  missing_field: 'Every data row must include both the xField and yField keys.',
  non_finite_numeric: 'Numeric chart values must be finite; do not pass Infinity or NaN.',
  pie_negative_value: 'Pie charts require every yField value to be zero or greater.',
  row_limit_exceeded: `The data field can include at most ${MAX_ROWS} rows.`,
  scatter_x_not_numeric: 'Scatter charts require every xField value to be a finite number.',
  schema_validation_failed: 'The input did not match the chart_create argument schema.',
  unsafe_text: 'Use plain text only for title, field names, row strings, and sourceNote; do not include HTML or URLs.',
  y_not_numeric: 'Every yField value must be a finite number.',
}

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
      if (!key || rowKeys.has(key)) return { ok: false, reason: 'unsafe_text' }
      if (!isValidCellValue(value)) return { ok: false, reason: 'unsafe_text' }

      rowKeys.add(key)
      columns.add(key)
      if (columns.size > MAX_COLUMNS) return { ok: false, reason: 'column_limit_exceeded' }

      nextRow[key] = typeof value === 'string' ? normalizeLineEndings(value) : value
    }

    normalizedRows.push(nextRow)
  }

  return { ok: true, columns, rows: normalizedRows }
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
    if (!hasPresentValue(row, xField)) return 'missing_field'
    if (!isFiniteNumber(row[yField])) return 'y_not_numeric'
    if (type === 'scatter' && !isFiniteNumber(row[xField])) return 'scatter_x_not_numeric'
    if (type === 'pie' && row[yField] < 0) return 'pie_negative_value'
  }

  return null
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

  if (!title || !xField || !yField || sourceNote === null) {
    return { ok: false, reason: 'unsafe_text' }
  }

  if (!normalizedData.ok) {
    return normalizedData
  }

  if (!normalizedData.columns.has(xField) || !normalizedData.columns.has(yField)) {
    return { ok: false, reason: 'missing_field' }
  }

  const dataValidationReason = validateChartData(input.type, normalizedData.rows, xField, yField)
  if (dataValidationReason) {
    return { ok: false, reason: dataValidationReason }
  }

  return {
    ok: true,
    value: {
      type: input.type,
      title,
      xField,
      yField,
      data: normalizedData.rows,
      sourceNote: sourceNote || undefined,
    },
  }
}

function hasNonFiniteNumber(value) {
  if (typeof value === 'number') return !Number.isFinite(value)
  if (Array.isArray(value)) return value.some((item) => hasNonFiniteNumber(item))
  if (!value || typeof value !== 'object') return false
  return Object.values(value).some((item) => hasNonFiniteNumber(item))
}

function schemaFailureReason(input) {
  if (input && typeof input === 'object') {
    if ('type' in input && !CHART_TYPES.includes(input.type)) return 'invalid_chart_type'
    if (Array.isArray(input.data) && input.data.length > MAX_ROWS) return 'row_limit_exceeded'
    if (hasNonFiniteNumber(input.data)) return 'non_finite_numeric'
  }

  return 'schema_validation_failed'
}

function invalidChartInputOutput(reason) {
  return toToolOutput({
    ok: false,
    error: 'invalid_chart_input',
    reason,
    hint: `${INVALID_CHART_INPUT_REASON_HINTS[reason]} ${CHART_INPUT_CONTRACT_HINT}`,
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
      'Required inline chart data as row objects. Maximum 1000 rows and 50 columns.',
    ),
    sourceNote: z.string().max(MAX_SOURCE_NOTE_CHARS).optional().describe(
      'Optional plain-text note explaining the data source. Do not put the chart data here.',
    ),
  },
  async execute(args) {
    const parsed = createArgsSchema.safeParse(args)
    if (!parsed.success) {
      return invalidChartInputOutput(schemaFailureReason(args))
    }

    const normalized = normalizeChartInput(parsed.data)
    if (!normalized.ok) {
      return invalidChartInputOutput(normalized.reason)
    }

    const chartInput = normalized.value

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

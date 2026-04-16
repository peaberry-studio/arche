import * as XLSX from 'xlsx'
import { z } from 'zod'

import {
  readAttachmentBuffer,
  resolveAttachmentPath,
  toToolOutput,
} from '../shared/attachment-tools.js'

const MAX_SAMPLE_LIMIT = 500
const MAX_QUERY_LIMIT = 1000
const MAX_COLUMN_COUNT = 200

function resolveSpreadsheetPath(inputPath) {
  return resolveAttachmentPath(inputPath)
}

async function readWorkbook(filePath) {
  const fileResult = await readAttachmentBuffer(filePath)
  if (!fileResult.ok) return fileResult

  try {
    const workbook = XLSX.read(fileResult.buffer, {
      type: 'buffer',
      cellDates: true,
      raw: false,
      dense: true,
    })
    return { ok: true, workbook, fileSize: fileResult.fileSize }
  } catch {
    return { ok: false, error: 'unsupported_or_corrupted_spreadsheet' }
  }
}

function getSheetRows(workbook, sheetName) {
  const targetSheet = sheetName || workbook.SheetNames[0]
  if (!targetSheet || !workbook.Sheets[targetSheet]) {
    return { ok: false, error: 'invalid_sheet' }
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[targetSheet], {
    defval: null,
    raw: false,
    blankrows: false,
  })
  return { ok: true, sheetName: targetSheet, rows }
}

function inferColumnType(values) {
  let numberCount = 0
  let boolCount = 0
  let dateCount = 0
  let stringCount = 0

  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    if (typeof value === 'number') {
      numberCount += 1
      continue
    }
    if (typeof value === 'boolean') {
      boolCount += 1
      continue
    }
    if (value instanceof Date) {
      dateCount += 1
      continue
    }

    const parsedNumber = Number(value)
    if (!Number.isNaN(parsedNumber) && String(value).trim() !== '') {
      numberCount += 1
      continue
    }

    const parsedDate = Date.parse(String(value))
    if (!Number.isNaN(parsedDate)) {
      dateCount += 1
      continue
    }

    stringCount += 1
  }

  const counts = [
    ['number', numberCount],
    ['boolean', boolCount],
    ['date', dateCount],
    ['string', stringCount],
  ]

  counts.sort((a, b) => b[1] - a[1])
  const [topType, topCount] = counts[0]
  return topCount > 0 ? topType : 'unknown'
}

function getColumns(rows) {
  const columns = new Set()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      columns.add(key)
      if (columns.size >= MAX_COLUMN_COUNT) break
    }
    if (columns.size >= MAX_COLUMN_COUNT) break
  }
  return Array.from(columns)
}

function projectRow(row, select) {
  if (!select || select.length === 0) return row
  const projected = {}
  for (const column of select) projected[column] = row[column] ?? null
  return projected
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isNaN(parsed) ? null : parsed
}

function compareValues(left, right) {
  if (left === right) return 0
  if (left === null || left === undefined) return -1
  if (right === null || right === undefined) return 1

  const leftNum = parseNumber(left)
  const rightNum = parseNumber(right)
  if (leftNum !== null && rightNum !== null) {
    if (leftNum < rightNum) return -1
    if (leftNum > rightNum) return 1
    return 0
  }

  const leftText = String(left).toLowerCase()
  const rightText = String(right).toLowerCase()
  if (leftText < rightText) return -1
  if (leftText > rightText) return 1
  return 0
}

function applyFilters(rows, filters) {
  if (!filters || filters.length === 0) return rows

  return rows.filter((row) => {
    for (const filter of filters) {
      const value = row[filter.column]
      const op = filter.op

      if (op === 'eq' && value !== filter.value) return false
      if (op === 'neq' && value === filter.value) return false
      if (op === 'contains' && !String(value ?? '').toLowerCase().includes(String(filter.value ?? '').toLowerCase())) return false
      if (op === 'starts_with' && !String(value ?? '').toLowerCase().startsWith(String(filter.value ?? '').toLowerCase())) return false
      if (op === 'ends_with' && !String(value ?? '').toLowerCase().endsWith(String(filter.value ?? '').toLowerCase())) return false
      if (op === 'in' && Array.isArray(filter.values) && !filter.values.includes(value)) return false

      const leftNum = parseNumber(value)
      const rightNum = parseNumber(filter.value)
      if ((op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') && (leftNum === null || rightNum === null)) {
        return false
      }
      if (op === 'gt' && !(leftNum > rightNum)) return false
      if (op === 'gte' && !(leftNum >= rightNum)) return false
      if (op === 'lt' && !(leftNum < rightNum)) return false
      if (op === 'lte' && !(leftNum <= rightNum)) return false
    }

    return true
  })
}

function applySort(rows, sort) {
  if (!sort || sort.length === 0) return rows

  const sorted = [...rows]
  sorted.sort((a, b) => {
    for (const clause of sort) {
      const direction = clause.direction === 'desc' ? -1 : 1
      const compared = compareValues(a[clause.column], b[clause.column])
      if (compared !== 0) return compared * direction
    }
    return 0
  })
  return sorted
}

function runAggregates(rows, groupBy, aggregates) {
  const groups = new Map()
  const groupingColumns = groupBy || []

  for (const row of rows) {
    const keyObject = {}
    for (const column of groupingColumns) keyObject[column] = row[column] ?? null
    const key = JSON.stringify(keyObject)

    if (!groups.has(key)) {
      groups.set(key, { keyObject, rows: [] })
    }
    groups.get(key).rows.push(row)
  }

  const result = []
  for (const group of groups.values()) {
    const output = { ...group.keyObject }

    for (const aggregate of aggregates) {
      const alias = aggregate.as || `${aggregate.op}_${aggregate.column || 'all'}`
      const values = aggregate.column
        ? group.rows.map((row) => row[aggregate.column])
        : group.rows.map(() => 1)

      if (aggregate.op === 'count') {
        output[alias] = aggregate.column
          ? values.filter((value) => value !== null && value !== undefined && value !== '').length
          : group.rows.length
        continue
      }

      if (aggregate.op === 'count_distinct') {
        output[alias] = new Set(values.filter((value) => value !== null && value !== undefined && value !== '')).size
        continue
      }

      const numeric = values
        .map((value) => parseNumber(value))
        .filter((value) => value !== null)

      if (aggregate.op === 'sum') {
        output[alias] = numeric.reduce((acc, value) => acc + value, 0)
        continue
      }
      if (aggregate.op === 'avg') {
        output[alias] = numeric.length ? numeric.reduce((acc, value) => acc + value, 0) / numeric.length : null
        continue
      }
      if (aggregate.op === 'min') {
        output[alias] = numeric.length ? Math.min(...numeric) : null
        continue
      }
      if (aggregate.op === 'max') {
        output[alias] = numeric.length ? Math.max(...numeric) : null
      }
    }

    result.push(output)
  }

  return result
}

const filterSchema = z.object({
  column: z.string(),
  op: z.enum([
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'contains',
    'starts_with',
    'ends_with',
    'in',
  ]),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  values: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
})

const sortSchema = z.object({
  column: z.string(),
  direction: z.enum(['asc', 'desc']).optional(),
})

const aggregateSchema = z.object({
  op: z.enum(['count', 'count_distinct', 'sum', 'avg', 'min', 'max']),
  column: z.string().optional(),
  as: z.string().optional(),
})

export const inspect = {
  description: 'Inspect spreadsheet structure and inferred schema',
  args: {
    path: z.string().describe('Path under .arche/attachments/'),
  },
  async execute(args) {
    const resolved = resolveSpreadsheetPath(args.path)
    if (!resolved.ok) return toToolOutput(resolved)

    const workbookResult = await readWorkbook(resolved.path)
    if (!workbookResult.ok) return toToolOutput(workbookResult)

    const sheets = []
    for (const sheetName of workbookResult.workbook.SheetNames) {
      const rowsResult = getSheetRows(workbookResult.workbook, sheetName)
      if (!rowsResult.ok) continue

      const columns = getColumns(rowsResult.rows)
      const columnSummaries = columns.map((column) => {
        const values = rowsResult.rows.map((row) => row[column])
        const nullCount = values.filter((value) => value === null || value === undefined || value === '').length
        return {
          name: column,
          inferredType: inferColumnType(values),
          nullCount,
          nonNullCount: values.length - nullCount,
        }
      })

      sheets.push({
        name: sheetName,
        rowCount: rowsResult.rows.length,
        columnCount: columns.length,
        columns: columnSummaries,
      })
    }

    return toToolOutput({
      ok: true,
      path: resolved.path,
      fileSize: workbookResult.fileSize,
      sheetCount: sheets.length,
      sheets,
    })
  },
}

export const sample = {
  description: 'Get paginated spreadsheet rows',
  args: {
    path: z.string().describe('Path under .arche/attachments/'),
    sheet: z.string().optional(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(MAX_SAMPLE_LIMIT).optional(),
    select: z.array(z.string()).optional(),
  },
  async execute(args) {
    const resolved = resolveSpreadsheetPath(args.path)
    if (!resolved.ok) return toToolOutput(resolved)

    const workbookResult = await readWorkbook(resolved.path)
    if (!workbookResult.ok) return toToolOutput(workbookResult)

    const rowsResult = getSheetRows(workbookResult.workbook, args.sheet)
    if (!rowsResult.ok) return toToolOutput(rowsResult)

    const offset = args.offset || 0
    const limit = Math.min(args.limit || 50, MAX_SAMPLE_LIMIT)
    const sliced = rowsResult.rows.slice(offset, offset + limit)

    return toToolOutput({
      ok: true,
      path: resolved.path,
      sheet: rowsResult.sheetName,
      totalRows: rowsResult.rows.length,
      returnedRows: sliced.length,
      offset,
      limit,
      rows: sliced.map((row) => projectRow(row, args.select)),
      truncated: offset + limit < rowsResult.rows.length,
    })
  },
}

export const query = {
  description: 'Run filtered and aggregated spreadsheet queries',
  args: {
    path: z.string().describe('Path under .arche/attachments/'),
    sheet: z.string().optional(),
    select: z.array(z.string()).optional(),
    filters: z.array(filterSchema).optional(),
    groupBy: z.array(z.string()).optional(),
    aggregates: z.array(aggregateSchema).optional(),
    sort: z.array(sortSchema).optional(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(MAX_QUERY_LIMIT).optional(),
  },
  async execute(args) {
    const resolved = resolveSpreadsheetPath(args.path)
    if (!resolved.ok) return toToolOutput(resolved)

    const workbookResult = await readWorkbook(resolved.path)
    if (!workbookResult.ok) return toToolOutput(workbookResult)

    const rowsResult = getSheetRows(workbookResult.workbook, args.sheet)
    if (!rowsResult.ok) return toToolOutput(rowsResult)

    const filtered = applyFilters(rowsResult.rows, args.filters)
    const hasAggregates = Array.isArray(args.aggregates) && args.aggregates.length > 0
    const hasGrouping = Array.isArray(args.groupBy) && args.groupBy.length > 0

    const queried = hasAggregates || hasGrouping
      ? runAggregates(filtered, args.groupBy || [], args.aggregates || [{ op: 'count', as: 'count_rows' }])
      : filtered

    const sorted = applySort(queried, args.sort)
    const offset = args.offset || 0
    const limit = Math.min(args.limit || 100, MAX_QUERY_LIMIT)
    const paginated = sorted.slice(offset, offset + limit)

    return toToolOutput({
      ok: true,
      path: resolved.path,
      sheet: rowsResult.sheetName,
      totalRows: queried.length,
      returnedRows: paginated.length,
      offset,
      limit,
      rows: paginated.map((row) => projectRow(row, args.select)),
      truncated: offset + limit < queried.length,
    })
  },
}

export const stats = {
  description: 'Compute spreadsheet column statistics',
  args: {
    path: z.string().describe('Path under .arche/attachments/'),
    sheet: z.string().optional(),
    columns: z.array(z.string()).optional(),
  },
  async execute(args) {
    const resolved = resolveSpreadsheetPath(args.path)
    if (!resolved.ok) return toToolOutput(resolved)

    const workbookResult = await readWorkbook(resolved.path)
    if (!workbookResult.ok) return toToolOutput(workbookResult)

    const rowsResult = getSheetRows(workbookResult.workbook, args.sheet)
    if (!rowsResult.ok) return toToolOutput(rowsResult)

    const columns = (args.columns && args.columns.length > 0)
      ? args.columns
      : getColumns(rowsResult.rows)

    const columnStats = []
    for (const column of columns) {
      const values = rowsResult.rows.map((row) => row[column])
      const nonNull = values.filter((value) => value !== null && value !== undefined && value !== '')
      const nullCount = values.length - nonNull.length
      const inferredType = inferColumnType(values)

      const numeric = nonNull
        .map((value) => parseNumber(value))
        .filter((value) => value !== null)

      const frequency = new Map()
      for (const value of nonNull) {
        const key = String(value)
        frequency.set(key, (frequency.get(key) || 0) + 1)
      }

      const topValues = Array.from(frequency.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([value, count]) => ({ value, count }))

      columnStats.push({
        column,
        inferredType,
        nullCount,
        nonNullCount: nonNull.length,
        distinctCount: frequency.size,
        numeric: numeric.length
          ? {
              min: Math.min(...numeric),
              max: Math.max(...numeric),
              sum: numeric.reduce((acc, value) => acc + value, 0),
              avg: numeric.reduce((acc, value) => acc + value, 0) / numeric.length,
            }
          : null,
        topValues,
      })
    }

    return toToolOutput({
      ok: true,
      path: resolved.path,
      sheet: rowsResult.sheetName,
      rowCount: rowsResult.rows.length,
      columnCount: columns.length,
      columns: columnStats,
    })
  },
}

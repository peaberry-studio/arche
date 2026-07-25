import test from 'node:test'
import assert from 'node:assert/strict'

import * as chartTools from '../tools/chart.js'
import * as diagramTools from '../tools/diagram.js'
import * as documentTools from '../tools/document.js'
import * as emailTools from '../tools/email.js'
import * as flowTools from '../tools/flow.js'
import * as learningTools from '../tools/learning.js'
import * as presentationTools from '../tools/presentation.js'
import * as sessionHistoryTools from '../tools/session_history.js'
import * as spreadsheetTools from '../tools/spreadsheet.js'

test('tool modules only export executable tool definitions', () => {
  assert.deepEqual(Object.keys(chartTools).sort(), ['create', 'render'])
  assert.deepEqual(Object.keys(diagramTools).sort(), ['create'])
  assert.deepEqual(Object.keys(documentTools).sort(), ['inspect'])
  assert.deepEqual(Object.keys(emailTools).sort(), ['draft'])
  assert.deepEqual(Object.keys(flowTools).sort(), ['propose'])
  assert.deepEqual(Object.keys(learningTools).sort(), ['propose'])
  assert.deepEqual(Object.keys(presentationTools).sort(), ['inspect'])
  assert.deepEqual(Object.keys(sessionHistoryTools).sort(), ['query'])
  assert.deepEqual(Object.keys(spreadsheetTools).sort(), ['inspect', 'query', 'sample', 'stats'])
})

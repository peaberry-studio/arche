import test, { after } from 'node:test'
import assert from 'node:assert/strict'

import { resolveAttachmentPath } from '../shared/attachment-tools.js'
import { inspect } from '../tools/document.js'
import { ensureOfficeFixtures } from './office-fixtures.js'
import { createWorkspaceTestEnv } from './workspace-test-env.js'

const workspace = await createWorkspaceTestEnv('arche-document-test-')

after(async () => {
  await workspace.cleanup()
})

const FIXTURE_DIR = workspace.attachmentsDir

function parseOutput(output) {
  return JSON.parse(output)
}

test('resolveAttachmentPath enforces .arche/attachments boundary for documents', () => {
  assert.deepEqual(resolveAttachmentPath('.arche/attachments/brief.docx'), {
    ok: true,
    path: `${workspace.workspaceDir}/.arche/attachments/brief.docx`,
  })

  assert.deepEqual(resolveAttachmentPath('../outside.docx'), {
    ok: false,
    error: 'path_outside_attachments',
  })
})

test('document_inspect parses DOCX and ODT documents', async () => {
  const fixtures = await ensureOfficeFixtures(FIXTURE_DIR)

  const docxResult = parseOutput(
    await inspect.execute({ path: '.arche/attachments/document-test.docx' }),
  )
  assert.equal(docxResult.ok, true)
  assert.equal(docxResult.format, 'docx')
  assert.equal(docxResult.headingCount, 1)
  assert.equal(docxResult.headings[0].text, 'Project Overview')
  assert.match(docxResult.text, /launch plan/)
  assert.equal(docxResult.nodeTypeCounts.heading, 1)

  const odtResult = parseOutput(
    await inspect.execute({ path: '.arche/attachments/document-test.odt' }),
  )
  assert.equal(odtResult.ok, true)
  assert.equal(odtResult.format, 'odt')
  assert.equal(odtResult.headingCount, 1)
  assert.equal(odtResult.headings[0].level, 1)
  assert.match(odtResult.text, /strategy memo/)

  assert.equal(fixtures.docxPath, `${FIXTURE_DIR}/document-test.docx`)
  assert.equal(fixtures.odtPath, `${FIXTURE_DIR}/document-test.odt`)
})

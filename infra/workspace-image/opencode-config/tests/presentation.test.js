import test, { after } from 'node:test'
import assert from 'node:assert/strict'

import { resolveAttachmentPath } from '../shared/attachment-tools.js'
import { inspect } from '../tools/presentation.js'
import { ensureOfficeFixtures } from './office-fixtures.js'
import { createWorkspaceTestEnv } from './workspace-test-env.js'

const workspace = await createWorkspaceTestEnv('arche-presentation-test-')

after(async () => {
  await workspace.cleanup()
})

const FIXTURE_DIR = workspace.attachmentsDir

function parseOutput(output) {
  return JSON.parse(output)
}

test('resolveAttachmentPath enforces .arche/attachments boundary for presentations', () => {
  assert.deepEqual(resolveAttachmentPath('.arche/attachments/deck.pptx'), {
    ok: true,
    path: `${workspace.workspaceDir}/.arche/attachments/deck.pptx`,
  })

  assert.deepEqual(resolveAttachmentPath('/workspace/.arche/../deck.pptx'), {
    ok: false,
    error: 'path_outside_attachments',
  })
})

test('presentation_inspect parses PPTX and ODP presentations', async () => {
  const fixtures = await ensureOfficeFixtures(FIXTURE_DIR)

  const pptxResult = parseOutput(
    await inspect.execute({ path: '.arche/attachments/presentation-test.pptx' }),
  )
  assert.equal(pptxResult.ok, true)
  assert.equal(pptxResult.format, 'pptx')
  assert.equal(pptxResult.slideCount, 1)
  assert.equal(pptxResult.slides[0].slideNumber, 1)
  assert.equal(pptxResult.slides[0].title, 'Quarterly Review')
  assert.match(pptxResult.text, /Revenue up 18 percent/)
  assert.equal(pptxResult.nodeTypeCounts.slide, 1)

  const odpResult = parseOutput(
    await inspect.execute({ path: '.arche/attachments/presentation-test.odp' }),
  )
  assert.equal(odpResult.ok, true)
  assert.equal(odpResult.format, 'odp')
  assert.equal(odpResult.slideCount, 1)
  assert.equal(odpResult.slides[0].title, 'Open Deck Title')
  assert.match(odpResult.text, /ODP slide body content/)

  assert.equal(fixtures.pptxPath, `${FIXTURE_DIR}/presentation-test.pptx`)
  assert.equal(fixtures.odpPath, `${FIXTURE_DIR}/presentation-test.odp`)
})

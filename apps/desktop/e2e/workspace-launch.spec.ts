import { expect, test, waitForWorkspaceReady } from './fixtures/desktop'

test('launches the local desktop workspace', async ({ page }) => {
  await waitForWorkspaceReady(page)
})

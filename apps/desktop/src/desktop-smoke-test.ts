import type { App, BrowserWindow, Dialog } from 'electron'

const DEFAULT_SMOKE_TEST_TIMEOUT_MS = 90_000

type SmokeTestLaunchContext = {
  mode: string
  vaultPath: string | null
}

type SmokeTestWindowState = {
  pathname?: unknown
  isDesktop?: unknown
  probeStatus?: unknown
  probeError?: unknown
}

type DesktopSmokeTestHarnessOptions = {
  app: Pick<App, 'quit'>
  dialog: Pick<Dialog, 'showErrorBox'>
}

function isSmokeTestEnabled(): boolean {
  return process.env.ARCHE_DESKTOP_SMOKE_TEST === '1'
}

function getSmokeTestExpectedPath(): string {
  const expectedPath = process.env.ARCHE_DESKTOP_SMOKE_TEST_EXPECTED_PATH?.trim()
  return expectedPath || '/w/local'
}

function getSmokeTestTimeoutMs(): number {
  const raw = process.env.ARCHE_DESKTOP_SMOKE_TEST_TIMEOUT_MS
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SMOKE_TEST_TIMEOUT_MS
  }

  return parsed
}

function writeSmokeTestLog(message: string, stream: 'stdout' | 'stderr' = 'stdout'): void {
  process[stream].write(`[desktop-smoke] ${message}\n`)
}

export function createDesktopSmokeTestHarness({ app, dialog }: DesktopSmokeTestHarnessOptions) {
  const enabled = isSmokeTestEnabled()

  let smokeTestFinished = false
  let smokeTestTimer: NodeJS.Timeout | null = null

  function completeSmokeTest(ok: boolean, message: string): void {
    if (!enabled || smokeTestFinished) {
      return
    }

    smokeTestFinished = true
    if (smokeTestTimer) {
      clearTimeout(smokeTestTimer)
      smokeTestTimer = null
    }

    process.exitCode = ok ? 0 : 1
    writeSmokeTestLog(message, ok ? 'stdout' : 'stderr')
    app.quit()
  }

  async function evaluateWindow(window: BrowserWindow): Promise<void> {
    if (!enabled || smokeTestFinished || window.isDestroyed()) {
      return
    }

    try {
      const expectedPath = getSmokeTestExpectedPath()
      const state = await window.webContents.executeJavaScript(
        `(async () => {
          const pathname = window.location.pathname
          const isDesktop = Boolean(window.arche?.isDesktop)

          if (pathname !== ${JSON.stringify(expectedPath)} || !isDesktop) {
            return { pathname, isDesktop, probeStatus: null, probeError: null }
          }

          try {
            const response = await fetch('/api/u/local/agents', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: 'not-json',
            })

            let body = null
            try {
              body = await response.json()
            } catch {
              body = null
            }

            return {
              pathname,
              isDesktop,
              probeStatus: response.status,
              probeError: typeof body?.error === 'string' ? body.error : null,
            }
          } catch (error) {
            return {
              pathname,
              isDesktop,
              probeStatus: null,
              probeError: error instanceof Error ? error.message : String(error),
            }
          }
        })()`,
        true,
      ) as SmokeTestWindowState

      const pathname = typeof state.pathname === 'string' ? state.pathname : 'unknown'
      const isDesktop = state.isDesktop === true
      const probeStatus = typeof state.probeStatus === 'number' ? state.probeStatus : null
      const probeError = typeof state.probeError === 'string' ? state.probeError : null

      if (pathname === expectedPath && isDesktop && probeStatus === 400 && probeError === 'invalid_json') {
        completeSmokeTest(true, `success path=${pathname} probe=${probeStatus}:${probeError}`)
        return
      }

      if (pathname === expectedPath && isDesktop && probeStatus !== null) {
        completeSmokeTest(
          false,
          `unexpected auth probe status=${String(probeStatus)} error=${probeError ?? 'null'} path=${pathname}`,
        )
        return
      }

      if (pathname === expectedPath && isDesktop && probeError) {
        completeSmokeTest(false, `auth probe failed: ${probeError}`)
        return
      }

      writeSmokeTestLog(
        `waiting expected=${expectedPath} current=${pathname} desktop=${String(isDesktop)} probe=${probeStatus === null ? 'pending' : `${String(probeStatus)}:${probeError ?? 'null'}`}`,
      )
    } catch (error) {
      completeSmokeTest(
        false,
        `window evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  function installWindowHooks(window: BrowserWindow): void {
    if (!enabled || smokeTestTimer) {
      return
    }

    const timeoutMs = getSmokeTestTimeoutMs()
    smokeTestTimer = setTimeout(() => {
      completeSmokeTest(false, `timeout after ${timeoutMs}ms waiting for ${getSmokeTestExpectedPath()}`)
    }, timeoutMs)

    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) {
        return
      }

      completeSmokeTest(
        false,
        `did-fail-load code=${String(errorCode)} url=${validatedURL} error=${errorDescription}`,
      )
    })

    window.webContents.on('render-process-gone', (_event, details) => {
      completeSmokeTest(
        false,
        `render-process-gone reason=${details.reason} exitCode=${String(details.exitCode)}`,
      )
    })

    window.webContents.on('did-finish-load', () => {
      void evaluateWindow(window)
    })
  }

  return {
    isEnabled(): boolean {
      return enabled
    },

    shouldShowWindow(): boolean {
      return !enabled
    },

    reportLaunchContext(launchContext: SmokeTestLaunchContext): void {
      if (!enabled) {
        return
      }

      writeSmokeTestLog(`launch_context mode=${launchContext.mode} vaultPath=${launchContext.vaultPath ?? 'null'}`)
    },

    reportInvalidVault(vaultPath: string | null): void {
      if (!enabled) {
        return
      }

      writeSmokeTestLog(`invalid_vault path=${vaultPath ?? 'null'}`, 'stderr')
    },

    handleStartupFailure(title: string, message: string): boolean {
      if (enabled) {
        completeSmokeTest(false, message)
        return true
      }

      dialog.showErrorBox(title, message)
      return false
    },

    installWindowHooks,
  }
}

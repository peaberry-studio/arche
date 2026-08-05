import { afterEach, describe, expect, it, vi } from "vitest"

const originalRuntimeMode = process.env.ARCHE_RUNTIME_MODE
const originalDesktopDistDir = process.env.ARCHE_DESKTOP_NEXT_DIST_DIR

afterEach(() => {
  if (originalRuntimeMode === undefined) {
    delete process.env.ARCHE_RUNTIME_MODE
  } else {
    process.env.ARCHE_RUNTIME_MODE = originalRuntimeMode
  }
  if (originalDesktopDistDir === undefined) {
    delete process.env.ARCHE_DESKTOP_NEXT_DIST_DIR
  } else {
    process.env.ARCHE_DESKTOP_NEXT_DIST_DIR = originalDesktopDistDir
  }
  vi.resetModules()
})

describe("desktop Next.js configuration", () => {
  it("traces the Paged.js polyfill into standalone output", async () => {
    process.env.ARCHE_RUNTIME_MODE = "desktop"
    delete process.env.ARCHE_DESKTOP_NEXT_DIST_DIR
    vi.resetModules()

    const { default: config } = await import("../next.config")

    expect(config.outputFileTracingIncludes?.["/*"]).toContain(
      "./node_modules/pagedjs/dist/paged.polyfill.min.js",
    )
  })
})

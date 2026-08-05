import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  browserClose: vi.fn(),
  launch: vi.fn(),
  newPage: vi.fn(),
  readFileSync: vi.fn(),
}))

vi.mock("node:fs", () => ({
  default: { readFileSync: mocks.readFileSync },
}))
vi.mock("@sparticuz/chromium", () => ({
  default: {
    args: ["--headless"],
    executablePath: vi.fn().mockResolvedValue("/tmp/chromium"),
  },
}))
vi.mock("puppeteer-core", () => ({
  default: {
    launch: mocks.launch,
  },
}))

import { pagedHtmlToPdf } from "@/lib/paged-html-to-pdf"

function createPage(adjustments: Record<string, number>) {
  return {
    addScriptTag: vi.fn().mockResolvedValue(undefined),
    addStyleTag: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockImplementation((script: string | (() => unknown)) => {
      if (typeof script === "string") return Promise.resolve(undefined)
      return Promise.resolve(adjustments)
    }),
    on: vi.fn(),
    pdf: vi.fn().mockResolvedValue(new TextEncoder().encode("%PDF")),
    setContent: vi.fn().mockResolvedValue(undefined),
    setDefaultTimeout: vi.fn(),
    setJavaScriptEnabled: vi.fn().mockResolvedValue(undefined),
    setRequestInterception: vi.fn().mockResolvedValue(undefined),
  }
}

describe("pagedHtmlToPdf", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readFileSync.mockReturnValue("window.PagedPolyfill = {}")
    mocks.launch.mockResolvedValue({
      close: mocks.browserClose,
      newPage: mocks.newPage,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("prints a single pagination pass when figures do not need adjustment", async () => {
    const page = createPage({})
    mocks.newPage.mockResolvedValueOnce(page)

    const result = await pagedHtmlToPdf("<html><body>Document</body></html>")

    expect(new TextDecoder().decode(result)).toBe("%PDF")
    expect(mocks.newPage).toHaveBeenCalledTimes(1)
    expect(page.addScriptTag).toHaveBeenCalledWith({
      content: expect.stringContaining("PagedPolyfill"),
    })
    expect(mocks.readFileSync).toHaveBeenCalledWith(
      path.resolve(
        process.cwd(),
        "node_modules/pagedjs/dist/paged.polyfill.min.js",
      ),
      "utf-8",
    )
    expect(page.pdf).toHaveBeenCalledWith({
      format: "A4",
      preferCSSPageSize: true,
      printBackground: true,
      tagged: true,
    })
    expect(mocks.browserClose).toHaveBeenCalled()
  })

  it("repaginates with a bounded figure scale adjustment", async () => {
    const firstPage = createPage({ "figure-1": 0.85 })
    const finalPage = createPage({})
    mocks.newPage
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(finalPage)

    await pagedHtmlToPdf("<html><body>Document</body></html>")

    expect(mocks.newPage).toHaveBeenCalledTimes(2)
    expect(firstPage.close).toHaveBeenCalled()
    expect(finalPage.addStyleTag).toHaveBeenCalledWith({
      content: expect.stringContaining(
        '.pdf-figure[data-figure-id="figure-1"] .pdf-figure-content { width: 85%; }',
      ),
    })
  })

  it("times out and closes Chromium when pagination preview does not settle", async () => {
    vi.useFakeTimers()
    const page = createPage({})
    page.evaluate.mockImplementation((script: string | (() => unknown)) => {
      if (script === "window.PagedPolyfill.preview()") {
        return new Promise<void>(() => undefined)
      }
      if (typeof script === "string") return Promise.resolve(undefined)
      return Promise.resolve({})
    })
    mocks.newPage.mockResolvedValueOnce(page)

    let completion: "fulfilled" | "rejected" | null = null
    void pagedHtmlToPdf("<html><body>Document</body></html>").then(
      () => {
        completion = "fulfilled"
      },
      () => {
        completion = "rejected"
      },
    )

    await vi.advanceTimersByTimeAsync(60_000)

    expect(completion).toBe("rejected")
    expect(page.close).toHaveBeenCalled()
    expect(mocks.browserClose).toHaveBeenCalled()
  })
})

import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

import type { Browser, Page } from "puppeteer-core"

const MAX_PAGINATION_PASSES = 3
const MIN_FIGURE_SCALE = 0.8

type FigureScales = Record<string, number>

function loadPagedJsScript(): string {
  const require = createRequire(import.meta.url)
  const entryPath = require.resolve("pagedjs")
  return fs.readFileSync(
    path.resolve(path.dirname(entryPath), "../dist/paged.polyfill.min.js"),
    "utf-8",
  )
}

function buildFigureScaleCss(scales: FigureScales): string {
  return Object.entries(scales)
    .map(
      ([figureId, scale]) =>
        `.pdf-figure[data-figure-id="${figureId}"] .pdf-figure-content { width: ${scale * 100}%; }`,
    )
    .join("\n")
}

async function createPaginatedPage(
  browser: Browser,
  html: string,
  pagedJsScript: string,
  scales: FigureScales,
): Promise<Page> {
  const page = await browser.newPage()
  page.setDefaultTimeout(45_000)
  await page.setJavaScriptEnabled(true)
  await page.setRequestInterception(true)
  page.on("request", (request) => {
    if (request.url().startsWith("data:")) {
      request.continue()
    } else {
      request.abort("blockedbyclient")
    }
  })

  await page.setContent(html, { waitUntil: "domcontentloaded" })

  const scaleCss = buildFigureScaleCss(scales)
  if (scaleCss) await page.addStyleTag({ content: scaleCss })

  await page.evaluate("window.PagedConfig = { auto: false }")
  await page.addScriptTag({ content: pagedJsScript })
  await page.evaluate("window.PagedPolyfill.preview()")

  return page
}

async function findFigureScaleAdjustments(
  page: Page,
  currentScales: FigureScales,
): Promise<FigureScales> {
  return page.evaluate(
    ({ minimumScale, scales }) => {
      const adjustments: FigureScales = {}
      const pages = Array.from(document.querySelectorAll<HTMLElement>(".pagedjs_page"))
      const blockSelector =
        "h1, h2, h3, h4, h5, h6, p, li, pre, table, blockquote, figure, hr"

      for (let pageIndex = 1; pageIndex < pages.length; pageIndex += 1) {
        const currentPage = pages[pageIndex]
        const previousPage = pages[pageIndex - 1]
        if (previousPage.querySelector(".pdf-navigation")) continue

        const currentContent =
          currentPage.querySelector<HTMLElement>(".pagedjs_page_content")
        const previousContent =
          previousPage.querySelector<HTMLElement>(".pagedjs_page_content")
        if (!currentContent || !previousContent) continue

        const currentBlocks = Array.from(
          currentContent.querySelectorAll<HTMLElement>(blockSelector),
        ).filter((element) => element.getBoundingClientRect().height > 0)
        const firstBlockTop = Math.min(
          ...currentBlocks.map((element) => element.getBoundingClientRect().top),
        )

        const figure = currentBlocks.find(
          (element) =>
            element.matches(".pdf-figure[data-figure-id]") &&
            element.getBoundingClientRect().top <= firstBlockTop + 2,
        )
        if (!figure) continue

        const figureId = figure.dataset.figureId
        if (!figureId) continue

        const previousBlocks = Array.from(
          previousContent.querySelectorAll<HTMLElement>(blockSelector),
        ).filter((element) => element.getBoundingClientRect().height > 0)
        const previousContentRect = previousContent.getBoundingClientRect()
        const lastContentBottom =
          previousBlocks.length > 0
            ? Math.max(
                ...previousBlocks.map(
                  (element) => element.getBoundingClientRect().bottom,
                ),
              )
            : previousContentRect.top
        const remainingHeight = previousContentRect.bottom - lastContentBottom - 4
        const figureHeight = figure.getBoundingClientRect().height
        const currentScale = scales[figureId] ?? 1
        if (remainingHeight <= 0 || figureHeight <= 0) continue

        const requiredScale = Math.min(
          1,
          (remainingHeight / figureHeight) * currentScale * 0.98,
        )
        if (
          requiredScale >= minimumScale &&
          requiredScale < currentScale - 0.01
        ) {
          adjustments[figureId] = requiredScale
        }
      }

      return adjustments
    },
    { minimumScale: MIN_FIGURE_SCALE, scales: currentScales },
  )
}

export async function pagedHtmlToPdf(html: string): Promise<Uint8Array> {
  const chromium = await import("@sparticuz/chromium")
  const puppeteer = await import("puppeteer-core")
  const pagedJsScript = loadPagedJsScript()

  const browser = await puppeteer.default.launch({
    args: [...chromium.default.args, "--disable-dev-shm-usage"],
    executablePath: await chromium.default.executablePath(),
    headless: true,
  })

  let page: Page | null = null
  const scales: FigureScales = {}

  try {
    for (let pass = 0; pass < MAX_PAGINATION_PASSES; pass += 1) {
      if (page) await page.close()
      page = await createPaginatedPage(browser, html, pagedJsScript, scales)

      if (pass === MAX_PAGINATION_PASSES - 1) break

      const adjustments = await findFigureScaleAdjustments(page, scales)
      if (Object.keys(adjustments).length === 0) break
      Object.assign(scales, adjustments)
    }

    if (!page) throw new Error("pdf_page_unavailable")

    await page.setJavaScriptEnabled(false)
    return await page.pdf({
      format: "A4",
      preferCSSPageSize: true,
      printBackground: true,
      tagged: true,
    })
  } finally {
    await browser.close()
  }
}

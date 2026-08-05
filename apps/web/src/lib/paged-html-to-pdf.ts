import fs from "node:fs"
import path from "node:path"

import type { Browser, Page } from "puppeteer-core"

const MAX_PAGINATION_PASSES = 3
const MIN_FIGURE_SCALE = 0.8
const PDF_EXPORT_TIMEOUT_MS = 45_000

type FigureScales = Record<string, number>

export class PdfExportTimeoutError extends Error {
  constructor() {
    super("pdf_export_timeout")
    this.name = "PdfExportTimeoutError"
  }
}

function getAbortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  return new Error("pdf_export_aborted")
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(getAbortReason(signal))

  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(getAbortReason(signal))
    signal.addEventListener("abort", abort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      },
    )
  })
}

function loadPagedJsScript(): string {
  return fs.readFileSync(
    path.resolve(
      process.cwd(),
      "node_modules/pagedjs/dist/paged.polyfill.min.js",
    ),
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
  signal: AbortSignal,
): Promise<Page> {
  const page = await withAbort(browser.newPage(), signal)
  page.setDefaultTimeout(45_000)
  try {
    await withAbort(page.setJavaScriptEnabled(true), signal)
    await withAbort(page.setRequestInterception(true), signal)
    page.on("request", (request) => {
      if (request.url().startsWith("data:")) {
        request.continue()
      } else {
        request.abort("blockedbyclient")
      }
    })

    await withAbort(page.setContent(html, { waitUntil: "domcontentloaded" }), signal)

    const scaleCss = buildFigureScaleCss(scales)
    if (scaleCss) await withAbort(page.addStyleTag({ content: scaleCss }), signal)

    await withAbort(page.evaluate("window.PagedConfig = { auto: false }"), signal)
    await withAbort(page.addScriptTag({ content: pagedJsScript }), signal)
    await withAbort(page.evaluate("window.PagedPolyfill.preview()"), signal)

    return page
  } catch (error) {
    await Promise.resolve(page.close()).catch(() => undefined)
    throw error
  }
}

async function findFigureScaleAdjustments(
  page: Page,
  currentScales: FigureScales,
  signal: AbortSignal,
): Promise<FigureScales> {
  return withAbort(page.evaluate(
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
  ), signal)
}

export async function pagedHtmlToPdf(
  html: string,
  requestSignal?: AbortSignal,
): Promise<Uint8Array> {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(new PdfExportTimeoutError()),
    PDF_EXPORT_TIMEOUT_MS,
  )
  const abort = () => controller.abort(requestSignal?.reason)
  requestSignal?.addEventListener("abort", abort, { once: true })

  let browser: Browser | null = null
  let page: Page | null = null
  const scales: FigureScales = {}

  try {
    if (requestSignal?.aborted) abort()

    const chromium = await withAbort(import("@sparticuz/chromium"), controller.signal)
    const puppeteer = await withAbort(import("puppeteer-core"), controller.signal)
    const pagedJsScript = loadPagedJsScript()
    const executablePath = await withAbort(
      chromium.default.executablePath(),
      controller.signal,
    )
    browser = await withAbort(
      puppeteer.default.launch({
        args: [...chromium.default.args, "--disable-dev-shm-usage"],
        executablePath,
        headless: true,
      }),
      controller.signal,
    )

    for (let pass = 0; pass < MAX_PAGINATION_PASSES; pass += 1) {
      if (page) {
        await Promise.resolve(page.close()).catch(() => undefined)
        page = null
      }
      page = await createPaginatedPage(
        browser,
        html,
        pagedJsScript,
        scales,
        controller.signal,
      )

      if (pass === MAX_PAGINATION_PASSES - 1) break

      const adjustments = await findFigureScaleAdjustments(
        page,
        scales,
        controller.signal,
      )
      if (Object.keys(adjustments).length === 0) break
      Object.assign(scales, adjustments)
    }

    if (!page) throw new Error("pdf_page_unavailable")

    await withAbort(page.setJavaScriptEnabled(false), controller.signal)
    return await withAbort(
      page.pdf({
        format: "A4",
        preferCSSPageSize: true,
        printBackground: true,
        tagged: true,
      }),
      controller.signal,
    )
  } finally {
    clearTimeout(timeout)
    requestSignal?.removeEventListener("abort", abort)
    if (page) await Promise.resolve(page.close()).catch(() => undefined)
    if (browser) await Promise.resolve(browser.close()).catch(() => undefined)
  }
}

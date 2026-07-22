import { NextRequest } from "next/server"

import { withAuth } from "@/lib/runtime/with-auth"
import { markdownToPdfHtml } from "@/lib/markdown-to-pdf-html"
import {
  isValidWorkspacePath,
  jsonResponse,
  readWorkspaceFile,
} from "@/lib/workspace-file-response"
import { normalizeWorkspacePath } from "@/lib/workspace-paths"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

const MAX_MARKDOWN_BYTES = 512 * 1024
const MAX_CONCURRENT_EXPORTS = 2

let activeExports = 0

async function generatePdf(html: string): Promise<Uint8Array> {
  const chromium = await import("@sparticuz/chromium")
  const puppeteer = await import("puppeteer-core")

  const browser = await puppeteer.default.launch({
    args: [...chromium.default.args, "--disable-dev-shm-usage"],
    executablePath: await chromium.default.executablePath(),
    headless: true,
  })

  try {
    const page = await browser.newPage()
    await page.setJavaScriptEnabled(false)
    await page.setRequestInterception(true)
    page.on("request", (req) => {
      if (req.url().startsWith("data:")) {
        req.continue()
      } else {
        req.abort("blockedbyclient")
      }
    })

    await page.setContent(html, { waitUntil: "domcontentloaded" })

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "1cm", right: "1.5cm", bottom: "1cm", left: "1.5cm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `
        <div style="font-size:9px; width:100%; text-align:center; color:#999;">
          <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>`,
    })

    return pdf
  } finally {
    await browser.close()
  }
}

export const POST = withAuth<{ error: string }>(
  { csrf: false },
  async (request: NextRequest, { slug }) => {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonResponse(400, { error: "invalid_body" })
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return jsonResponse(400, { error: "invalid_body" })
    }

    const pathValue = (body as Record<string, unknown>).path
    if (typeof pathValue !== "string") {
      return jsonResponse(400, { error: "invalid_path" })
    }

    const normalizedPath = normalizeWorkspacePath(pathValue)
    if (!isValidWorkspacePath(normalizedPath, { extension: ".md" })) {
      return jsonResponse(400, { error: "invalid_path" })
    }

    if (activeExports >= MAX_CONCURRENT_EXPORTS) {
      return jsonResponse(503, { error: "export_busy" })
    }

    activeExports++
    try {
      const result = await readWorkspaceFile(slug, normalizedPath)
      if (!result.ok) return result.response

      let content = result.data.content
      if (typeof content !== "string") {
        return jsonResponse(502, { error: "invalid_file_content" })
      }

      if (result.data.encoding === "base64") {
        try {
          content = Buffer.from(content, "base64").toString("utf-8")
        } catch {
          return jsonResponse(502, { error: "invalid_file_content" })
        }
      }

      if (Buffer.byteLength(content, "utf-8") > MAX_MARKDOWN_BYTES) {
        return jsonResponse(413, { error: "file_too_large" })
      }

      const html = await markdownToPdfHtml(content)
      const pdf = await generatePdf(html)

      return new Response(pdf, {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/pdf",
        },
      })
    } catch {
      return jsonResponse(500, { error: "export_failed" })
    } finally {
      activeExports--
    }
  },
)

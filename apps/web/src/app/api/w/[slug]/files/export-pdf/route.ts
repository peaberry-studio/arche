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

async function generatePdf(html: string): Promise<Uint8Array> {
  const chromium = await import("@sparticuz/chromium")
  const puppeteer = await import("puppeteer-core")

  const browser = await puppeteer.default.launch({
    args: chromium.default.args,
    executablePath: await chromium.default.executablePath(),
    headless: true,
  })

  try {
    const page = await browser.newPage()
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
    let body: { path?: string }
    try {
      body = await request.json()
    } catch {
      return jsonResponse(400, { error: "invalid_body" })
    }

    const normalizedPath = normalizeWorkspacePath(body.path ?? "")
    if (!isValidWorkspacePath(normalizedPath, { extension: ".md" })) {
      return jsonResponse(400, { error: "invalid_path" })
    }

    const result = await readWorkspaceFile(slug, normalizedPath)
    if (!result.ok) return result.response

    const content = result.data.content
    if (typeof content !== "string") {
      return jsonResponse(502, { error: "invalid_file_content" })
    }

    const html = await markdownToPdfHtml(content)
    const pdf = await generatePdf(html)

    return new Response(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/pdf",
      },
    })
  },
)

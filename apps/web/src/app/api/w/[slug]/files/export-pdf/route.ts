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

const MAX_MARKDOWN_BYTES = 4 * 1024 * 1024
const MAX_CONCURRENT_EXPORTS = 2

let activeExports = 0

const LOGO_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAD9ElEQVR4AexVXWwUVRT+7p2ZnfqPSkFs1aJFqoloDA/E+IJpbQ1Gify0lErSihFI6k9QEdtU2LoQ+ihWSlI0Ahaw0QcfrGAM9cFGa9QHReMPP9JS1JCoIHTn93rmrN3Apnd3+mD60s2eM+fe851zv7lz7rlytHGBmkyRmOTfFIGpHZj4DkgJOWcejJp6mCueZTGq6yHK5wHkm2hNxydgmDCqamF3vI/Exp2wljfDrKplsWqbYb+8E5HPqFwOEDYukVgERPGNSLTugkVvLK6bqc0d+az655Bo6YaYPkuLu9hRkICYUcpvLG+5PRMXBgi+6ofXnYSbepLF625H8PWnQBgyRpbN5RhRXMLjfCo/gYQNq3kbxLTpnCM8dRzO5kZ4nRsRDPQhPPodSzDwIbzXX4KTbEQ4coKx4tpijoWV4LFO5SVgVq+ELLmVY8OhX+BufQpq6Gcej6fUyZ8YEw4fZbcsvQ1G9Qq2dUpPgJgbVVRQUaTvwtvRAlw4F43yy/mzhG0FfI9xZlUdYFpsj6fkeJPRnKyYD3HlNZEJ/7M+qN9Osh1HqdMn4A/0MVRcNQ2y4l62x1N6AuV3ZfHh4MdZO64RDn6ShcqLcmUn/zO0BKK3gOcyTA0f4+dElDqVqQO4DtTIr9pQLYHoWDltDXS8+qE8R5tA51Bumo7rYThtKxF8O6CDQUvAXLQKxv0Pw9uVAtIXtAm0jtHz8N7ugFFJ3bKmQQvTEgiP/4CIhN3xHswlayFmlmqT5DpEyWyYdc9Qa6bYymUIjx3JhWTHegJHBqH++RviiqszRLb2IpHcg+gCMu57iC6kuyFuKoe4eQ7k3HtotxbBbFiPRGof7PYemA/WQRRdDnX2T4TfD2YXzDW0BEDfPWq1wZdUzdR+o0BZWp65fFa3Uavtgr15D+xNu5HYsANWUyvMB5ZCziqLoIj6QEBH0X31CYwVc8ZxqdYTIJz6fYibivP8o/B2dyAio86MAEqRN+evQqg/hhF8cQjeWymk1z8Cj+4LdeZ0DvDSYV4CDKX7QC6o4a30e9+As2EZ0msX0nMpnE2r4LzyOJwXH0N6Dc211MH/4E0o14W5cAlQdBmnyKcKE6BzHNJNZy5ezUVV1HUYdvIdWGuSsGqfhkXFZq3bAnvLARR19cNO7eeaCT4/SKdnNN/a7CtMgGDR1rrtTfB6O6HoPhAzSiBn3wl5x/yMlFVAXH8D1Lm/4L3bCTfZxJ+DQgv+YxHgLNQVg769iOrB3baOFtoO/9A+Fu/AdkRzzguLEXy0lwow00E5roCKT2AsURAg/PEbWqgH/v7XWIKDPTwH8o3B4j4nTiBu5pi4KQKTvwNCCP//lEK5/wUAAP//3w0LtQAAAAZJREFUAwApJNYQnskXGwAAAABJRU5ErkJggg=="

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
      margin: { top: "1.8cm", right: "1.5cm", bottom: "1cm", left: "1.5cm" },
      displayHeaderFooter: true,
      headerTemplate: `
        <div style="width:100%; text-align:center; padding-top:4px;">
          <img src="data:image/png;base64,${LOGO_BASE64}" style="height:16px; width:16px; opacity:0.4;" />
        </div>`,
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

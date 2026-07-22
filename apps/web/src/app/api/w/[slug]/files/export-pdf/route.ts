import { NextRequest } from "next/server"

import { withAuth } from "@/lib/runtime/with-auth"
import { markdownToPdfHtml } from "@/lib/markdown-to-pdf-html"
import { workspaceAgentFetch } from "@/lib/workspace-agent-client"
import { createWorkspaceAgentClient } from "@/lib/workspace-agent/client"
import { sanitizeAttachmentFilename } from "@/lib/workspace-attachments"
import { isHiddenWorkspacePath, normalizeWorkspacePath } from "@/lib/workspace-paths"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

type WorkspaceAgentReadResponse = {
  ok: boolean
  content?: string
  encoding?: "utf-8" | "base64"
  error?: string
}

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function isValidExportPath(path: string): boolean {
  if (!path) return false
  if (isHiddenWorkspacePath(path)) return false
  if (!path.endsWith(".md")) return false
  return path.split("/").every((segment) => segment !== "..")
}

function buildContentDisposition(filename: string): string {
  const safeName = sanitizeAttachmentFilename(filename)
  return `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

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
    if (!isValidExportPath(normalizedPath)) {
      return jsonResponse(400, { error: "invalid_path" })
    }

    const agent = await createWorkspaceAgentClient(slug)
    if (!agent) {
      return jsonResponse(503, { error: "instance_unavailable" })
    }

    const response = await workspaceAgentFetch<WorkspaceAgentReadResponse>(agent, "/files/read", {
      path: normalizedPath,
    })

    if (!response.ok) {
      return jsonResponse(response.status === 404 ? 404 : 502, { error: response.error })
    }

    const content = response.data.content
    if (typeof content !== "string") {
      return jsonResponse(502, { error: "invalid_file_content" })
    }

    const html = await markdownToPdfHtml(content)
    const pdf = await generatePdf(html)

    const basename = (normalizedPath.split("/").pop() ?? "export").replace(/\.md$/, "")
    const pdfFilename = `${basename}.pdf`

    return new Response(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": buildContentDisposition(pdfFilename),
        "Content-Type": "application/pdf",
      },
    })
  },
)

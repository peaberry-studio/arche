import { NextRequest } from "next/server"

import { markdownToPdfHtml } from "@/lib/markdown-to-pdf-html"
import {
  pagedHtmlToPdf,
  PdfExportTimeoutError,
} from "@/lib/paged-html-to-pdf"
import { withAuth } from "@/lib/runtime/with-auth"
import { createWorkspaceAgentClient } from "@/lib/workspace-agent/client"
import {
  gatherWorkspaceDocumentBundle,
  parseWorkspaceDocumentPath,
} from "@/lib/workspace-document-bundle"
import { jsonResponse } from "@/lib/workspace-file-response"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const MAX_CONCURRENT_EXPORTS = 2
const PDF_EXPORT_TIMEOUT_MS = 45_000

let activeExports = 0

const LOGO_BASE64 = "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNTIiIGhlaWdodD0iMTUwIiB2aWV3Qm94PSIwIDAgMTUyIDE1MCIgZmlsbD0iI2MyNTMzZCI+PHBhdGggZD0iTTc1LjQ5MzUgMEM5NC41ODM1IDAgMTEzLjU1MyA3Ljc1IDEyNy40MDMgMjAuNjZDMTQwLjgyMyAzMy4xNjY3IDE0OC42ODcgNDkuMTE2NyAxNTAuOTkzIDY4LjUxQzE1MS4wMyA2OC44MTk2IDE1MC45ODMgNjkuMTMzMSAxNTAuODU4IDY5LjQxNzlDMTUwLjczNCA2OS43MDI3IDE1MC41MzUgNjkuOTQ4NiAxNTAuMjgzIDcwLjEzQzE0NC4wODMgNzQuNjc2NyAxMzcuNTIgNzguNiAxMzAuNTkzIDgxLjlDMTMwLjUxMSA4MS45Mzg3IDEzMC40MiA4MS45NTUyIDEzMC4zMyA4MS45NDc4QzEzMC4yMzkgODEuOTQwNCAxMzAuMTUyIDgxLjkwOTMgMTMwLjA3NyA4MS44NTc3QzEzMC4wMDIgODEuODA2MSAxMjkuOTQyIDgxLjczNTcgMTI5LjkwMyA4MS42NTM3QzEyOS44NjQgODEuNTcxNiAxMjkuODQ3IDgxLjQ4MDcgMTI5Ljg1MyA4MS4zOUMxMzAuNDQgNzMuODEgMTI5LjcyIDY2LjgyMzMgMTI3LjY5MyA2MC40M0MxMjAuNTQzIDM3LjkxIDk5LjgwMzUgMjEuNjcgNzUuNDkzNSAyMS42N0M1MS4xOTM1IDIxLjY4IDMwLjQ2MzUgMzcuOTMgMjMuMzIzNSA2MC40NkMyMS4yOTY4IDY2Ljg0NjcgMjAuNTc2OCA3My44MyAyMS4xNjM1IDgxLjQxQzIxLjE3MDQgODEuNTAwNyAyMS4xNTM0IDgxLjU5MTYgMjEuMTE0MiA4MS42NzM3QzIxLjA3NSA4MS43NTU3IDIxLjAxNSA4MS44MjYxIDIwLjk0MDEgODEuODc3N0MyMC44NjUyIDgxLjkyOTMgMjAuNzc4MSA4MS45NjA0IDIwLjY4NzQgODEuOTY3OEMyMC41OTY4IDgxLjk3NTIgMjAuNTA1OCA4MS45NTg3IDIwLjQyMzUgODEuOTJDMTMuNDk2OCA3OC42MjY3IDYuOTMzNDggNzQuNzA2NyAwLjczMzQ3OSA3MC4xNkMwLjQ4MTg4NCA2OS45Nzg2IDAuMjgzNDAyIDY5LjczMjcgMC4xNTg1NzQgNjkuNDQ3OUMwLjAzMzc0NDYgNjkuMTYzMS0wLjAxMjg5NTIgNjguODQ5NiAwLjAyMzQ3OTggNjguNTRDMi4zMTY4MSA0OS4xNDY3IDEwLjE3MDEgMzMuMTk2NyAyMy41ODM1IDIwLjY5QzM3LjQzMzUgNy43NyA1Ni40MDM1IDAgNzUuNDkzNSAwWiIvPjxwYXRoIGQ9Ik03NS42NjM0IDEyMi45OUM2MS40MjM0IDEyMy4wMiA0Ny4wNDM0IDEyMC45NCAzMy42MDM0IDExNy4yMkMyNC4zMDM0IDExNC42NSAxNS4wMjM0IDExMS4xNCA3LjIxMzQzIDEwNS42N0M2Ljg4NTY5IDEwNS40NCA2LjYyMzc3IDEwNS4xMyA2LjQ1MzQzIDEwNC43N0MzLjAzMzQzIDk3LjM5NjcgMC44ODM0MzMgODkuNjQwMSAwLjAwMzQzMjQ4IDgxLjUwMDFDLTAuMDA2ODExODMgODEuNDIxNCAwLjAwNTk5MDM4IDgxLjM0MTQgMC4wNDAyODYzIDgxLjI2OTlDMC4wNzQ1ODIyIDgxLjE5ODMgMC4xMjg5MDEgODEuMTM4MyAwLjE5NjY1MSA4MS4wOTdDMC4yNjQ0MDEgODEuMDU1NyAwLjM0MjY3MyA4MS4wMzUgMC40MjE5NzcgODEuMDM3M0MwLjUwMTI4MSA4MS4wMzk2IDAuNTc4MjA4IDgxLjA2NDkgMC42NDM0MzIgODEuMTEwMUMxOC40MTY4IDkyLjk4MzQgMzcuOTcwMSAxMDAuNDUgNTkuMzAzNCAxMDMuNTFDNjMuOTEwMSAxMDQuMTcgNjkuMzQ2OCAxMDQuNDkgNzUuNjEzNCAxMDQuNDdDODEuODgwMSAxMDQuNDU3IDg3LjMxMzQgMTA0LjEwNyA5MS45MTM0IDEwMy40MkMxMTMuMjMzIDEwMC4yNTMgMTMyLjc0NyA5Mi42ODY3IDE1MC40NTMgODAuNzIwMUMxNTAuNTE4IDgwLjY3MjYgMTUwLjU5NSA4MC42NDUgMTUwLjY3NSA4MC42NDA4QzE1MC43NTUgODAuNjM2NiAxNTAuODM0IDgwLjY1NTkgMTUwLjkwMyA4MC42OTYzQzE1MC45NzMgODAuNzM2NyAxNTEuMDI4IDgwLjc5NjUgMTUxLjA2NCA4MC44NjgyQzE1MS4wOTkgODAuOTQgMTUxLjExMyA4MS4wMjA2IDE1MS4xMDMgODEuMTAwMUMxNTAuMjYzIDg5LjI0NjcgMTQ4LjE1MyA5Ny4wMTY3IDE0NC43NzMgMTA0LjQxQzE0NC42MDMgMTA0Ljc3IDE0NC4zNDEgMTA1LjA4IDE0NC4wMTMgMTA1LjMxQzEzNi4yMzMgMTEwLjgyIDEyNi45NzMgMTE0LjM4IDExNy42OTMgMTE3QzEwNC4yNjMgMTIwLjc5IDg5Ljg5MzQgMTIyLjk1IDc1LjY2MzQgMTIyLjk5WiIvPjxwYXRoIGQ9Ik03NS44MTM1IDE0OS4zQzUzLjgwMzUgMTQ5LjM4IDM0LjEwMzUgMTQwLjQ4IDE5LjE5MzUgMTI0LjQ4QzE5LjEyOTkgMTI0LjQwNyAxOS4wOTEgMTI0LjMxNSAxOS4wODI2IDEyNC4yMTlDMTkuMDc0MSAxMjQuMTIyIDE5LjA5NjQgMTI0LjAyNSAxOS4xNDY0IDEyMy45NDJDMTkuMTk2MyAxMjMuODU5IDE5LjI3MTMgMTIzLjc5MyAxOS4zNjA2IDEyMy43NTVDMTkuNDQ5OSAxMjMuNzE3IDE5LjU0ODkgMTIzLjcwOCAxOS42NDM1IDEyMy43M0MzNC40NTAyIDEyNy43MTcgNDkuMDgzNSAxMzAuMDkgNjMuNTQzNSAxMzAuODVDNzAuODIzNSAxMzEuMjM3IDc0Ljg5MzUgMTMxLjQzIDc1Ljc1MzUgMTMxLjQzQzc2LjYxMzUgMTMxLjQyMyA4MC42ODAyIDEzMS4yIDg3Ljk1MzUgMTMwLjc2QzEwMi40MDcgMTI5Ljg4NyAxMTcuMDIgMTI3LjQwMyAxMzEuNzkzIDEyMy4zMUMxMzEuODg5IDEyMy4yODUgMTMxLjk5IDEyMy4yOTIgMTMyLjA4MSAxMjMuMzI5QzEzMi4xNzIgMTIzLjM2NiAxMzIuMjQ5IDEyMy40MzEgMTMyLjMwMSAxMjMuNTE1QzEzMi4zNTMgMTIzLjU5OSAxMzIuMzc2IDEyMy42OTcgMTMyLjM2NyAxMjMuNzk1QzEzMi4zNTkgMTIzLjg5MyAxMzIuMzE5IDEyMy45ODYgMTMyLjI1MyAxMjQuMDZDMTE3LjQ1MyAxNDAuMTcgOTcuODMzNSAxNDkuMjIgNzUuODEzNSAxNDkuM1oiLz48L3N2Zz4="

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

export const POST = withAuth<{ error: string }>(
  { csrf: false },
  async (request: NextRequest, { slug }) => {
    const pathResult = await parseWorkspaceDocumentPath(request)
    if (!pathResult.ok) return pathResult.response
    const normalizedPath = pathResult.path

    if (activeExports >= MAX_CONCURRENT_EXPORTS) {
      return jsonResponse(503, { error: "export_busy" })
    }

    activeExports++
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(new PdfExportTimeoutError()),
      PDF_EXPORT_TIMEOUT_MS,
    )
    const abort = () => controller.abort(request.signal.reason)
    request.signal.addEventListener("abort", abort, { once: true })
    try {
      const agent = await withAbort(
        createWorkspaceAgentClient(slug),
        controller.signal,
      )
      if (!agent) {
        return jsonResponse(503, { error: "instance_unavailable" })
      }

      if (controller.signal.aborted) throw getAbortReason(controller.signal)

      const bundleResult = await gatherWorkspaceDocumentBundle(
        agent,
        normalizedPath,
        controller.signal,
      )
      if (!bundleResult.ok) return bundleResult.response

      const html = await markdownToPdfHtml(
        bundleResult.bundle,
        { logoBase64: LOGO_BASE64, signal: controller.signal },
      )
      const pdf = await pagedHtmlToPdf(html, controller.signal)

      return new Response(Buffer.from(pdf), {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/pdf",
        },
      })
    } catch (error) {
      console.error(`[pdf-export] Failed to export ${normalizedPath}`, error)
      if (error instanceof PdfExportTimeoutError) {
        return jsonResponse(504, { error: "export_timeout" })
      }
      return jsonResponse(500, { error: "export_failed" })
    } finally {
      clearTimeout(timeout)
      request.signal.removeEventListener("abort", abort)
      activeExports--
    }
  },
)

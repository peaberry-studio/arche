import { NextRequest } from "next/server"

import { markdownToDocx } from "@/lib/markdown-to-docx"
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

const MAX_CONCURRENT_EXPORTS = 4
const DOCX_EXPORT_TIMEOUT_MS = 45_000

let activeExports = 0

export class DocxExportTimeoutError extends Error {
  constructor() {
    super("docx_export_timeout")
  }
}

function getAbortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  return new Error("docx_export_aborted")
}

export const POST = withAuth<{ error: string }>(
  { csrf: false },
  async (request: NextRequest, { slug }) => {
    const pathResult = await parseWorkspaceDocumentPath(request)
    if (!pathResult.ok) return pathResult.response

    if (activeExports >= MAX_CONCURRENT_EXPORTS) {
      return jsonResponse(503, { error: "export_busy" })
    }

    activeExports++
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(new DocxExportTimeoutError()),
      DOCX_EXPORT_TIMEOUT_MS,
    )
    const abort = () => controller.abort(request.signal.reason)
    request.signal.addEventListener("abort", abort, { once: true })

    let conversionSettled: Promise<void> | undefined
    try {
      const agent = await createWorkspaceAgentClient(slug)
      if (!agent) return jsonResponse(503, { error: "instance_unavailable" })

      if (controller.signal.aborted) throw getAbortReason(controller.signal)

      const bundleResult = await gatherWorkspaceDocumentBundle(
        agent,
        pathResult.path,
        controller.signal,
      )
      if (!bundleResult.ok) return bundleResult.response

      const conversionPromise = markdownToDocx(bundleResult.bundle, controller.signal)
      conversionSettled = conversionPromise.then(() => {}, () => {})

      const docx = await conversionPromise
      return new Response(new Uint8Array(docx), {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      })
    } catch (error) {
      if (error instanceof DocxExportTimeoutError) {
        return jsonResponse(504, { error: "export_timeout" })
      }
      return jsonResponse(500, { error: "export_failed" })
    } finally {
      clearTimeout(timeout)
      request.signal.removeEventListener("abort", abort)
      if (conversionSettled) await conversionSettled
      activeExports--
    }
  },
)

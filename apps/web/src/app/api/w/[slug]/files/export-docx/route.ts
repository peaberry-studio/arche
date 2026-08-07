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

let activeExports = 0

export const POST = withAuth<{ error: string }>(
  { csrf: false },
  async (request: NextRequest, { slug }) => {
    const pathResult = await parseWorkspaceDocumentPath(request)
    if (!pathResult.ok) return pathResult.response

    if (activeExports >= MAX_CONCURRENT_EXPORTS) {
      return jsonResponse(503, { error: "export_busy" })
    }

    activeExports++
    try {
      const agent = await createWorkspaceAgentClient(slug)
      if (!agent) return jsonResponse(503, { error: "instance_unavailable" })

      const bundleResult = await gatherWorkspaceDocumentBundle(agent, pathResult.path)
      if (!bundleResult.ok) return bundleResult.response

      const docx = await markdownToDocx(bundleResult.bundle)
      return new Response(new Uint8Array(docx), {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      })
    } catch {
      return jsonResponse(500, { error: "export_failed" })
    } finally {
      activeExports--
    }
  },
)

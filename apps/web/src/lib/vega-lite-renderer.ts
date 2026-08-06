export function getVegaLiteTitle(
  spec: Record<string, unknown>,
  fallback: string,
): string {
  const title = spec.title
  if (typeof title === "string" && title.trim()) return title.trim()
  if (!title || typeof title !== "object" || Array.isArray(title)) return fallback

  const text = (title as Record<string, unknown>).text
  if (typeof text === "string" && text.trim()) return text.trim()
  if (Array.isArray(text)) {
    const lines = text.filter((line): line is string => typeof line === "string")
    if (lines.length > 0) return lines.join(" ")
  }

  return fallback
}

export async function renderVegaLiteToSvg(
  spec: Record<string, unknown>,
): Promise<string> {
  if (!isVegaLiteSpec(spec)) throw new Error("invalid_vega_lite_spec")

  const vega = await import("vega")
  const vegaLite = await import("vega-lite")
  const compiled = vegaLite.compile(spec)
  const view = new vega.View(vega.parse(compiled.spec), { renderer: "none" })

  try {
    return await view.toSVG()
  } finally {
    view.finalize()
  }
}
import type { TopLevelSpec } from "vega-lite"

function isVegaLiteSpec(
  spec: Record<string, unknown>,
): spec is Record<string, unknown> & TopLevelSpec {
  return spec.mark !== undefined || Array.isArray(spec.layer)
}

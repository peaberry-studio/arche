import { beforeEach, describe, expect, it, vi } from "vitest"

import { createWorkspaceDataReader, renderVegaLiteToSvgInWorker } from "@/lib/vega-render-worker"
import { sanitizeVegaLiteSpec } from "@/lib/vega/sanitize-spec"
import { readWorkspaceFile } from "@/lib/workspace-file-response"

vi.mock("@/lib/workspace-file-response", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/workspace-file-response")>()
  return { ...actual, readWorkspaceFile: vi.fn() }
})

const readWorkspaceFileMock = vi.mocked(readWorkspaceFile)

const encoding = {
  x: { field: "x", type: "quantitative" },
  y: { field: "x", type: "quantitative" },
}

/** Builds the canonical model the worker consumes, exercising the real collection walk. */
function chartOf(spec: Record<string, unknown>) {
  const chart = sanitizeVegaLiteSpec(spec)
  if (!chart) throw new Error("expected spec to be accepted")
  return chart
}

describe("sanitizeVegaLiteSpec collects the fetch sites the worker needs", () => {
  it("finds data.url anywhere a spec can declare data", () => {
    const chart = sanitizeVegaLiteSpec({
      data: { url: "a.csv" },
      layer: [{ data: { url: "b.json" }, mark: "line" }],
      transform: [{ lookup: "k", from: { data: { url: "c.csv" }, key: "k" } }],
    })

    expect([...(chart?.dataUrls ?? [])].sort()).toEqual(["a.csv", "b.json", "c.csv"])
  })

  it("does not collect url columns inside opaque data rows", () => {
    // An `image` mark bound to a `url` field: Vega fetches these as images at render
    // time, not as data files, and the rows are user data the sanitizer must not read.
    const chart = sanitizeVegaLiteSpec({
      data: { values: [{ name: "a", url: "thumbs/a.png" }] },
      mark: "image",
      encoding: { url: { field: "url" } },
    })

    expect(chart?.dataUrls).toEqual([])
  })

  it("does not collect image mark literals or inline data URIs", () => {
    expect(sanitizeVegaLiteSpec({
      data: { values: [{ x: 1 }] },
      mark: { type: "image", url: "logo.png" },
    })?.dataUrls).toEqual([])

    expect(sanitizeVegaLiteSpec({
      data: { url: "data:image/png;base64,AA" },
      mark: "bar",
    })?.dataUrls).toEqual([])
  })
})

describe("createWorkspaceDataReader", () => {
  beforeEach(() => {
    readWorkspaceFileMock.mockReset()
  })

  it("passes utf-8 content through", async () => {
    readWorkspaceFileMock.mockResolvedValue({
      ok: true,
      data: { ok: true, content: "quarter,revenue\nQ1,10\n", encoding: "utf-8" },
    })

    const read = createWorkspaceDataReader("my-space")

    await expect(read("data/rev.csv")).resolves.toBe("quarter,revenue\nQ1,10\n")
    expect(readWorkspaceFileMock).toHaveBeenCalledWith("my-space", "data/rev.csv")
  })

  it("decodes base64 exactly as the browser's download route does", async () => {
    readWorkspaceFileMock.mockResolvedValue({
      ok: true,
      data: { ok: true, content: Buffer.from("a,b\n1,2\n").toString("base64"), encoding: "base64" },
    })

    await expect(createWorkspaceDataReader("s")("d.csv")).resolves.toBe("a,b\n1,2\n")
  })

  it("refuses invalid paths without attempting a read", async () => {
    await expect(createWorkspaceDataReader("s")("../secrets.env")).resolves.toBeNull()
    expect(readWorkspaceFileMock).not.toHaveBeenCalled()
  })

  it("returns null when the file cannot be read", async () => {
    readWorkspaceFileMock.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 404 }),
    })

    await expect(createWorkspaceDataReader("s")("missing.csv")).resolves.toBeNull()
  })

  it("returns null for an unusable payload", async () => {
    readWorkspaceFileMock.mockResolvedValue({ ok: true, data: { ok: true } })

    await expect(createWorkspaceDataReader("s")("d.csv")).resolves.toBeNull()
  })

  it("throws on a file past the chart data budget", async () => {
    readWorkspaceFileMock.mockResolvedValue({
      ok: true,
      data: { ok: true, content: "x".repeat(8 * 1024 * 1024 + 1), encoding: "utf-8" },
    })

    await expect(createWorkspaceDataReader("s")("big.csv")).rejects.toThrow(/exceeds the 8 MB limit/)
  })
})

describe("renderVegaLiteToSvgInWorker", () => {
  it("renders a chart with real content", async () => {
    const svg = await renderVegaLiteToSvgInWorker({
      chart: chartOf({
        data: { values: [{ x: 1 }, { x: 2 }] },
        mark: "bar",
        encoding: { x: { field: "x", type: "ordinal" }, y: { field: "x", type: "quantitative" } },
      }),
      config: {},
      timeoutMs: 20_000,
    })

    expect(svg).toContain("<svg")
    expect(svg).toMatch(/<(path|rect)/)
  })

  it("terminates a spec whose synchronous render blows the budget", async () => {
    // A wide repeat product: only a few hundred rows, so no row budget can see it, and
    // the work is entirely synchronous. A timer alone could never interrupt this.
    const fields = Array.from({ length: 40 }, (_, i) => `f${i}`)
    const values = Array.from({ length: 400 }, () =>
      Object.fromEntries(fields.map((f) => [f, Math.random()])),
    )

    const started = Date.now()
    await expect(
      renderVegaLiteToSvgInWorker({
        chart: chartOf({
          data: { values },
          repeat: { row: fields, column: fields },
          spec: {
            mark: "point",
            encoding: {
              x: { field: { repeat: "column" }, type: "quantitative" },
              y: { field: { repeat: "row" }, type: "quantitative" },
            },
          },
        }),
        config: {},
        timeoutMs: 1_500,
      }),
    ).rejects.toThrow(/exceeded 2s and was cancelled|exceeded 1s and was cancelled/)

    // The point of the worker: the cancellation actually happens near the deadline.
    expect(Date.now() - started).toBeLessThan(6_000)
  }, 30_000)

  it("serves referenced workspace files from the reader", async () => {
    const svg = await renderVegaLiteToSvgInWorker({
      chart: chartOf({
        data: { url: "data/rev.csv", format: { type: "csv" } },
        mark: "bar",
        encoding: {
          x: { field: "quarter", type: "nominal" },
          y: { field: "revenue", type: "quantitative" },
        },
      }),
      config: {},
      timeoutMs: 20_000,
      readWorkspaceData: async () => "quarter,revenue\nQ1,10\nQ2,20\n",
    })

    expect(svg).toContain("Q1")
  })

  it("refuses a data url that escapes the workspace", async () => {
    await expect(
      renderVegaLiteToSvgInWorker({
        chart: chartOf({ data: { url: "../../etc/passwd" }, mark: "bar", encoding }),
        config: {},
        timeoutMs: 20_000,
        readWorkspaceData: async () => "x\n1\n",
      }),
    ).rejects.toThrow(/escapes the workspace/)
  })

  it("refuses workspace data when no reader is available", async () => {
    await expect(
      renderVegaLiteToSvgInWorker({
        chart: chartOf({ data: { url: "data/rev.csv" }, mark: "bar", encoding }),
        config: {},
        timeoutMs: 20_000,
      }),
    ).rejects.toThrow(/unavailable in this context/)
  })
})

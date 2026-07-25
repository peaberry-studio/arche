import { describe, expect, it } from "vitest"

import {
  decodeWorkspaceFileContent,
  decodeWorkspaceFileText,
} from "@/lib/workspace-file-response"

describe("decodeWorkspaceFileText", () => {
  it("decodes base64 payloads", () => {
    // The PDF chart-data path and the browser download path must agree here: returning
    // raw base64 to Vega renders in the app and silently drops the chart in export.
    const content = Buffer.from("quarter,revenue\nQ1,10\n", "utf-8").toString("base64")
    expect(decodeWorkspaceFileText({ content, encoding: "base64" })).toBe("quarter,revenue\nQ1,10\n")
  })

  it("passes through utf-8 and an absent encoding", () => {
    expect(decodeWorkspaceFileText({ content: "a,b\n1,2\n", encoding: "utf-8" })).toBe("a,b\n1,2\n")
    expect(decodeWorkspaceFileText({ content: "a,b\n1,2\n" })).toBe("a,b\n1,2\n")
  })

  it("returns null for unusable payloads", () => {
    expect(decodeWorkspaceFileText({})).toBeNull()
    expect(decodeWorkspaceFileText({ content: undefined, encoding: "base64" })).toBeNull()
    expect(decodeWorkspaceFileText({
      content: "x",
      encoding: "latin1" as unknown as "utf-8",
    })).toBeNull()
  })

  it("returns bytes for binary consumers", () => {
    const buffer = decodeWorkspaceFileContent({
      content: Buffer.from([0, 1, 2, 255]).toString("base64"),
      encoding: "base64",
    })
    expect([...(buffer ?? [])]).toEqual([0, 1, 2, 255])
  })
})

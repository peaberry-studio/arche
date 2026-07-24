import { describe, expect, it } from "vitest"

import { isValidWorkspacePath, jsonResponse } from "../workspace-file-response"

describe("workspace-file-response", () => {
  describe("jsonResponse", () => {
    it("returns a JSON response with the given status", async () => {
      const res = jsonResponse(400, { error: "bad" })
      expect(res.status).toBe(400)
      expect(res.headers.get("Content-Type")).toBe("application/json")
      const body = await res.json()
      expect(body).toEqual({ error: "bad" })
    })
  })

  describe("isValidWorkspacePath", () => {
    it("rejects empty paths", () => {
      expect(isValidWorkspacePath("")).toBe(false)
    })

    it("rejects paths with directory traversal", () => {
      expect(isValidWorkspacePath("../secret.md")).toBe(false)
      expect(isValidWorkspacePath("a/../b.md")).toBe(false)
    })

    it("rejects protected paths", () => {
      expect(isValidWorkspacePath(".git/config")).toBe(false)
      expect(isValidWorkspacePath("node_modules/pkg/index.js")).toBe(false)
    })

    it("accepts valid paths", () => {
      expect(isValidWorkspacePath("docs/readme.md")).toBe(true)
    })

    it("filters by extension when provided", () => {
      expect(isValidWorkspacePath("docs/readme.md", { extension: ".md" })).toBe(true)
      expect(isValidWorkspacePath("docs/readme.txt", { extension: ".md" })).toBe(false)
    })

    it("accepts any extension when not specified", () => {
      expect(isValidWorkspacePath("image.png")).toBe(true)
    })
  })
})

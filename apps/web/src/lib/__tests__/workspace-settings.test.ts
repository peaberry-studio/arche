import { describe, expect, it } from "vitest";

import {
  isWorkspaceSettingsSection,
  WORKSPACE_SETTINGS_SECTIONS,
  type WorkspaceSettingsSection,
} from "@/lib/workspace-settings";

describe("workspace settings allowlist", () => {
  it("lists exactly the unified settings sections", () => {
    expect(WORKSPACE_SETTINGS_SECTIONS).toEqual([
      "general",
      "providers",
      "connectors",
      "team",
      "integrations",
      "security",
      "analytics",
    ])
  })

  it("accepts every allowlisted section", () => {
    for (const section of WORKSPACE_SETTINGS_SECTIONS) {
      expect(isWorkspaceSettingsSection(section)).toBe(true)
    }
  })

  it("rejects legacy dashboard/desktop sections", () => {
    expect(isWorkspaceSettingsSection("appearance")).toBe(false)
    expect(isWorkspaceSettingsSection("advanced")).toBe(false)
    expect(isWorkspaceSettingsSection("agents")).toBe(false)
    expect(isWorkspaceSettingsSection("skills")).toBe(false)
    expect(isWorkspaceSettingsSection("flows")).toBe(false)
  })

  it("rejects null and unknown values", () => {
    expect(isWorkspaceSettingsSection(null)).toBe(false)
    expect(isWorkspaceSettingsSection(undefined)).toBe(false)
    expect(isWorkspaceSettingsSection("bogus")).toBe(false)
  })

  it("types the allowlist as settings sections", () => {
    const section: WorkspaceSettingsSection = "general"
    expect(section).toBe("general")
  })
})

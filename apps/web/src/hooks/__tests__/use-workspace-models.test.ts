import { describe, expect, it } from "vitest";

import { filterModelsByProviderStatus } from "@/hooks/use-workspace";
import type { AvailableModel } from "@/lib/opencode/types";

const OPENCODE_MODEL: AvailableModel = {
  providerId: "opencode",
  providerName: "OpenCode",
  modelId: "free-model",
  modelName: "Free model",
  isDefault: true,
};

const OPENAI_MODEL: AvailableModel = {
  providerId: "openai",
  providerName: "OpenAI",
  modelId: "gpt-5.4",
  modelName: "GPT 5.4",
  isDefault: false,
};

describe("filterModelsByProviderStatus", () => {
  it("keeps opencode models even when no provider credentials are enabled", () => {
    const models = filterModelsByProviderStatus([OPENCODE_MODEL], [
      { providerId: "opencode", status: "missing" },
    ]);

    expect(models).toEqual([OPENCODE_MODEL]);
  });

  it("filters credential-backed providers when they are not enabled", () => {
    const models = filterModelsByProviderStatus([OPENAI_MODEL, OPENCODE_MODEL], [
      { providerId: "openai", status: "missing" },
      { providerId: "opencode", status: "missing" },
    ]);

    expect(models).toEqual([OPENCODE_MODEL]);
  });

  it("keeps enabled managed providers alongside opencode", () => {
    const models = filterModelsByProviderStatus([OPENAI_MODEL, OPENCODE_MODEL], [
      { providerId: "openai", status: "enabled" },
      { providerId: "opencode", status: "missing" },
    ]);

    expect(models).toEqual([OPENAI_MODEL, OPENCODE_MODEL]);
  });
});

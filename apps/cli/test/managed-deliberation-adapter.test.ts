import { describe, expect, it } from "vitest";

import {
  managedDeliberationEvidenceBoundaryInstruction,
  managedDeliberationProviderBoundary,
} from "../src/managed-deliberation-adapter.js";

describe("managed deliberation adapter boundary", () => {
  it("binds Codex to an injected-evidence-only instruction", () => {
    expect(managedDeliberationProviderBoundary("codex")).toEqual({
      provider: "codex",
      baseInstructions: managedDeliberationEvidenceBoundaryInstruction,
    });
  });

  it("disables Claude tools at the native adapter boundary", () => {
    expect(managedDeliberationProviderBoundary("claude")).toEqual({
      provider: "claude",
      systemPrompt: managedDeliberationEvidenceBoundaryInstruction,
      tools: [],
    });
  });
});

import { describe, expect, it } from "vitest";

import { readProviderFailureDiagnostic } from "../src/failure-diagnostic.js";

describe("provider failure diagnostic boundary", () => {
  it("accepts only bounded transport coordinates", () => {
    const diagnostic = {
      provider: "codex",
      operation: "session_start",
      failureKind: "server_rejected",
      transportCode: -32000,
    };
    expect(readProviderFailureDiagnostic({ providerFailureDiagnostic: diagnostic })).toEqual(
      diagnostic,
    );
    expect(
      readProviderFailureDiagnostic({
        providerFailureDiagnostic: { ...diagnostic, message: "private provider detail" },
      }),
    ).toBeNull();
    expect(
      readProviderFailureDiagnostic({
        providerFailureDiagnostic: { ...diagnostic, transportCode: "-32000" },
      }),
    ).toBeNull();
    expect(
      readProviderFailureDiagnostic({
        providerFailureDiagnostic: { ...diagnostic, failureKind: "response_timeout" },
      }),
    ).toBeNull();
  });
});

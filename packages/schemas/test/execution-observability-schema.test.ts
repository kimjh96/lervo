import { describe, expect, it } from "vitest";

import { validateSchema } from "../src/validate.js";

describe("execution observability schemas", () => {
  it("binds supported accounting to a null unavailable reason", () => {
    const descriptor = {
      kind: "resource_accounting_descriptor",
      schemaVersion: 2,
      provider: "codex",
      adapterId: "lervo/codex",
      adapterVersion: "1.0.0",
      accountingMode: "turn_cumulative",
      observationSupport: "supported",
      unavailableReason: null,
      normalizationId: "codex_usage_v1",
      nativeCounterSemanticsId: "codex_counter_v1",
      requestedModel: null,
      serviceTier: null,
    };
    expect(validateSchema("resourceAccountingDescriptor", descriptor).valid).toBe(true);
    expect(
      validateSchema("resourceAccountingDescriptor", {
        ...descriptor,
        unavailableReason: "not_available",
      }).valid,
    ).toBe(false);
  });

  it("requires terminal resource observations to remain partial or unavailable", () => {
    const base = {
      schemaVersion: 1,
      reportKind: "unmanaged_terminal_context",
      projectId: "prj_schema_terminal",
      reports: [],
    };
    expect(validateSchema("terminalCoverageReport", base).valid).toBe(true);
  });

  it("validates privacy-safe runtime and benchmark environment profiles", () => {
    const profile = {
      kind: "execution_environment_profile",
      schemaVersion: 1,
      profileSource: "runtime_derived",
      lervoBuildDigest: `sha256:${"a".repeat(64)}`,
      adapterId: "lervo/codex",
      adapterVersion: "1.0.0",
      provider: "codex",
      operatingSystem: "darwin",
      architecture: "arm64",
      nodeVersion: "v22.13.0",
      repositoryProfile: "custom",
      repositoryDocumentCount: null,
      repositoryByteCount: null,
      cacheState: "unknown",
      concurrency: 1,
    };
    expect(validateSchema("executionEnvironmentProfile", profile).valid).toBe(true);
    expect(
      validateSchema("executionEnvironmentProfile", {
        ...profile,
        adapterId: null,
      }).valid,
    ).toBe(false);
  });
});

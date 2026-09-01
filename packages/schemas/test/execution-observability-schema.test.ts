import { describe, expect, it } from "vitest";

import { validateSchema } from "../src/validate.js";

describe("execution observability schemas", () => {
  it("binds supported accounting to a null unavailable reason", () => {
    const descriptor = {
      kind: "resource_accounting_descriptor",
      schemaVersion: 1,
      provider: "codex",
      adapterId: "lervo/codex",
      adapterVersion: "1.0.0",
      accountingMode: "turn_cumulative",
      observationSupport: "supported",
      unavailableReason: null,
      normalizationId: "codex_usage_v1",
      nativeCounterSemanticsId: "codex_counter_v1",
      model: null,
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
});

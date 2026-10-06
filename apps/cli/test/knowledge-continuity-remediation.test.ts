import { describe, expect, it } from "vitest";

import { continuityRemediation } from "../src/knowledge-continuity-remediation.js";

describe("continuity remediation for resident admission (ADR-0470)", () => {
  it("never asks for a Node or a manual worker while the host resident serves the checkout", () => {
    const pending = continuityRemediation({
      code: "continuity_pending",
      severity: "info",
      detail: null,
    });
    expect(pending).toContain("nothing is needed");
    expect(pending).not.toMatch(/worker --watch|Register a Node/u);
  });

  it("names lervo upgrade and the activation blocker for a held resident", () => {
    const held = continuityRemediation({
      code: "event_schema_outdated",
      severity: "attention",
      detail: "reader_inventory_hub_unavailable",
    });
    expect(held).toContain("lervo upgrade");
    expect(held).toContain("reader_inventory_hub_unavailable");
    expect(held).toContain("Hub");
  });

  it("names the missing or conflicting delegation-bound definition and its remedy (ADR-0477)", () => {
    expect(
      continuityRemediation({
        code: "delegation_missing",
        severity: "attention",
        detail: "convergence_seed_definition_conflict",
      }),
    ).toContain("never overwrites a file it did not install");
    expect(
      continuityRemediation({
        code: "definition_exchange_unavailable",
        severity: "attention",
        detail: "hub_definitions_unsupported",
      }),
    ).toContain("Upgrade the Hub");
  });

  it("points an unserved checkout at the host resident service or its Node", () => {
    expect(
      continuityRemediation({
        code: "continuity_unobserved",
        severity: "attention",
        detail: "host_resident_absent",
      }),
    ).toContain("host_service stage installs the host resident service");
    expect(
      continuityRemediation({
        code: "resident_not_running",
        severity: "attention",
        detail: "node_served",
      }),
    ).toContain("lervo repository node status");
  });
});

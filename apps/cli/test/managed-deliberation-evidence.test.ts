import { describe, expect, it } from "vitest";

import { assertManagedDeliberationEvidenceBundle } from "../src/managed-deliberation-evidence.js";
import { fixtureDeliberationEvidence } from "./managed-deliberation-test-fixture.js";

describe("managed deliberation evidence", () => {
  it("accepts an exact-hash current evidence bundle", () => {
    expect(() =>
      assertManagedDeliberationEvidenceBundle(fixtureDeliberationEvidence("Review the design.")),
    ).not.toThrow();
  });

  it("rejects source bytes that differ from the bound canonical hash", () => {
    const bundle = fixtureDeliberationEvidence("Review the design.");
    bundle.documents[0]!.content += "changed";
    expect(() => assertManagedDeliberationEvidenceBundle(bundle)).toThrowError(
      expect.objectContaining({ code: "deliberation_evidence_unavailable" }),
    );
  });

  it("rejects a stale source before any provider call", () => {
    const bundle = fixtureDeliberationEvidence("Review the design.");
    bundle.documents[0]!.freshness = "stale";
    expect(() => assertManagedDeliberationEvidenceBundle(bundle)).toThrowError(
      expect.objectContaining({ code: "deliberation_evidence_unavailable" }),
    );
  });
});

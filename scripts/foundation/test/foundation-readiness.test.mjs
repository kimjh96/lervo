import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  createFoundationReadinessReport,
  verifyFoundationReadinessReport,
} from "../readiness/report.mjs";

const hash = (character) => `sha256:${character.repeat(64)}`;
const checkIds = ["contracts", "fresh_clone", "release_completion"];

function observation(sequence) {
  return {
    sequence,
    observedAt: `2026-09-01T00:00:0${sequence}.000Z`,
    repositoryRevision: hash("a"),
    status: "passed",
    checks: checkIds.map((checkId, index) => ({
      checkId,
      status: "passed",
      durationMs: sequence + index,
      outputHash: hash(String(index + 1)),
    })),
  };
}

function report() {
  return createFoundationReadinessReport({
    repositoryRevision: hash("a"),
    releaseBaseRevision: "70e6a54",
    environment: { operatingSystem: "darwin", architecture: "arm64", nodeVersion: "v22.13.0" },
    constituentReports: [
      { path: "performance.json", reportId: "perf_1", contentHash: hash("b") },
      { path: "adverse.json", reportId: "adverse_1", contentHash: hash("c") },
    ],
    suiteBindings: [{ path: "suite.test.ts", contentHash: hash("d") }],
    checkIds,
    unsupportedStates: ["External live availability is not claimed."],
    observations: [observation(1), observation(2), observation(3)],
  });
}

describe("foundation readiness evidence", () => {
  it("accepts exactly three complete source-bound observations", () => {
    const value = report();
    assert.equal(verifyFoundationReadinessReport(value).reportId, value.reportId);
  });

  it("rejects a missing gate even when every retained gate passed", () => {
    const value = structuredClone(report());
    value.observations[1].checks.pop();
    assert.throws(() => verifyFoundationReadinessReport(value), /does not satisfy/u);
  });

  it("rejects redigested evidence with a failed observation", () => {
    const value = structuredClone(report());
    value.observations[2].status = "failed";
    value.reportId = report().reportId;
    assert.throws(() => verifyFoundationReadinessReport(value), /does not satisfy/u);
  });
});

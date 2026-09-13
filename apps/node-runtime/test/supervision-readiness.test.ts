import { describe, expect, it } from "vitest";
import { operatingContractHash } from "@lervo/work-controller";
import {
  bindNodeSupervisionReadiness,
  assertNodeSupervisionReadiness,
} from "../src/supervision-readiness.js";
import {
  hash,
  now,
  plan,
  readiness,
  responsibility,
} from "../../../packages/work-controller/test/operating-supervision.fixture.js";

function fixture() {
  const task = responsibility();
  const action = {
    ...plan(),
    expectedPaths: ["src"],
    responsibilityArtifactHash: operatingContractHash(task),
    sourceRevisionDigest: hash("f"),
  };
  return {
    plan: action,
    readiness: { responsibility: task, observation: readiness(), requiredChecks: [] },
    sourceBinding: { taskDigest: hash(), combined: hash("f") },
  };
}

describe("Node task readiness binding", () => {
  it("binds the raw task digest without mutating adapter evidence", () => {
    const input = fixture();
    const bound = bindNodeSupervisionReadiness(input);
    expect(bound.observation.sourceRevisionDigest).toBe(hash("f"));
    expect(input.readiness.observation.sourceRevisionDigest).toBe(hash());
    expect(() =>
      assertNodeSupervisionReadiness({ readiness: bound, sourceRevisionDigest: hash("f"), now }),
    ).not.toThrow();
  });
  it.each(["source", "artifact", "role", "capability", "path", "owner"])(
    "rejects a changed %s binding",
    (kind) => {
      const input = fixture();
      if (kind === "source") input.readiness.observation.sourceRevisionDigest = hash("b");
      if (kind === "artifact") input.plan.responsibilityArtifactHash = hash("b");
      if (kind === "role") input.plan.roleId = "writer";
      if (kind === "capability") input.plan.requiredCapabilities = [];
      if (kind === "path") input.plan.expectedPaths = ["src/other"];
      if (kind === "owner") input.plan.actionKind = "execute_as_owner";
      expect(() => bindNodeSupervisionReadiness(input)).toThrow("supervision_readiness_changed");
    },
  );
  it("rechecks freshness and expiry after admission, preserving failed evidence", () => {
    const bound = bindNodeSupervisionReadiness(fixture());
    expect(() =>
      assertNodeSupervisionReadiness({
        readiness: bound,
        sourceRevisionDigest: hash("f"),
        now: "2026-09-11T03:00:06.000Z",
      }),
    ).toThrow("supervision_readiness_changed");
    bound.observation.validUntil = now;
    expect(() =>
      assertNodeSupervisionReadiness({ readiness: bound, sourceRevisionDigest: hash("f"), now }),
    ).toThrow();
    bound.observation.validUntil = "2026-09-11T03:01:00.000Z";
    bound.observation.checks[0]!.status = "failed";
    expect(() =>
      assertNodeSupervisionReadiness({ readiness: bound, sourceRevisionDigest: hash("f"), now }),
    ).toThrow();
  });
});

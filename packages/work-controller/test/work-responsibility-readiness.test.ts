import { describe, expect, it } from "vitest";
import {
  evaluateWorkerReadiness,
  evaluateWorkResponsibility,
  operatingContractHash,
} from "../src/index.js";
import { hash, now, readiness, responsibility } from "./operating-supervision.fixture.js";

describe("responsibility and actual task readiness", () => {
  it.each([
    ["shell.execute", "cli"],
    ["filesystem.write", "write_scope"],
    ["repository.write", "write_scope"],
    ["network.access", "source_policy"],
  ] as const)(
    "derives %s readiness even when the adapter omits required checks",
    (capability, kind) => {
      const task = responsibility();
      task.requiredCapabilities = [capability];
      const observation = readiness();
      observation.responsibilityArtifactHash = operatingContractHash(task);
      observation.checks.find((check) => check.kind === kind)!.status = "not_required";
      expect(
        evaluateWorkerReadiness({
          responsibility: task,
          observation,
          sourceRevisionDigest: hash(),
          requiredChecks: [],
          now,
        }).reasonCodes,
      ).toContain(`readiness_${kind}_not_required`);
    },
  );
  const current = () => ({
    ...responsibility(),
    responsibilityBindingHash: null,
    liveLease: false,
  });
  it("requires exact current roles, assignment revision and predecessor with no live lease", () => {
    const input = {
      responsibility: responsibility(),
      current: current(),
      now,
      maximumDeadlineMs: 3600000,
    };
    expect(evaluateWorkResponsibility(input).status).toBe("ready");
    expect(
      evaluateWorkResponsibility({
        ...input,
        current: {
          ...current(),
          liveLease: true,
          assignmentRevision: 2,
          responsibilityBindingHash: hash(),
          roleContractHash: hash("b"),
        },
      }).reasonCodes,
    ).toEqual([
      "assignment_changed",
      "role_binding_changed",
      "responsibility_changed",
      "responsibility_lease_unresolved",
    ]);
  });
  it("does not confuse a speaker identity or greeting with provider, saving, or verification readiness", () => {
    const input = {
      responsibility: responsibility(),
      observation: readiness(),
      sourceRevisionDigest: hash(),
      requiredChecks: ["write_scope", "source_policy"] as const,
      now,
    };
    expect(evaluateWorkerReadiness(input).status).toBe("ready");
    for (const kind of ["provider", "write_scope", "verification", "source_policy"] as const) {
      const observation = readiness();
      observation.checks.find((check) => check.kind === kind)!.status = "not_required";
      expect(evaluateWorkerReadiness({ ...input, observation }).status).toBe("blocked");
    }
  });
  it("requires current evidence and invalidates changed duties and expired observations", () => {
    const input = {
      responsibility: responsibility(),
      observation: readiness(),
      sourceRevisionDigest: hash(),
      requiredChecks: [],
      now,
    };
    input.observation.validUntil = now;
    input.observation.responsibilityArtifactHash = hash("b");
    input.observation.checks[0]!.evidenceHash = null;
    expect(evaluateWorkerReadiness(input).reasonCodes).toEqual(
      expect.arrayContaining([
        "readiness_expired",
        "readiness_binding_changed",
        "readiness_provider_evidence_missing",
      ]),
    );
  });
});

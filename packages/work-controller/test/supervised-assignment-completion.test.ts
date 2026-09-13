import { expect, it } from "vitest";
import type { SupervisedAssignmentCompletionV3 } from "@lervo/application-contract";
import { supervisedAssignmentCompletionFields, operatingReadinessKind } from "../src/index.js";
import { responsibility, hash, plan } from "./operating-supervision.fixture.js";

function effect(): SupervisedAssignmentCompletionV3 {
  return {
    schemaVersion: 3,
    kind: "work.assignment_completion",
    responsibility: responsibility(),
    expectedAssignmentHash: hash(),
    writingArtifactHash: hash(),
    reasoningPlanHash: hash(),
    reasoningResultHash: hash(),
    rationaleArtifactHash: hash(),
    roleEvaluationArtifactHash: null,
    terminalEventId: `evt_${"a".repeat(32)}`,
    executionCompletedAt: "2026-09-11T03:29:00.000Z",
    preparedAt: "2026-09-11T03:40:00.000Z",
    settlementDeadline: "2026-09-11T03:42:00.000Z",
  };
}

it("uses a bounded owner deadline without extending the worker responsibility", () => {
  const input = effect();
  const fields = supervisedAssignmentCompletionFields(input);
  expect(fields).toMatchObject({
    effectContract: "work.assignment_completion.v3",
    deadline: input.settlementDeadline,
  });
  expect(operatingReadinessKind({ ...plan(), ...fields })).toBe("owner_control");
  expect(input.responsibility.completionDeadline).toBe("2026-09-11T03:30:00.000Z");
});

it.each([
  { terminalEventId: "unobserved" },
  { executionCompletedAt: "invalid" },
  { executionCompletedAt: "2026-09-11T03:30:00.000Z" },
  { preparedAt: "2026-09-11T03:28:00.000Z" },
  { settlementDeadline: "2026-09-11T03:40:00.000Z" },
  { settlementDeadline: "2026-09-11T03:42:00.001Z" },
])("rejects invalid settlement evidence %j", (change) => {
  expect(() => supervisedAssignmentCompletionFields({ ...effect(), ...change })).toThrow();
});

import { describe, expect, it } from "vitest";
import type { ProjectStorage } from "@lervo/project-storage";

import { interpretManagedDeliberationInspection } from "../src/conversation-deliberation-reconciliation.js";
import type { DeliberationInspectionReport } from "../src/deliberation-inspection.js";
import { inspectManagedDeliberation } from "../src/deliberation-inspection.js";

const projectId = "prj_cli_deliberation";
const deliberationId = "dlb_reconciliation01";

function report(
  overrides: Partial<DeliberationInspectionReport> = {},
): DeliberationInspectionReport {
  return {
    schemaVersion: 1,
    projectId,
    deliberationId,
    sourceStatus: "consistent",
    phase: "completed",
    completionStatus: "converged",
    terminalReasonCode: null,
    artifactCount: 5,
    publishedArtifactCount: 5,
    quarantinedArtifactCount: 0,
    failedPublications: [],
    lastRound: 1,
    checkpoint: "readable",
    lease: "missing",
    resume: "completed",
    issues: [],
    events: [],
    ...overrides,
  };
}

function interpret(value: DeliberationInspectionReport, operation: "start" | "resume" = "start") {
  return interpretManagedDeliberationInspection({
    job: {
      operation,
      projectId,
      deliberationId,
      requestHash: `sha256:${"1".repeat(64)}`,
      state: "uncertain",
      summary: null,
    },
    inspectedAt: "2026-08-22T00:02:00.000Z",
    report: value,
  });
}

describe("managed conversation deliberation reconciliation mapping", () => {
  it("proves an approved interruption as a resume candidate without resuming it", () => {
    const interrupted = report({
      phase: "interrupted_after_approval",
      completionStatus: null,
      artifactCount: 2,
      checkpoint: "readable",
      lease: "stale",
      resume: "candidate",
    });
    expect(interpret(interrupted)).toEqual({
      status: "confirmed",
      sourceKind: "managed_deliberation_inspection_v1",
      evidenceHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      summary: {
        deliberationId,
        status: "interrupted",
        artifactCount: 2,
        nextAction: "resume",
      },
    });
    expect(interpret(interrupted, "resume")).toEqual({
      status: "not_confirmed",
      reason: "history_incomplete",
    });
  });

  it("does not infer an outcome while a lease is active", () => {
    expect(
      interpret(
        report({
          phase: "running_after_approval",
          completionStatus: null,
          checkpoint: "readable",
          lease: "active",
          resume: "blocked_running",
        }),
      ),
    ).toEqual({ status: "not_confirmed", reason: "active_execution" });
  });

  it("keeps incomplete and inconsistent history separate", () => {
    expect(
      interpret(
        report({
          sourceStatus: "incomplete",
          phase: "rounds",
          completionStatus: null,
          checkpoint: "missing",
          resume: "not_available",
          issues: [
            {
              code: "deliberation_history_incomplete",
              message: "The deliberation did not finish.",
            },
          ],
        }),
      ),
    ).toEqual({ status: "not_confirmed", reason: "history_incomplete" });
    expect(
      interpret(
        report({
          sourceStatus: "inconsistent",
          issues: [
            {
              code: "deliberation_history_invalid",
              message: "The deliberation history does not match.",
            },
          ],
        }),
      ),
    ).toEqual({ status: "not_confirmed", reason: "source_inconsistent" });
    expect(interpret(report({ projectId: "prj_otherproject1" }))).toEqual({
      status: "not_confirmed",
      reason: "source_inconsistent",
    });
  });

  it("rejects a broken project event hash chain before reading deliberation history", async () => {
    const storage = {
      events: {
        verifyIntegrity: () => ({ valid: false }),
      },
    } as unknown as ProjectStorage;
    await expect(inspectManagedDeliberation({ storage, deliberationId })).rejects.toMatchObject({
      code: "deliberation_history_invalid",
    });
  });
});

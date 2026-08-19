import { createDoctorReport } from "@lervo/diagnostics";
import { afterEach, describe, expect, it } from "vitest";

import {
  calculateKnowledgeStalenessResultId,
  evaluateKnowledgeStaleness,
  recordKnowledgeStaleness,
} from "../src/index.js";
import {
  healthyDoctorEnvironmentInspections,
  removeStores,
  sequence,
} from "./fixture.js";
import {
  changedHash,
  laterRevision,
  pathHash,
  promotedFixture,
  promotionPolicy,
} from "./lifecycle-fixture.js";

afterEach(removeStores);

describe("verified knowledge staleness", () => {
  it("ignores unrelated revision changes and records linked path changes", async () => {
    const fixture = await promotedFixture();
    const current = evaluateKnowledgeStaleness({
      knowledge: fixture.promoted.knowledge,
      evaluatedAt: "2026-08-20T01:00:00Z",
      currentSnapshot: {
        revision: laterRevision,
        files: { "src/decision.ts": pathHash, "src/unrelated.ts": changedHash },
      },
    });
    expect(current).toMatchObject({ status: "current", reasons: [] });
    await expect(recordKnowledgeStaleness({
      knowledge: fixture.promoted.knowledge,
      knowledgeArtifact: fixture.promoted.knowledgeArtifact,
      result: current,
      runId: "run_knowledge_stale",
      sessionId: "ses_knowledge_stale",
      policyVersion: promotionPolicy.policyVersion,
      events: fixture.storage.events,
      artifactStore: fixture.storage.artifacts,
      createEventId: sequence("evt_stale"),
    })).rejects.toMatchObject({ reason: "staleness_not_stale" });

    const stale = evaluateKnowledgeStaleness({
      knowledge: fixture.promoted.knowledge,
      evaluatedAt: "2026-08-20T01:00:00Z",
      currentSnapshot: {
        revision: laterRevision,
        files: { "src/decision.ts": changedHash },
      },
    });
    expect(stale).toMatchObject({
      status: "stale",
      reasons: ["linked_path_changed"],
      signals: { paths: { changedPaths: ["src/decision.ts"] } },
    });
    const recorded = await recordKnowledgeStaleness({
      knowledge: fixture.promoted.knowledge,
      knowledgeArtifact: fixture.promoted.knowledgeArtifact,
      result: stale,
      runId: "run_knowledge_stale",
      sessionId: "ses_knowledge_stale",
      policyVersion: promotionPolicy.policyVersion,
      events: fixture.storage.events,
      artifactStore: fixture.storage.artifacts,
      createEventId: sequence("evt_stale"),
    });
    expect(recorded.recordedEvent.type).toBe("knowledge.stale.detected");
    await expect(createDoctorReport({
      projectId: fixture.promoted.knowledge.projectId,
      events: fixture.storage.events,
      artifacts: fixture.storage.artifacts,
      inspections: healthyDoctorEnvironmentInspections,
    })).resolves.toMatchObject({
      status: "healthy",
      checks: expect.arrayContaining([
        { checkId: "verified_knowledge", status: "healthy", observedCount: 1 },
        { checkId: "knowledge_staleness", status: "healthy", observedCount: 1 },
      ]),
      issues: [],
    });
    fixture.storage.events.close();
  });

  it("distinguishes missing paths and rejects contradictory derived state", async () => {
    const fixture = await promotedFixture();
    const missing = evaluateKnowledgeStaleness({
      knowledge: fixture.promoted.knowledge,
      evaluatedAt: "2026-08-20T01:00:00Z",
      currentSnapshot: { revision: laterRevision, files: {} },
    });
    expect(missing).toMatchObject({
      status: "stale",
      reasons: ["linked_path_missing"],
      signals: { paths: { missingPaths: ["src/decision.ts"] } },
    });
    const contradictoryContent = { ...missing, status: "current" as const };
    const contradictory = {
      ...contradictoryContent,
      resultId: calculateKnowledgeStalenessResultId(contradictoryContent),
    };
    await expect(recordKnowledgeStaleness({
      knowledge: fixture.promoted.knowledge,
      knowledgeArtifact: fixture.promoted.knowledgeArtifact,
      result: contradictory,
      runId: "run_knowledge_stale",
      sessionId: "ses_knowledge_stale",
      policyVersion: promotionPolicy.policyVersion,
      events: fixture.storage.events,
      artifactStore: fixture.storage.artifacts,
      createEventId: sequence("evt_contradictory"),
    })).rejects.toMatchObject({ reason: "staleness_schema_invalid" });
    fixture.storage.events.close();
  });

  it("marks the exact review due instant stale", async () => {
    const fixture = await promotedFixture();
    expect(evaluateKnowledgeStaleness({
      knowledge: fixture.promoted.knowledge,
      evaluatedAt: "2026-09-18T01:00:00Z",
      currentSnapshot: {
        revision: laterRevision,
        files: { "src/decision.ts": pathHash },
      },
    })).toMatchObject({ status: "stale", reasons: ["review_interval_elapsed"] });
    fixture.storage.events.close();
  });
});

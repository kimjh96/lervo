import { describe, expect, it } from "vitest";

import { validateSchema, type SchemaName } from "../src/index.js";

const hash = `sha256:${"a".repeat(64)}`;
const artifact = `art_${"a".repeat(64)}`;
const patternId = `pattern_${"b".repeat(24)}`;
const protocolId = `ieprotocol_${"c".repeat(24)}`;
const planId = `ieplan_${"d".repeat(24)}`;
const timestamp = "2026-09-03T00:00:00.000Z";
const adapter = {
  adapterId: "iobs_repository_metrics",
  adapterVersion: "1.0.0",
  adapterDescriptorHash: hash,
};
const fixtures: Array<{ type: string; schema: SchemaName; payload: Record<string, unknown> }> = [
  {
    type: "development.pattern.observed",
    schema: "developmentPatternObservedEventPayload",
    payload: {
      patternId,
      observationId: `dpobs_${"a".repeat(24)}`,
      provider: "codex",
      sourceSnapshotId: `ksnap_${"a".repeat(24)}`,
      sourceSnapshotHash: hash,
      evidenceDigest: hash,
      occurrenceCount: 2,
      observedAt: timestamp,
    },
  },
  {
    type: "development.pattern.transitioned",
    schema: "developmentPatternTransitionedEventPayload",
    payload: {
      patternId,
      transitionId: `dptr_${"a".repeat(24)}`,
      fromState: "reviewed",
      toState: "promoted",
      candidateArtifactId: artifact,
      candidateContentHash: hash,
      reviewArtifactId: artifact,
      reviewContentHash: hash,
      targetKind: "repository_instruction",
      approvalHash: hash,
      occurredAt: timestamp,
    },
  },
  {
    type: "development.pattern.evaluation.registered",
    schema: "developmentPatternEvaluationRegisteredEventPayload",
    payload: {
      patternId,
      protocolId,
      protocolPlanId: planId,
      protocolArtifactId: artifact,
      protocolArtifactHash: hash,
      candidateContentHash: hash,
      reviewContentHash: hash,
      targetContentHash: hash,
      ...adapter,
      baselineWindowHash: hash,
      baselineObservationHash: hash,
      metricIds: ["verification_success"],
      registeredAt: timestamp,
    },
  },
  {
    type: "development.pattern.effect.observed",
    schema: "developmentPatternEffectObservedEventPayload",
    payload: {
      patternId,
      protocolId,
      comparisonId: `iecomparison_${"a".repeat(24)}`,
      comparisonPlanId: planId,
      comparisonArtifactId: artifact,
      comparisonArtifactHash: hash,
      registrationEventId: `evt_${"a".repeat(32)}`,
      promotionEventId: `evt_${"b".repeat(32)}`,
      targetContentHash: hash,
      ...adapter,
      treatmentWindowHash: hash,
      treatmentObservationHash: hash,
      overall: "no_material_difference",
      attribution: "unestablished",
      rollbackDisposition: "not_authorized",
      metricCount: 1,
      observedAt: timestamp,
    },
  },
];

describe("historical development-pattern readers", () => {
  it.each(fixtures)(
    "validates $type payloads and stored envelopes",
    ({ type, schema, payload }) => {
      expect(validateSchema(schema, payload).valid).toBe(true);
      expect(
        validateSchema("event", {
          eventId: `evt_${"a".repeat(32)}`,
          projectId: "prj_historical_01",
          runId: "run_historical_01",
          sessionId: "ses_historical_01",
          seq: 1,
          type,
          occurredAt: timestamp,
          actor: { kind: "system" },
          schemaVersion: 1,
          policyVersion: hash,
          payload,
          previousHash: null,
          eventHash: hash,
        }).valid,
      ).toBe(true);
      expect(validateSchema(schema, { ...payload, rawEvidence: "private" }).valid).toBe(false);
    },
  );

  it("reads the original declaration event whose outcome was stored outside its payload", () => {
    expect(
      validateSchema("terminalTurnDeclaredEventPayload", {
        declarationId: "tdecl_historical_01",
        contextEventId: "evt_historical_01",
        repositoryRevision: hash,
        taskMode: "change",
        canonicalizationDisposition: "pending_user_approval",
        knowledgeDisposition: "current",
        deliberationDisposition: "not_requested",
        deliberationId: null,
        declaredAt: timestamp,
      }).valid,
    ).toBe(true);
  });
});

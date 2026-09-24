import { describe, expect, it } from "vitest";
import { sanitizeEventPayload } from "../src/index.js";

const hash = `sha256:${"a".repeat(64)}`;
const common = {
  schemaVersion: 1,
  projectId: `prj_${"a".repeat(16)}`,
  workstreamId: `wks_${"a".repeat(24)}`,
  workstreamRevision: 1,
  supervisionId: "supervision.project",
  ownerAgentId: `agt_${"a".repeat(24)}`,
  mandateHash: hash,
  causationEventIds: [`evt_${"a".repeat(32)}`],
};

describe("supervision privacy and evidence payloads", () => {
  it("retains exact mandate review hashes while removing raw authority material", () => {
    const payload = {
      ...common,
      mandateId: "mandate.project",
      mandateVersion: 1,
      mandateArtifactHash: hash,
      installationReviewHash: hash,
      reviewerIdDigest: hash,
      predecessorMandateHash: null,
    };
    const result = sanitizeEventPayload("work.supervision.mandate.installed", {
      ...payload,
      rawPrompt: "private review",
      credential: "private credential",
      paths: ["private/file"],
    });
    expect(result.payload).toEqual(payload);
    expect(result.redactions).toHaveLength(3);
    expect(() =>
      sanitizeEventPayload("work.supervision.mandate.installed", {
        ...payload,
        installationReviewHash: null,
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_payload" }));
  });

  it("rejects confirmation without evidence, duplicate causes and unsupported states", () => {
    const payload = {
      ...common,
      decisionId: "osd_fixture",
      planHash: hash,
      status: "effect_confirmed",
      effectEventIds: [`evt_${"b".repeat(32)}`],
    };
    expect(sanitizeEventPayload("work.supervision.effect.observed", payload).payload).toEqual(
      payload,
    );
    for (const invalid of [
      { ...payload, effectEventIds: [] },
      { ...payload, causationEventIds: [...common.causationEventIds, ...common.causationEventIds] },
      { ...payload, status: "probably_done" },
      { ...payload, effectEventIds: ["raw-external-message-id"] },
    ])
      expect(() => sanitizeEventPayload("work.supervision.effect.observed", invalid)).toThrowError(
        expect.objectContaining({ code: "invalid_payload" }),
      );
  });

  it("accepts only bounded coordinates for an interrupted owner reconciliation", () => {
    const payload = {
      ...common,
      decisionId: "osd_fixture",
      planHash: hash,
      managedRunId: `run_${"b".repeat(32)}`,
      terminalEventId: `evt_${"c".repeat(32)}`,
      diagnosticArtifactHash: hash,
    };
    expect(
      sanitizeEventPayload("work.supervision.owner_reasoning.interruption_reconciled", payload)
        .payload,
    ).toEqual(payload);
    for (const invalid of [
      { ...payload, managedRunId: "run_wrong" },
      { ...payload, terminalEventId: "evt_wrong" },
      { ...payload, diagnosticArtifactHash: "private_path" },
    ])
      expect(() =>
        sanitizeEventPayload("work.supervision.owner_reasoning.interruption_reconciled", invalid),
      ).toThrowError(expect.objectContaining({ code: "invalid_payload" }));
  });

  it("reads only bounded, decision-causal preflight non-start coordinates", () => {
    const payload = {
      ...common,
      decisionId: "osd_fixture",
      planHash: hash,
      effectContract: "work.managed_execution.v1",
      sourceRevisionDigest: hash,
      inspectionArtifactHash: hash,
      failurePhase: "readiness",
      reasonCode: "supervision_readiness_stale",
    };
    const result = sanitizeEventPayload("work.supervision.preflight.blocked", {
      ...payload,
      rawPrompt: "private request",
      sourcePath: "private/file",
    });
    expect(result.payload).toEqual(payload);
    expect(result.redactions).toHaveLength(2);
    for (const invalid of [
      { ...payload, causationEventIds: [] },
      { ...payload, causationEventIds: [...common.causationEventIds, ...common.causationEventIds] },
      { ...payload, inspectionArtifactHash: "private/file" },
      { ...payload, failurePhase: "provider_started" },
      { ...payload, reasonCode: "unbounded error with raw text" },
    ])
      expect(() =>
        sanitizeEventPayload("work.supervision.preflight.blocked", invalid),
      ).toThrowError(expect.objectContaining({ code: "invalid_payload" }));
  });

  it("accepts only reviewed, exactly causal source-change repair coordinates", () => {
    const blockedEventId = `evt_${"b".repeat(32)}`;
    const supersessionEventId = `evt_${"c".repeat(32)}`;
    const sourceSnapshotEventId = `evt_${"d".repeat(32)}`;
    const payload = {
      ...common,
      causationEventIds: [blockedEventId, supersessionEventId, sourceSnapshotEventId],
      blockedEventId,
      blockedEventHash: hash,
      supersessionEventId,
      supersessionEventHash: hash,
      sourceSnapshotEventId,
      sourceSnapshotEventHash: hash,
      reviewArtifactHash: hash,
      reviewerIdDigest: hash,
      resolutionKind: "reviewed_source_change",
    };
    const result = sanitizeEventPayload("work.supervision.preflight.resolved", {
      ...payload,
      rawRationale: "private review",
    });
    expect(result.payload).toEqual(payload);
    expect(result.redactions).toHaveLength(1);
    const authority = { ...payload, resolutionKind: "reviewed_authority_change" };
    expect(sanitizeEventPayload("work.supervision.preflight.resolved", authority).payload).toEqual(
      authority,
    );
    for (const invalid of [
      {
        ...payload,
        causationEventIds: [supersessionEventId, blockedEventId, sourceSnapshotEventId],
      },
      { ...payload, blockedEventHash: "private/file" },
      { ...payload, sourceSnapshotEventId: "external-message" },
      { ...payload, resolutionKind: "timer_elapsed" },
    ])
      expect(() =>
        sanitizeEventPayload("work.supervision.preflight.resolved", invalid),
      ).toThrowError(expect.objectContaining({ code: "invalid_payload" }));
  });
});

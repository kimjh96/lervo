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
});

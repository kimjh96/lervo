import { expect, it } from "vitest";
import { sanitizeEventPayload } from "../src/redaction.js";
const hash = `sha256:${"a".repeat(64)}`;
const payload = {
  schemaVersion: 1,
  requestId: "qreq_fixture",
  taskRevision: 1,
  semanticInputDigest: hash,
  planDigest: hash,
  sourceSnapshotId: "snapshot_fixture",
  scopeDigest: hash,
  policySetDigest: hash,
  profileId: "profile_fixture",
  executionMode: "unmanaged",
  originKind: "terminal",
  adapterBuildId: hash,
  status: "incomplete",
  reasonCodes: ["context_corpus_incomplete"],
  requiredCount: 1,
  resolvedCount: 1,
  loadedCount: 1,
  evidenceCount: 0,
  sectionCount: 1,
  coverageDisposition: "incomplete",
  reportArtifactHash: hash,
  stageObservationHashes: [],
};
it("accepts bounded preparation coordinates while removing raw private input", () => {
  const result = sanitizeEventPayload("context.quality.prepared", {
    ...payload,
    taskText: "private request",
  });
  expect(result.payload).toEqual(payload);
});
it("rejects fabricated ready states, inconsistent counts and missing bindings", () => {
  for (const patch of [
    { status: "ready" },
    { loadedCount: 2 },
    { planDigest: null },
    { taskRevision: null },
    { sourceSnapshotId: null },
  ])
    expect(() =>
      sanitizeEventPayload("context.quality.prepared", { ...payload, ...patch }),
    ).toThrow();
});
it("rejects unbounded and unknown reasons instead of persisting source text", () => {
  expect(() =>
    sanitizeEventPayload("context.quality.prepared", {
      ...payload,
      reasonCodes: ["private request"],
    }),
  ).toThrow();
});

it("retains the scoped-language diagnostic on a passed verification but rejects failure reasons", () => {
  const verified = {
    schemaVersion: 1,
    requestId: "qreq_fixture",
    planDigest: hash,
    artifactDigest: hash,
    verificationDefinitionId: "publication.v1",
    verificationDefinitionHash: hash,
    evaluatorBuildId: hash,
    disposition: "passed",
    reasonCodes: ["context_language_exception"],
    verificationArtifactHash: hash,
  };
  expect(sanitizeEventPayload("context.quality.verified", verified).payload).toMatchObject({
    reasonCodes: ["context_language_exception"],
  });
  expect(() =>
    sanitizeEventPayload("context.quality.verified", {
      ...verified,
      reasonCodes: ["context_verification_failed"],
    }),
  ).toThrow();
});

import { createHash } from "node:crypto";
import type {
  ContextQualityBindings,
  ContextQualityEvidence,
  ContextQualityIngress,
} from "@lervo/schemas";
import { bindContextQualityRequest, contextQualityTaskDigest } from "@lervo/context";

export const qualityHash = (value: string | Uint8Array) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export function qualityFixture() {
  const ingress: ContextQualityIngress = {
    schemaVersion: 1,
    requestId: "attempt_one",
    projectId: "prj_quality01",
    taskRevision: 1,
    task: {
      intent: "문서를 수정해줘",
      continuation: "",
      targetPaths: ["docs/readme.md"],
      artifactKinds: ["markdown"],
      requestedActions: ["repository.read"],
      conversationLocale: "ko",
      publicationLocale: "en",
      retrievalLanguages: ["en", "ko"],
    },
    origin: {
      kind: "terminal",
      adapterBuildId: qualityHash("terminal-build"),
      correlationId: "turn_one",
    },
  };
  const bindings: ContextQualityBindings = {
    projectId: ingress.projectId,
    taskRevision: ingress.taskRevision,
    taskDigest: contextQualityTaskDigest(ingress),
    scopeDigest: qualityHash("read-only-scope"),
    policySetDigest: qualityHash("policy-and-exceptions"),
    sourceSnapshotId: "snapshot_one",
    retrievalPlanId: "retrieval_one",
    profileId: "profile_one",
    profile: {
      maximumBytes: 4096,
      maximumTokens: 1024,
      deadlineMs: 1000,
      maximumConcurrent: 2,
      maximumPending: 32,
      maximumRetainedBytes: 65536,
      maximumProviderCalls: 0,
    },
    builds: { core: qualityHash("core"), retrieval: qualityHash("retriever"), projector: null },
    projectedQueries: ["repository documentation"],
    executionCapabilities: {
      controlledProviderInput: false,
      exactDeliveryAcknowledgement: false,
      observedArtifactAccess: false,
      controlledConsequentialEffects: false,
    },
  };
  const sources = [
    { sourceId: "source_rule", bytes: Buffer.from("Publish English repository prose.") },
    { sourceId: "source_evidence", bytes: Buffer.from("The local runtime works without a Hub.") },
  ];
  const evidence: ContextQualityEvidence = {
    applicability: "complete",
    obligations: [
      {
        ruleId: "publication_language",
        sourceId: sources[0]!.sourceId,
        sourceHash: qualityHash(sources[0]!.bytes),
        byteStart: 0,
        byteEnd: sources[0]!.bytes.length,
        locator: "language clause",
        authorityClass: "configured",
        scopeDigest: bindings.scopeDigest,
        disposition: "applicable",
        conditionRefs: [],
        exceptionRefs: [],
        verificationDefinition: "not_automatable",
      },
    ],
    corpusCoverage: {
      sourceSnapshotId: bindings.sourceSnapshotId,
      scopeDigest: bindings.scopeDigest,
      disposition: "complete",
      discovered: 2,
      eligible: 2,
      indexed: 2,
      excluded: 0,
      unavailable: 0,
    },
    retrieval: { disposition: "completed", resultDigest: qualityHash("ranked-results") },
    sections: sources.map((source, index) => ({
      sourceId: source.sourceId,
      sourceHash: qualityHash(source.bytes),
      byteStart: 0,
      byteEnd: source.bytes.length,
      sectionHash: qualityHash(source.bytes),
      locator: "full clause",
      role: index === 0 ? "obligation" : "evidence",
      required: index === 0,
      ruleIds: index === 0 ? ["publication_language"] : [],
    })),
    selectedEvidenceCount: 1,
    tokenCount: 16,
    retrievalReceiptRefs: ["receipt_one"],
  };
  return {
    ingress,
    bindings,
    request: bindContextQualityRequest(ingress, bindings),
    evidence,
    sources,
  };
}

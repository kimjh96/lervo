import { Buffer } from "node:buffer";

import { sha256, valueDigest } from "./linked-evidence-shadow-phase-a-pilot-contract.mjs";

const expectedCaseIds = ["drv8case_status_node_fleet", "drv8case_boundary_user_owned_block"];
const expectedOmittedFields = [
  "provider",
  "model",
  "sampleId",
  "shadowRunId",
  "sessionId",
  "targetTurnId",
  "selectedDocumentIds",
  "expectedDocumentIds",
  "precisionBasisPoints",
  "recallBasisPoints",
  "durationMs",
  "usage",
];
const candidateClassifications = [
  "required_direct",
  "acceptable_alternative",
  "supporting_only",
  "not_relevant",
];
const caseDispositions = [
  "ground_truth_confirmed",
  "ground_truth_revision_proposed",
  "insufficient_evidence",
];

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function orderedEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertNoOmittedKeys(value, omittedFields) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoOmittedKeys(item, omittedFields);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    assert(!omittedFields.includes(key), `The audit packet exposes the prohibited ${key} field.`);
    assertNoOmittedKeys(item, omittedFields);
  }
}

export function auditPacketBytes(packet) {
  return Buffer.from(`${JSON.stringify(packet, null, 2)}\n`, "utf8");
}

export function auditPacketDigest(packet) {
  return sha256(auditPacketBytes(packet));
}

export function assertBlindGroundTruthAuditContract(contract) {
  assert(
    contract.schemaVersion === 1 &&
      contract.decisionId === "ADR-0263" &&
      contract.auditId === "linked-evidence-provider-shadow-v9-ground-truth-v1" &&
      contract.status === "authorized_packet_generation_only",
    "The blind ground-truth audit identity is invalid.",
  );
  assert(
    orderedEqual(
      contract.cases.map((item) => item.caseId),
      expectedCaseIds,
    ) &&
      contract.cases.every(
        (item) =>
          item.requiredClaims.length > 0 &&
          new Set(item.requiredClaims.map((claim) => claim.claimId)).size ===
            item.requiredClaims.length &&
          item.expectedCandidateCount > 0 &&
          item.expectedCandidateCount <= contract.output.maximumCandidatesPerCase &&
          item.expectedProviderVisibleSourceBytes > 0,
      ),
    "The blind ground-truth audit case boundary is invalid.",
  );
  assert(
    contract.blinding.candidateOrder === "content_hash_ascending" &&
      contract.blinding.includeFullCandidateEnvelope === true &&
      orderedEqual(contract.blinding.omitFields, expectedOmittedFields),
    "The blind ground-truth audit disclosure boundary is invalid.",
  );
  assert(
    orderedEqual(contract.review.candidateClassifications, candidateClassifications) &&
      orderedEqual(contract.review.caseDispositions, caseDispositions) &&
      contract.review.reviewerKind === "human" &&
      contract.review.requireEveryCandidate === true &&
      contract.review.requireEveryClaimCoverage === true &&
      contract.review.requireProviderOutcomesUnavailable === true &&
      contract.review.requireCurrentExpectedPathsUnavailable === true &&
      contract.review.allowModelAssistance === false,
    "The blind ground-truth human review boundary is invalid.",
  );
  assert(
    contract.authority.maximumProviderInvocationsAuthorized === 0 &&
      contract.authority.groundTruthMutationAuthorized === false &&
      contract.authority.measurementAuthorized === false &&
      contract.authority.managedContextEffectsAuthorized === false &&
      contract.authority.canaryAuthorized === false &&
      contract.authority.productionActivationAuthorized === false,
    "The blind ground-truth audit grants an unauthorized effect.",
  );
  assert(
    contract.output.maximumCases === 2 &&
      contract.output.maximumCandidatesPerCase === 16 &&
      contract.output.maximumCandidateBodyBytes === 260000 &&
      contract.output.packetPath.endsWith("/audit-packet.json") &&
      contract.output.reviewTemplatePath.endsWith("/human-review-template.json"),
    "The blind ground-truth audit output bounds are invalid.",
  );
}

function pairedCaseSchedule(contractCase, schedule) {
  const arms = schedule.filter((item) => item.caseId === contractCase.caseId);
  assert(
    arms.length === 2 &&
      new Set(arms.map((item) => item.provider)).size === 2 &&
      arms.every((item) => ["codex", "claude"].includes(item.provider)),
    `The ${contractCase.caseId} audit source is not an exact provider pair.`,
  );
  const [first, second] = arms;
  assert(
    first.query === second.query &&
      first.candidateEnvelopeDigest === second.candidateEnvelopeDigest &&
      orderedEqual(first.candidates, second.candidates) &&
      first.candidateCount === contractCase.expectedCandidateCount &&
      first.providerVisibleSourceBytes === contractCase.expectedProviderVisibleSourceBytes,
    `The ${contractCase.caseId} provider arms do not have identical audit inputs.`,
  );
  return first;
}

function opaqueCandidateId(caseId, path, contentHash) {
  return `auditcand_${sha256(`${caseId}\0${path}\0${contentHash}`).slice(7, 23)}`;
}

export function createBlindGroundTruthAuditPacket({
  contract,
  v9Prepared,
  phasePrepared,
  sourceDocuments,
}) {
  assertBlindGroundTruthAuditContract(contract);
  assert(
    valueDigest(v9Prepared.manifest) === v9Prepared.manifestDigest &&
      v9Prepared.manifestDigest === contract.source.v9PreparedManifestDigest &&
      v9Prepared.manifest.sourceSnapshotDigest === contract.source.sourceSnapshotDigest &&
      v9Prepared.manifest.sourceCorpusDigest === contract.source.sourceCorpusDigest,
    "The exact v9 prepared source is unavailable or changed.",
  );
  assert(
    valueDigest(phasePrepared.manifest) === phasePrepared.manifestDigest &&
      phasePrepared.manifestDigest === contract.source.phasePreparedManifestDigest &&
      phasePrepared.manifest.corpusDigest === contract.source.sourceCorpusDigest &&
      v9Prepared.manifest.sourcePhaseAManifestDigest === phasePrepared.manifestDigest,
    "The exact phase A source corpus is unavailable or changed.",
  );
  const corpusById = new Map(phasePrepared.manifest.corpus.map((item) => [item.documentId, item]));
  const sourceById = new Map(sourceDocuments.map((item) => [item.documentId, item]));
  let totalCandidateBodyBytes = 0;
  const cases = contract.cases.map((contractCase) => {
    const source = pairedCaseSchedule(contractCase, v9Prepared.manifest.schedule);
    const candidates = source.candidates
      .map((candidate) => {
        const corpus = corpusById.get(candidate.documentId);
        const document = sourceById.get(candidate.documentId);
        assert(
          corpus !== undefined &&
            document !== undefined &&
            corpus.path === document.path &&
            corpus.contentHash === candidate.contentHash &&
            document.contentHash === candidate.contentHash &&
            Buffer.byteLength(document.body, "utf8") === candidate.byteCount &&
            sha256(Buffer.from(document.body, "utf8")) === candidate.contentHash,
          `The exact ${candidate.documentId} audit source bytes are unavailable or changed.`,
        );
        totalCandidateBodyBytes += candidate.byteCount;
        return {
          auditCandidateId: opaqueCandidateId(
            contractCase.caseId,
            document.path,
            document.contentHash,
          ),
          path: document.path,
          contentHash: document.contentHash,
          byteCount: candidate.byteCount,
          body: document.body,
        };
      })
      .sort(
        (left, right) =>
          left.contentHash.localeCompare(right.contentHash) || left.path.localeCompare(right.path),
      );
    assert(
      candidates.length === contractCase.expectedCandidateCount &&
        new Set(candidates.map((item) => item.auditCandidateId)).size === candidates.length,
      `The ${contractCase.caseId} audit packet candidate coverage is invalid.`,
    );
    return {
      caseId: contractCase.caseId,
      request: source.query,
      requiredClaims: contractCase.requiredClaims,
      candidateCount: candidates.length,
      candidates,
    };
  });
  assert(
    cases.length === contract.output.maximumCases &&
      totalCandidateBodyBytes <= contract.output.maximumCandidateBodyBytes,
    "The blind ground-truth audit packet exceeds its reviewed bounds.",
  );
  const packet = {
    schemaVersion: 1,
    auditId: contract.auditId,
    decisionId: contract.decisionId,
    status: "awaiting_human_review",
    source: {
      v9PreparedManifestDigest: v9Prepared.manifestDigest,
      phasePreparedManifestDigest: phasePrepared.manifestDigest,
      sourceSnapshotDigest: contract.source.sourceSnapshotDigest,
      sourceCorpusDigest: contract.source.sourceCorpusDigest,
    },
    blinding: contract.blinding,
    reviewContract: contract.review,
    authority: contract.authority,
    candidateBodyBytes: totalCandidateBodyBytes,
    cases,
  };
  assertNoOmittedKeys(packet, contract.blinding.omitFields);
  return packet;
}

export function createBlindGroundTruthAuditReviewTemplate(packet) {
  return {
    schemaVersion: 1,
    auditId: packet.auditId,
    packetDigest: auditPacketDigest(packet),
    reviewerKind: "human",
    reviewedAt: null,
    independence: {
      providerOutcomesUnavailableDuringReview: null,
      currentExpectedPathsUnavailableDuringReview: null,
      modelAssistanceUsed: null,
    },
    caseReviews: packet.cases.map((auditCase) => ({
      caseId: auditCase.caseId,
      disposition: null,
      rationale: "",
      candidateClassifications: auditCase.candidates.map((candidate) => ({
        auditCandidateId: candidate.auditCandidateId,
        classification: null,
        rationale: "",
      })),
      claimCoverage: auditCase.requiredClaims.map((claim) => ({
        claimId: claim.claimId,
        auditCandidateIds: [],
      })),
    })),
  };
}

export function assertBlindGroundTruthAuditReview(packet, review) {
  assert(
    review?.schemaVersion === 1 &&
      review.auditId === packet.auditId &&
      review.packetDigest === auditPacketDigest(packet) &&
      review.reviewerKind === "human" &&
      Number.isFinite(Date.parse(review.reviewedAt)) &&
      review.independence?.providerOutcomesUnavailableDuringReview === true &&
      review.independence?.currentExpectedPathsUnavailableDuringReview === true &&
      review.independence?.modelAssistanceUsed === false,
    "The blind ground-truth review identity or independence attestation is invalid.",
  );
  assert(
    review.caseReviews.length === packet.cases.length &&
      new Set(review.caseReviews.map((item) => item.caseId)).size === packet.cases.length,
    "The blind ground-truth review does not cover every case exactly once.",
  );
  for (const auditCase of packet.cases) {
    const caseReview = review.caseReviews.find((item) => item.caseId === auditCase.caseId);
    assert(
      caseReview !== undefined &&
        caseDispositions.includes(caseReview.disposition) &&
        typeof caseReview.rationale === "string" &&
        caseReview.rationale.trim().length > 0,
      `The ${auditCase.caseId} review disposition is invalid.`,
    );
    const candidateIds = new Set(auditCase.candidates.map((item) => item.auditCandidateId));
    assert(
      caseReview.candidateClassifications.length === candidateIds.size &&
        new Set(caseReview.candidateClassifications.map((item) => item.auditCandidateId)).size ===
          candidateIds.size &&
        caseReview.candidateClassifications.every(
          (item) =>
            candidateIds.has(item.auditCandidateId) &&
            candidateClassifications.includes(item.classification) &&
            typeof item.rationale === "string" &&
            item.rationale.trim().length > 0,
        ),
      `The ${auditCase.caseId} review does not classify every candidate exactly once.`,
    );
    const classificationById = new Map(
      caseReview.candidateClassifications.map((item) => [
        item.auditCandidateId,
        item.classification,
      ]),
    );
    assert(
      caseReview.claimCoverage.length === auditCase.requiredClaims.length &&
        new Set(caseReview.claimCoverage.map((item) => item.claimId)).size ===
          auditCase.requiredClaims.length &&
        auditCase.requiredClaims.every((claim) => {
          const coverage = caseReview.claimCoverage.find((item) => item.claimId === claim.claimId);
          return (
            coverage !== undefined &&
            coverage.auditCandidateIds.length > 0 &&
            new Set(coverage.auditCandidateIds).size === coverage.auditCandidateIds.length &&
            coverage.auditCandidateIds.every((candidateId) =>
              ["required_direct", "acceptable_alternative"].includes(
                classificationById.get(candidateId),
              ),
            )
          );
        }),
      `The ${auditCase.caseId} review does not bind every required claim to direct evidence.`,
    );
  }
  return review;
}

import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertBlindGroundTruthAuditReview,
  auditPacketDigest,
  createBlindGroundTruthAuditPacket,
  createBlindGroundTruthAuditReviewTemplate,
} from "../natural-language-evaluation/linked-evidence-provider-shadow-v9-ground-truth-audit-contract.mjs";
import {
  sha256,
  valueDigest,
} from "../natural-language-evaluation/linked-evidence-shadow-phase-a-pilot-contract.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

async function fixture() {
  const contract = JSON.parse(
    await readFile(
      resolve(
        repositoryRoot,
        "benchmarks/search/linked-evidence-provider-shadow-v9-ground-truth-audit.json",
      ),
      "utf8",
    ),
  );
  const caseDocuments = contract.cases.map((auditCase, caseIndex) =>
    Array.from({ length: 2 }, (_, candidateIndex) => {
      const body = `# Audit source ${caseIndex + 1}-${candidateIndex + 1}\n\nExact evidence.\n`;
      return {
        documentId: `doc_${String(caseIndex + 1).repeat(12)}${String(candidateIndex + 1).repeat(12)}`,
        path: `docs/audit/source-${caseIndex + 1}-${candidateIndex + 1}.md`,
        contentHash: sha256(Buffer.from(body, "utf8")),
        body,
      };
    }),
  );
  contract.cases = contract.cases.map((auditCase, index) => ({
    ...auditCase,
    expectedCandidateCount: caseDocuments[index].length,
    expectedProviderVisibleSourceBytes: caseDocuments[index].reduce(
      (sum, item) => sum + Buffer.byteLength(item.body, "utf8"),
      0,
    ),
  }));
  const corpusDigest = sha256("fixture-corpus");
  const snapshotDigest = sha256("fixture-snapshot");
  const phaseManifest = {
    corpusDigest,
    corpus: caseDocuments.flat().map(({ body: _body, ...item }) => item),
  };
  const phasePrepared = {
    manifest: phaseManifest,
    manifestDigest: valueDigest(phaseManifest),
  };
  const schedule = contract.cases.flatMap((auditCase, index) => {
    const candidates = caseDocuments[index].map((item) => ({
      documentId: item.documentId,
      contentHash: item.contentHash,
      byteCount: Buffer.byteLength(item.body, "utf8"),
      classes: ["recommendation"],
    }));
    const common = {
      caseId: auditCase.caseId,
      query: `Audit request ${index + 1}`,
      candidateEnvelopeDigest: sha256(`envelope-${index + 1}`),
      candidateCount: candidates.length,
      providerVisibleSourceBytes: auditCase.expectedProviderVisibleSourceBytes,
      candidates,
    };
    return [
      { ...common, provider: "codex" },
      { ...common, provider: "claude" },
    ];
  });
  const v9Manifest = {
    sourceSnapshotDigest: snapshotDigest,
    sourceCorpusDigest: corpusDigest,
    sourcePhaseAManifestDigest: phasePrepared.manifestDigest,
    schedule,
  };
  const v9Prepared = {
    manifest: v9Manifest,
    manifestDigest: valueDigest(v9Manifest),
  };
  contract.source = {
    ...contract.source,
    v9PreparedManifestDigest: v9Prepared.manifestDigest,
    phasePreparedManifestDigest: phasePrepared.manifestDigest,
    sourceCorpusDigest: corpusDigest,
    sourceSnapshotDigest: snapshotDigest,
  };
  return {
    contract,
    v9Prepared,
    phasePrepared,
    sourceDocuments: caseDocuments.flat(),
  };
}

function completeHumanReview(packet) {
  return {
    schemaVersion: 1,
    auditId: packet.auditId,
    packetDigest: auditPacketDigest(packet),
    reviewerKind: "human",
    reviewedAt: "2026-08-29T00:00:00.000Z",
    independence: {
      providerOutcomesUnavailableDuringReview: true,
      currentExpectedPathsUnavailableDuringReview: true,
      modelAssistanceUsed: false,
    },
    caseReviews: packet.cases.map((auditCase) => ({
      caseId: auditCase.caseId,
      disposition: "ground_truth_confirmed",
      rationale: "The full candidate envelope was independently reviewed.",
      candidateClassifications: auditCase.candidates.map((candidate) => ({
        auditCandidateId: candidate.auditCandidateId,
        classification: "required_direct",
        rationale: "This source directly supports at least one required claim.",
      })),
      claimCoverage: auditCase.requiredClaims.map((claim) => ({
        claimId: claim.claimId,
        auditCandidateIds: [auditCase.candidates[0].auditCandidateId],
      })),
    })),
  };
}

function nestedKeys(value) {
  if (Array.isArray(value)) return value.flatMap(nestedKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => [key, ...nestedKeys(item)]);
}

describe("provider-shadow v9 blind ground-truth audit", () => {
  it("builds the complete deterministic packet without provider outcomes or expected paths", async () => {
    const input = await fixture();
    const packet = createBlindGroundTruthAuditPacket(input);
    expect(packet.cases).toHaveLength(2);
    expect(packet.cases.flatMap((item) => item.candidates)).toHaveLength(4);
    expect(nestedKeys(packet)).not.toEqual(
      expect.arrayContaining(["provider", "model", "selectedDocumentIds", "expectedDocumentIds"]),
    );
    for (const auditCase of packet.cases) {
      expect(auditCase.candidates.map((item) => item.contentHash)).toEqual(
        [...auditCase.candidates.map((item) => item.contentHash)].sort(),
      );
    }
    const template = createBlindGroundTruthAuditReviewTemplate(packet);
    expect(template.packetDigest).toBe(auditPacketDigest(packet));
    expect(template.caseReviews.flatMap((item) => item.candidateClassifications)).toHaveLength(4);
  });

  it("rejects a provider-pair input mismatch before packet generation", async () => {
    const input = await fixture();
    input.v9Prepared.manifest.schedule[1].query = "Changed request";
    input.v9Prepared.manifestDigest = valueDigest(input.v9Prepared.manifest);
    input.contract.source.v9PreparedManifestDigest = input.v9Prepared.manifestDigest;
    expect(() => createBlindGroundTruthAuditPacket(input)).toThrow(/identical audit inputs/);
  });

  it("accepts only a complete independent human review bound to the exact packet", async () => {
    const packet = createBlindGroundTruthAuditPacket(await fixture());
    const review = completeHumanReview(packet);
    expect(assertBlindGroundTruthAuditReview(packet, review)).toBe(review);

    const partial = structuredClone(review);
    partial.caseReviews[0].candidateClassifications.pop();
    expect(() => assertBlindGroundTruthAuditReview(packet, partial)).toThrow(
      /classify every candidate/,
    );

    const assisted = structuredClone(review);
    assisted.independence.modelAssistanceUsed = true;
    expect(() => assertBlindGroundTruthAuditReview(packet, assisted)).toThrow(
      /independence attestation/,
    );

    const stale = structuredClone(review);
    stale.packetDigest = sha256("another packet");
    expect(() => assertBlindGroundTruthAuditReview(packet, stale)).toThrow(
      /identity or independence/,
    );
  });
});

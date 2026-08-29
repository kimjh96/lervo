import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { valueDigest } from "./linked-evidence-shadow-phase-a-pilot-contract.mjs";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export async function loadManagedCanaryCheckpointSourceEvidence(paths, contract) {
  const phase = JSON.parse(await readFile(paths.sourcePrepared, "utf8"));
  const review = JSON.parse(await readFile(paths.sourceReview, "utf8"));
  const v18 = JSON.parse(await readFile(paths.v18Prepared, "utf8"));
  if (
    phase.manifestDigest !== contract.sourcePopulation.phaseAManifestDigest ||
    valueDigest(phase.manifest) !== phase.manifestDigest ||
    phase.manifest.corpusDigest !== contract.sourcePopulation.sourceCorpusDigest ||
    phase.manifest.corpus.length !== contract.sourcePopulation.registeredDocumentCount ||
    review.status !== "passed" ||
    v18.manifestDigest !== contract.sourcePopulation.sourceProviderShadowManifestDigest ||
    valueDigest(v18.manifest) !== v18.manifestDigest ||
    v18.manifest.providerCalls !== 0
  ) {
    throw new Error("managed_canary_source_evidence_drift");
  }
  if (contract.selection.kind !== "reviewed_provider_shadow_v18_projection") {
    return { phase, v18, v18Review: null, v18Observations: [] };
  }
  const v18ReviewBytes = await readFile(paths.v18Review);
  const v18Review = JSON.parse(v18ReviewBytes.toString("utf8"));
  if (
    sha256(v18ReviewBytes) !== contract.sourcePopulation.sourceProviderShadowReviewFileDigest ||
    v18Review.status !== "passed" ||
    v18Review.passed !== true ||
    v18Review.preparedManifestDigest !== v18.manifestDigest ||
    v18Review.observationCount !== 32
  ) {
    throw new Error("managed_canary_frozen_selection_review_drift");
  }
  const observationFiles = (await readdir(paths.v18Observations))
    .filter((item) => /^\d{2}-(?:codex|claude)\.json$/u.test(item))
    .sort();
  const v18Observations = [];
  for (const file of observationFiles) {
    const bytes = await readFile(resolve(paths.v18Observations, file));
    v18Observations.push({
      fileDigest: sha256(bytes),
      value: JSON.parse(bytes.toString("utf8")),
    });
  }
  if (v18Observations.length !== 32) {
    throw new Error("managed_canary_frozen_selection_observation_set_drift");
  }
  return { phase, v18, v18Review, v18Observations };
}

export function prepareManagedCanarySelectionEvidence(input) {
  if (input.contract.selection.kind === "deterministic_all_current_linked_candidates_v1") {
    const selected = input.projection.candidates.map(({ documentId, contentHash }) => ({
      documentId,
      contentHash,
    }));
    if (
      selected.length < input.contract.selection.minimumSelectionsPerRun ||
      selected.length > input.contract.selection.maximumCandidates
    ) {
      throw new Error("managed_canary_deterministic_selection_count_invalid");
    }
    return {
      kind: input.contract.selection.kind,
      policyId: input.contract.selection.policyId,
      policyDigest: valueDigest({
        kind: input.contract.selection.kind,
        policyId: input.contract.selection.policyId,
        rule: input.contract.selection.rule,
        maximumCandidates: input.contract.selection.maximumCandidates,
      }),
      sourceProjectionDigest: input.projection.projectionDigest,
      projectedSelectionDigest: valueDigest(selected),
      projectedSelectionCount: selected.length,
      selected,
    };
  }
  if (input.contract.selection.kind !== "reviewed_provider_shadow_v18_projection") return null;
  const matching = input.source.v18Observations.filter(
    (item) =>
      item.value.sourceSampleId === input.scheduleItem.sourceSampleId &&
      item.value.provider === input.scheduleItem.provider,
  );
  if (matching.length !== 1) throw new Error("managed_canary_frozen_selection_missing");
  const evidence = matching[0];
  const observation = evidence.value;
  const sourceItem = input.sourceItem;
  if (
    observation.recordKind !== "linked_evidence_provider_shadow_observation.v18" ||
    observation.status !== "observed" ||
    observation.terminalStatus !== "completed" ||
    observation.failureCode !== null ||
    observation.pilotId !== input.contract.sourcePopulation.sourceProviderShadowPilotId ||
    observation.sampleId !== sourceItem.sampleId ||
    observation.model !== input.scheduleItem.model ||
    observation.candidateEnvelopeDigest !== sourceItem.candidateEnvelopeDigest ||
    valueDigest(observation.candidates) !== valueDigest(sourceItem.candidates) ||
    !Array.isArray(observation.shadowSelected) ||
    observation.shadowSelectedCount !== observation.shadowSelected.length
  ) {
    throw new Error("managed_canary_frozen_selection_observation_drift");
  }
  const observationCandidates = new Map(
    observation.candidates.map((item) => [item.documentId, item]),
  );
  const projectionCandidates = new Map(
    input.projection.candidates.map((item) => [item.documentId, item]),
  );
  for (const candidate of input.projection.candidates) {
    const observed = observationCandidates.get(candidate.documentId);
    if (observed === undefined || observed.contentHash !== candidate.contentHash) {
      throw new Error("managed_canary_frozen_selection_projection_drift");
    }
  }
  const selected = observation.shadowSelected
    .filter((item) => projectionCandidates.has(item.documentId))
    .map((item) => {
      const candidate = projectionCandidates.get(item.documentId);
      if (candidate.contentHash !== item.contentHash) {
        throw new Error("managed_canary_frozen_selection_version_drift");
      }
      return { documentId: item.documentId, contentHash: item.contentHash };
    });
  return {
    kind: input.contract.selection.kind,
    sourcePilotId: observation.pilotId,
    sourcePreparedManifestDigest: input.source.v18.manifestDigest,
    sourceReviewFileDigest: input.contract.sourcePopulation.sourceProviderShadowReviewFileDigest,
    sourceObservationRecordId: observation.recordId,
    sourceObservationFileDigest: evidence.fileDigest,
    sourceCandidateEnvelopeDigest: observation.candidateEnvelopeDigest,
    sourceSelectedDigest: valueDigest(observation.shadowSelected),
    projectedSelectionDigest: valueDigest(selected),
    sourceSelectedCount: observation.shadowSelected.length,
    projectedSelectionCount: selected.length,
    selected,
  };
}

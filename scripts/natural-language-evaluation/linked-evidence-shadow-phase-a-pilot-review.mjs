import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { LocalLinkedEvidenceShadowStore } from "../../packages/search-local/dist/index.js";

import { stableJson } from "./linked-evidence-shadow-phase-a-pilot-contract.mjs";
import { projectPhaseAPilotSchedule } from "./linked-evidence-shadow-phase-a-pilot-projection.mjs";
import { loadPreparedPhaseAPilot } from "./linked-evidence-shadow-phase-a-pilot-workspace.mjs";

async function ownerJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export function samePhaseAPilotProjection(observation, expected) {
  return (
    [
      "recommendationCount",
      "candidateCount",
      "retainedCount",
      "ignoredCount",
      "truncated",
      "retainedByteCount",
      "projectionDigest",
      "sourceSnapshotId",
    ].every((key) => observation[key] === expected[key]) &&
    stableJson(observation.retained) === stableJson(expected.retained)
  );
}

export async function reviewPhaseAPilot(repositoryRoot, contractPath) {
  const prepared = await loadPreparedPhaseAPilot(repositoryRoot, contractPath);
  const receiptSet = JSON.parse(await readFile(prepared.paths.receipts, "utf8"));
  const observations = await (
    await LocalLinkedEvidenceShadowStore.open(prepared.paths.repository)
  ).list();
  const replay = await projectPhaseAPilotSchedule({
    pilotRoot: prepared.paths.repository,
    projectId: prepared.manifest.projectId,
    schedule: prepared.manifest.schedule,
  });
  const observationByRun = new Map(observations.map((item) => [item.runId, item]));
  const replayByOrdinal = new Map(replay.map((item) => [item.ordinal, item]));
  const mismatches = [];
  for (const receipt of receiptSet.receipts) {
    const observation = observationByRun.get(receipt.runId);
    const expected = replayByOrdinal.get(receipt.ordinal);
    if (
      observation === undefined ||
      expected === undefined ||
      !samePhaseAPilotProjection(observation, expected)
    ) {
      mismatches.push({ ordinal: receipt.ordinal, runId: receipt.runId });
    }
  }
  const forbiddenValues = [
    prepared.paths.repository,
    ...prepared.manifest.schedule.map((run) => run.query),
    ...prepared.manifest.corpus.map((item) => item.path),
  ];
  const privacyFailures = observations.flatMap((observation) => {
    const serialized = JSON.stringify(observation);
    return forbiddenValues.some((value) => serialized.includes(value))
      ? [{ recordId: observation.recordId }]
      : [];
  });
  const unavailable = observations.filter((item) => item.status === "unavailable");
  const nonempty = observations.filter((item) => item.retainedCount > 0);
  const truncations = observations
    .filter((item) => item.truncated)
    .map((item) => ({
      runId: item.runId,
      candidateCount: item.candidateCount,
      retainedCount: item.retainedCount,
      retainedByteCount: item.retainedByteCount,
    }));
  const providerInvocationCount = receiptSet.receipts.reduce(
    (total, receipt) => total + receipt.providerInvocationCount,
    0,
  );
  const publicationBlockedCount = receiptSet.receipts.filter(
    (receipt) => receipt.writingPublicationStatus === "blocked",
  ).length;
  const publicationAllowedCount = receiptSet.receipts.filter(
    (receipt) => receipt.writingPublicationStatus === "allowed",
  ).length;
  const gates = prepared.loaded.contract.shadowGate;
  const maximumProviderInvocations =
    prepared.loaded.contract.managedRun.maximumProviderInvocations ??
    prepared.loaded.contract.managedRun.maximumProviderTaskCalls;
  const passed =
    receiptSet.receipts.length === gates.minimumEligibleRuns &&
    observations.length === gates.minimumEligibleRuns &&
    nonempty.length >= gates.minimumNonemptyProjections &&
    unavailable.length <= gates.maximumUnavailableObservations &&
    mismatches.length <= gates.maximumReplayMismatches &&
    privacyFailures.length <= gates.maximumPrivacyFailures &&
    providerInvocationCount <= maximumProviderInvocations;
  const review = {
    schemaVersion: 1,
    pilotId: prepared.manifest.pilotId,
    preparedManifestDigest: prepared.manifestDigest,
    reviewedAt: new Date().toISOString(),
    status: passed ? "passed" : "failed",
    eligibleRunCount: receiptSet.receipts.length,
    observationCount: observations.length,
    nonemptyProjectionCount: nonempty.length,
    unavailableCount: unavailable.length,
    replayMismatchCount: mismatches.length,
    privacyFailureCount: privacyFailures.length,
    providerInvocationCount,
    publicationAllowedCount,
    publicationBlockedCount,
    truncationCount: truncations.length,
    truncations,
    mismatches,
    privacyFailures,
  };
  await ownerJson(prepared.paths.review, review);
  if (!passed) throw new Error("The phase-A pilot review failed a pre-registered gate.");
  return review;
}

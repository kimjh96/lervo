import { inspectEventWriterCoordinate } from "@lervo/project";
import { loadRepositoryKnowledgePolicy } from "@lervo/repository-knowledge";
import { canonicalHash } from "@lervo/search";
import {
  withRepositoryQualityObservation,
  repositoryQualityBuild,
  type RepositoryQualityInput,
} from "./repository-quality-context.js";
import { correctRepositoryContextOutcome } from "./repository-context-correction.js";
import { recordContextQualityVerification } from "./context-quality-recording.js";
import { verifyHostArtifact } from "./host-context-artifact.js";
import { readHostContextArtifact } from "./host-context-artifact-reading.js";
import type {
  HostContextOutcomeInput,
  HostContextOutcomeReport,
} from "./host-context-outcome-types.js";

/** Post-turn verification is a new current-plan observation, never a retroactive delivery receipt. */
export async function observeHostContextOutcomes(
  source: HostContextOutcomeInput,
): Promise<HostContextOutcomeReport> {
  if (source.artifacts.length > 64)
    return {
      status: "unavailable",
      completionAllowed: !source.policy,
      artifactCount: source.artifacts.length,
      observedCount: 0,
      reason: "capacity",
      outcomes: [],
    };
  const input = {
    ...source,
    ...(source.coordinates ? { coordinates: { ...source.coordinates } } : {}),
    task: structuredClone(source.task),
    artifacts: source.artifacts.map((artifact) => ({
      ...artifact,
      ...(artifact.kind === "repository" && artifact.baselineBytes
        ? { baselineBytes: new Uint8Array(artifact.baselineBytes) }
        : {}),
    })),
  };
  const report: HostContextOutcomeReport = {
    status: "unavailable",
    completionAllowed: !input.policy,
    artifactCount: input.artifacts.length,
    observedCount: 0,
    reason: "observation_unavailable",
    outcomes: [],
  };
  if (input.artifacts.length === 0) return report;
  try {
    if (
      !input.policy &&
      (await inspectEventWriterCoordinate(input.repositoryRoot)).coordinate
        .selectedEventSchemaVersion !== 6
    )
      return { ...report, status: "writer_not_active", reason: "writer_not_active" };
    const language = (await loadRepositoryKnowledgePolicy(input.repositoryRoot)).publication
      .language;
    const preparation: RepositoryQualityInput = {
      repositoryRoot: input.repositoryRoot,
      origin: input.origin,
      task: input.task,
      instructionMaximumBytes: 12288,
      evidenceMaximumBytes: 0,
      retrieval: "not_run",
      candidates: [],
      sourceSnapshotId: `snapshot_${canonicalHash({ task: input.task, phase: "post_turn" }).slice(7, 39)}`,
      retrievalBuildId: repositoryQualityBuild,
      recordObservation: true,
      ...(input.coordinates ? { recordingCoordinates: input.coordinates } : {}),
    };
    const { preparation: prepared, value: firstReading } = await withRepositoryQualityObservation(
      preparation,
      async (current) =>
        current.result.plan && current.observationBindings
          ? readHostContextArtifact(
              input,
              preparation,
              input.artifacts[0]!,
              current.result.plan.planDigest,
              language,
            )
          : null,
    );
    const plan = prepared.result.plan;
    if (!plan || !prepared.observationBindings) return report;
    report.completionAllowed = true;
    for (const [artifactIndex, artifact] of input.artifacts.entries()) {
      let required = Boolean(input.policy);
      let correction: HostContextOutcomeReport["outcomes"][number]["correction"] = null;
      try {
        const reading =
          artifactIndex === 0
            ? firstReading
            : await readHostContextArtifact(
                input,
                preparation,
                artifact,
                plan.planDigest,
                language,
              );
        if (!reading) throw new Error("Context preparation is unavailable.");
        required = reading.required;
        if (reading.status === "unavailable") throw reading.error;
        const contract = reading.contract;
        let observation = reading.observation;

        if (contract.correction && observation.disposition === "failed") {
          // Retain the failed exact artifact before any admitted effect.
          const beforeRecording = await recordContextQualityVerification({
            repositoryRoot: input.repositoryRoot,
            requestId: prepared.result.requestId,
            projectId: prepared.observationBindings.projectId,
            policySetDigest: prepared.observationBindings.policySetDigest,
            observation,
            ...(input.coordinates ? { coordinates: input.coordinates } : {}),
          });
          if (beforeRecording.status !== "recorded")
            throw new Error("Correction evidence is unavailable.");
          if (
            prepared.instructions?.report.status !== "complete" ||
            input.effects !== "owner_controlled" ||
            artifact.kind !== "repository" ||
            !input.policy?.verifyAfterCorrection
          )
            throw new TypeError(
              "No admitted correction and project-verification owner is available.",
            );
          correction = await correctRepositoryContextOutcome(
            {
              preparation,
              artifactPath: artifact.path,
              planDigest: plan.planDigest,
              definition: contract.definition,
              isPublication: contract.isPublication,
              ...(artifact.baselineBytes ? { baselineBytes: artifact.baselineBytes } : {}),
              ...(contract.evaluator ? { evaluator: contract.evaluator } : {}),
              ...(contract.taskEvaluator ? { taskEvaluator: contract.taskEvaluator } : {}),
              ...(contract.authorizeLanguageException
                ? { authorizeLanguageException: contract.authorizeLanguageException }
                : {}),
            },
            contract.correction,
          );
          if (correction.applied !== false) await input.policy.verifyAfterCorrection();
          if (correction.status !== "corrected" && correction.status !== "unchanged")
            report.completionAllowed = false;
          if (correction.observation) {
            observation = await verifyHostArtifact({
              preparation,
              planDigest: plan.planDigest,
              artifact: { ...artifact, expectedDigest: correction.observation.artifactDigest },
              contract,
            });
          }
        }
        const recording = await recordContextQualityVerification({
          repositoryRoot: input.repositoryRoot,
          requestId: prepared.result.requestId,
          projectId: prepared.observationBindings.projectId,
          policySetDigest: prepared.observationBindings.policySetDigest,
          observation,
          ...(input.coordinates ? { coordinates: input.coordinates } : {}),
        });
        report.outcomes.push({ artifactIndex, observation, recording, correction });
        report.observedCount++;
        if (
          required &&
          (prepared.instructions?.report.status !== "complete" ||
            observation.disposition !== "passed" ||
            recording.status !== "recorded" ||
            prepared.recording?.status !== "recorded")
        )
          report.completionAllowed = false;
      } catch {
        report.outcomes.push({ artifactIndex, observation: null, recording: null, correction });
        if (required || correction?.applied !== undefined) report.completionAllowed = false;
      }
    }
    report.status = report.observedCount === report.artifactCount ? "observed" : "unavailable";
    report.reason = report.status === "observed" ? "completed" : "observation_unavailable";
    return report;
  } catch {
    return report;
  }
}

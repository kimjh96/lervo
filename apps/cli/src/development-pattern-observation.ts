import type { ProjectStorage } from "@lervo/project-storage";
import type { EventDraft } from "@lervo/event-contract";
import {
  canonicalJson,
  sha256,
  stableId,
  type DevelopmentPatternCandidate,
} from "@lervo/repository-knowledge";

import {
  allPatternEvents,
  patternArtifactId,
  patternEventDraft,
  projectPatterns,
  writePatternProjection,
  type PatternProjection,
} from "./development-pattern-storage.js";

export interface PreparedDevelopmentPatternObservation {
  patternId: string;
  eventDrafts: EventDraft[];
}

export async function prepareDevelopmentPatternObservation(input: {
  repositoryRoot: string;
  storage: ProjectStorage;
  provider: "codex" | "claude";
  candidate: DevelopmentPatternCandidate;
  content: string;
  contentHash: string;
  observedAt: string;
}): Promise<PreparedDevelopmentPatternObservation> {
  const stored = await input.storage.artifacts.put(input.content);
  if (stored.contentHash !== input.contentHash) throw new Error("Pattern candidate CAS mismatch.");
  const current = projectPatterns(allPatternEvents(input.storage)).find(
    (item) => item.patternId === input.candidate.patternId,
  );
  const eventDrafts = [
    patternEventDraft(
      {
        type: "development.pattern.observed",
        occurredAt: input.observedAt,
        payload: {
          patternId: input.candidate.patternId,
          observationId: stableId("dpobs", {
            patternId: input.candidate.patternId,
            provider: input.provider,
            observedAt: input.observedAt,
          }),
          provider: input.provider,
          sourceSnapshotId: input.candidate.sourceSnapshotId,
          sourceSnapshotHash: input.candidate.sourceSnapshotHash,
          evidenceDigest: sha256(
            canonicalJson(input.candidate.occurrences.map((item) => item.evidenceDigest)),
          ),
          occurrenceCount: input.candidate.occurrences.length,
          observedAt: input.observedAt,
        },
      },
      input.storage.manifest.projectId,
    ),
  ];
  if (current === undefined) {
    eventDrafts.push(
      patternEventDraft(
        {
          type: "development.pattern.transitioned",
          occurredAt: input.observedAt,
          payload: {
            transitionId: stableId("dptr", {
              patternId: input.candidate.patternId,
              to: "candidate",
            }),
            patternId: input.candidate.patternId,
            fromState: "observed",
            toState: "candidate",
            candidateArtifactId: patternArtifactId(input.contentHash),
            candidateContentHash: input.contentHash,
            reviewArtifactId: null,
            reviewContentHash: null,
            targetKind: input.candidate.target.kind,
            approvalHash: null,
            occurredAt: input.observedAt,
          },
        },
        input.storage.manifest.projectId,
      ),
    );
  } else if (current.candidateContentHash !== input.contentHash) {
    throw new Error("Pattern identity collision with different candidate bytes.");
  }
  return { patternId: input.candidate.patternId, eventDrafts };
}

export async function projectDevelopmentPatternObservation(input: {
  repositoryRoot: string;
  storage: ProjectStorage;
  patternId: string;
}): Promise<PatternProjection> {
  const patterns = projectPatterns(allPatternEvents(input.storage));
  await writePatternProjection(input.repositoryRoot, patterns);
  return patterns.find((item) => item.patternId === input.patternId)!;
}

export async function recordDevelopmentPatternObservation(
  input: Parameters<typeof prepareDevelopmentPatternObservation>[0],
): Promise<PatternProjection> {
  const prepared = await prepareDevelopmentPatternObservation(input);
  input.storage.events.transact((transaction) => {
    for (const draft of prepared.eventDrafts) transaction.append(draft);
  });
  return projectDevelopmentPatternObservation({
    repositoryRoot: input.repositoryRoot,
    storage: input.storage,
    patternId: prepared.patternId,
  });
}

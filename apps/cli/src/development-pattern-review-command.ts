import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { openProjectStorage } from "@lervo/project-storage";
import {
  assertDevelopmentPatternSupersession,
  createDevelopmentPatternReview,
  developmentPatternReviewTransitions,
  sha256,
  stableId,
  type DevelopmentPatternCandidate,
  type DevelopmentPatternReview,
} from "@lervo/repository-knowledge";

import {
  allPatternEvents,
  appendPatternEvent,
  patternArtifactId,
  patternArtifactJson,
  projectPatterns,
  writePatternProjection,
} from "./development-pattern-storage.js";
import type { CliIo } from "./types.js";

export async function runDevelopmentPatternReviewCommand(
  args: string[],
  io: CliIo,
  requiredTargetKind?: string,
): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      decision: { type: "string" },
      reviewer: { type: "string" },
      approval: { type: "string" },
      "superseded-by": { type: "string" },
      root: { type: "string" },
      json: { type: "boolean" },
    },
  });
  if (parsed.positionals.length !== 1) throw new Error("Pattern review requires one pattern ID.");
  if (!(["accept", "reject", "defer", "supersede"] as unknown[]).includes(parsed.values.decision))
    throw new Error("Pattern review decision is invalid.");
  const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
  const storage = await openProjectStorage(repositoryRoot);
  try {
    const currentPatterns = projectPatterns(allPatternEvents(storage));
    const pattern = currentPatterns.find((item) => item.patternId === parsed.positionals[0]);
    if (pattern?.candidateContentHash === null || pattern?.candidateContentHash === undefined)
      throw new Error("Pattern candidate was not found.");
    if (requiredTargetKind !== undefined && pattern.targetKind !== requiredTargetKind)
      throw new Error(`The pattern target must be ${requiredTargetKind}.`);
    if (parsed.values.approval !== pattern.candidateContentHash)
      throw new Error("Review approval must equal the exact candidate content hash.");
    const now = new Date().toISOString();
    const result = createDevelopmentPatternReview({
      patternId: pattern.patternId,
      candidateContentHash: pattern.candidateContentHash,
      decision: parsed.values.decision as DevelopmentPatternReview["decision"],
      reviewer: parsed.values.reviewer ?? "",
      ...(parsed.values["superseded-by"] === undefined
        ? {}
        : { supersededByPatternId: parsed.values["superseded-by"] }),
      reviewedAt: now,
    });
    const transitions = developmentPatternReviewTransitions({
      currentState: pattern.state,
      decision: result.review.decision,
    });
    if (result.review.supersededByPatternId !== null) {
      const replacement = currentPatterns.find(
        (item) => item.patternId === result.review.supersededByPatternId,
      );
      const [currentCandidate, replacementCandidate] = await Promise.all([
        patternArtifactJson<DevelopmentPatternCandidate>(storage, pattern.candidateContentHash),
        replacement?.candidateContentHash === null ||
        replacement?.candidateContentHash === undefined
          ? undefined
          : patternArtifactJson<DevelopmentPatternCandidate>(
              storage,
              replacement.candidateContentHash,
            ),
      ]);
      assertDevelopmentPatternSupersession({
        current: {
          patternId: pattern.patternId,
          state: pattern.state,
          targetKind: currentCandidate.target.kind,
          targetPath: currentCandidate.target.path,
        },
        replacement:
          replacement === undefined || replacementCandidate === undefined
            ? undefined
            : {
                patternId: replacement.patternId,
                state: replacement.state,
                targetKind: replacementCandidate.target.kind,
                targetPath: replacementCandidate.target.path,
              },
      });
    }
    const stored = await storage.artifacts.put(result.content);
    if (stored.contentHash !== result.contentHash) throw new Error("Pattern review CAS mismatch.");
    const common = {
      patternId: pattern.patternId,
      candidateArtifactId: pattern.candidateArtifactId,
      candidateContentHash: pattern.candidateContentHash,
      reviewArtifactId: patternArtifactId(result.contentHash),
      reviewContentHash: result.contentHash,
      supersededByPatternId: result.review.supersededByPatternId,
      targetKind: pattern.targetKind,
      approvalHash: sha256(pattern.candidateContentHash),
      occurredAt: now,
    };
    for (const [index, transition] of transitions.entries())
      appendPatternEvent(storage, {
        type: "development.pattern.transitioned",
        occurredAt: now,
        payload: {
          ...common,
          transitionId: stableId("dptr", { patternId: pattern.patternId, transition, index, now }),
          ...transition,
        },
      });
    const patterns = projectPatterns(allPatternEvents(storage));
    await writePatternProjection(repositoryRoot, patterns);
    const output = patterns.find((item) => item.patternId === pattern.patternId)!;
    io.stdout(
      `${parsed.values.json ? JSON.stringify(output, null, 2) : `Development pattern ${output.patternId}: ${output.state}.`}\n`,
    );
    return 0;
  } finally {
    await storage.close();
  }
}

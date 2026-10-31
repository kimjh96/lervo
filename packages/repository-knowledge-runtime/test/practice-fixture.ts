import { sha256, type ReusablePractice } from "@lervo/repository-knowledge";
import type { InstructionCaptureContext } from "../src/instruction-capture-assessment.js";
import type { PracticeWorkRecord } from "../src/practice-state.js";

export const practice: ReusablePractice = {
  name: "bounded-check",
  description: "Verify package changes with observed outcomes.",
  goal: "Verify a package change.",
  whenToUse: ["A package changes."],
  whenNotToUse: ["Only prose changes."],
  inputs: ["Package paths."],
  preconditions: ["A verification command exists."],
  steps: ["Run the package check."],
  confirmation: ["Observe a zero exit status."],
  stopConditions: ["Stop if verification is unavailable."],
  verified: ["The package check passed."],
  assumptions: [],
  sourcePaths: [],
};
export const now = new Date("2026-10-31T12:00:00Z");
export const work: PracticeWorkRecord = {
  workDigest: sha256("ordinary directive work"),
  contextEventId: "evt_context_practice",
  turnEventId: "evt_turn_practice",
  provider: "claude",
  sessionDigest: sha256("session"),
  turnDigest: sha256("turn"),
  observedAt: "2026-10-31T11:00:00Z",
  revisionBefore: sha256("before"),
  revisionAfter: sha256("after"),
  stopCommit: null,
  changedFiles: [],
  reply: "Implemented the package change.",
  steps: [
    {
      entryId: sha256("step"),
      kind: "Bash",
      executable: "pnpm",
      paths: [],
      outcome: "passed",
      verification: true,
    },
  ],
  outcome: "passed",
  complete: true,
};
export function practiceContext(root: string): InstructionCaptureContext {
  return {
    storage: {
      paths: { repositoryRoot: root },
      manifest: { projectId: "prj_practice_fixture" },
      writableEventSchemaVersion: 7,
      events: {
        get: () => null,
        list: () => [],
        append: () => {
          throw new Error("Schema 8 is not active.");
        },
      },
    } as unknown as InstructionCaptureContext["storage"],
    provider: "claude",
    signal: new AbortController().signal,
    liveWorkPending: async () => false,
    now: () => now,
  };
}

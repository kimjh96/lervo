import {
  prepareAppliedInstructionContext,
  prepareRepositoryQualityContext,
  repositoryQualityBuild,
} from "@lervo/repository-context";
import { capContextBytes } from "./terminal-context-budget.js";

/** Keep complete owner clauses ahead of optional workstream and retrieved evidence. */
export async function prepareTerminalInstructionPreamble(input: {
  root: string;
  preamble: string;
  maximumBytes: number;
  prompt: string;
  sourceSnapshotId: string;
}) {
  const preamble = capContextBytes(input.preamble, input.maximumBytes - 256);
  const quality = await prepareRepositoryQualityContext({
    recordObservation: true,
    repositoryRoot: input.root,
    origin: "terminal",
    task: {
      intent: input.prompt,
      continuation: "",
      targetPaths: [],
      artifactKinds: [],
      requestedActions: [],
      conversationLocale: null,
      publicationLocale: null,
      retrievalLanguages: [],
    },
    instructionMaximumBytes: Math.max(0, input.maximumBytes - Buffer.byteLength(preamble) - 256),
    evidenceMaximumBytes: 0,
    retrieval: "not_run",
    candidates: [],
    sourceSnapshotId: input.sourceSnapshotId,
    retrievalBuildId: repositoryQualityBuild,
  });
  const prepared =
    quality.instructions ??
    (await prepareAppliedInstructionContext({
      repositoryRoot: input.root,
      expectedPaths: null,
      maximumBytes: Math.max(0, input.maximumBytes - Buffer.byteLength(preamble) - 256),
    }));
  const report = prepared.report;
  const notice =
    report.status === "complete"
      ? `Applied owner rules: ${report.preparedCount} complete clauses prepared; provider delivery unobserved.`
      : `Applied owner rules ${report.status}: ${report.preparedCount} prepared; ${report.omittedCount ?? "unknown"} omitted. Read applicable full rules in docs/instructions/generated/ before changing files; preserve their scope and exceptions.`;
  return {
    preamble: [preamble, notice, ...(prepared.context ? [prepared.context] : [])].join("\n\n"),
    report,
    quality: quality.result,
  };
}

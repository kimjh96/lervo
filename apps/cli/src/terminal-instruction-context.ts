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
  /** Optional complete lines, such as ADR-0538 find pointers, added only after owner rules fit. */
  optionalLines?: readonly string[];
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
  const context = [preamble, notice, ...(prepared.context ? [prepared.context] : [])].join("\n\n");
  // Owner rules are packed first; optional lines are added whole, in order, while they fit.
  const lines = input.optionalLines ?? [];
  let optionalLineCount = 0;
  while (
    optionalLineCount < lines.length &&
    Buffer.byteLength(`${context}\n\n${lines.slice(0, optionalLineCount + 1).join("\n")}`) <=
      input.maximumBytes
  )
    optionalLineCount += 1;
  return {
    preamble:
      optionalLineCount === 0
        ? context
        : `${context}\n\n${lines.slice(0, optionalLineCount).join("\n")}`,
    optionalLineCount,
    report,
    quality: quality.result,
  };
}

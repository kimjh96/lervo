import {
  prepareAppliedInstructionContext,
  prepareRepositoryQualityContext,
  repositoryQualityBuild,
} from "@lervo/repository-context";
import {
  listGeneratedDurableInstructions,
  type GeneratedDurableInstruction,
} from "@lervo/repository-knowledge";
import { capContextBytes } from "./terminal-context-budget.js";

const NOTICE_RESERVE_BYTES = 256;
const MAXIMUM_OMITTED_TITLES_BYTES = 600;

/**
 * Names owner rules whose bodies did not fit, so a crowded prompt still carries every rule. Titles
 * come from reviewed rule files, never prompt text.
 */
function omittedRuleTitles(rules: readonly GeneratedDurableInstruction[], unlisted: number) {
  const line = `Owner rules omitted for space still apply; follow them (full text in docs/instructions/generated/): ${rules
    .map((rule) => rule.title.replace(/\.$/u, ""))
    .join("; ")}${unlisted > 0 ? `; +${unlisted} more` : ""}.`;
  return capContextBytes(line, MAXIMUM_OMITTED_TITLES_BYTES);
}

/** Keep complete owner clauses ahead of optional workstream and retrieved evidence. */
export async function prepareTerminalInstructionPreamble(input: {
  root: string;
  preamble: string;
  maximumBytes: number;
  prompt: string;
  sourceSnapshotId: string;
}) {
  const applied = await listGeneratedDurableInstructions(input.root).catch(() => ({
    rules: [],
    totalCount: 0,
  }));
  const unlisted = applied.totalCount - applied.rules.length;
  // Reserve the line naming every rule first: bodies that do not fit still leave their titles.
  const reserve =
    NOTICE_RESERVE_BYTES +
    (applied.totalCount === 0
      ? 0
      : Buffer.byteLength(omittedRuleTitles(applied.rules, unlisted)) + 2);
  const preamble = capContextBytes(input.preamble, input.maximumBytes - reserve);
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
    instructionMaximumBytes: Math.max(
      0,
      input.maximumBytes - Buffer.byteLength(preamble) - reserve,
    ),
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
      maximumBytes: Math.max(0, input.maximumBytes - Buffer.byteLength(preamble) - reserve),
    }));
  const report = prepared.report;
  const notice =
    report.status === "complete"
      ? `Applied owner rules: ${report.preparedCount} complete clauses prepared; provider delivery unobserved.`
      : `Applied owner rules ${report.status}: ${report.preparedCount} prepared; ${report.omittedCount ?? "unknown"} omitted. Read applicable full rules in docs/instructions/generated/ before changing files; preserve their scope and exceptions.`;
  const preparedPaths = new Set(prepared.preparedPaths);
  const omitted = applied.rules.filter((rule) => !preparedPaths.has(rule.path));
  const titles =
    omitted.length === 0 && unlisted <= 0
      ? null
      : omittedRuleTitles(omitted, Math.max(0, unlisted));
  return {
    preamble: [
      preamble,
      notice,
      ...(titles === null ? [] : [titles]),
      ...(prepared.context ? [prepared.context] : []),
    ].join("\n\n"),
    report,
    quality: quality.result,
  };
}

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
/**
 * ADR-0635: the intent for a prompt with no text, such as an image-only message. The quality
 * request requires a non-empty intent; without one, every such prompt recorded a contract failure.
 */
const PROMPT_WITHOUT_TEXT_INTENT = "(prompt without text)";
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
  /** Optional complete lines, such as ADR-0538 find pointers, added only after owner rules fit. */
  optionalLines?: readonly string[];
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
      intent: input.prompt.trim() === "" ? PROMPT_WITHOUT_TEXT_INTENT : input.prompt,
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
  const context = [
    preamble,
    notice,
    ...(titles === null ? [] : [titles]),
    ...(prepared.context ? [prepared.context] : []),
  ].join("\n\n");
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

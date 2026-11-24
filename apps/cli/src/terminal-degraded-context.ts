import type { PackedInstructionSection } from "@lervo/context";
import { prepareAppliedInstructionContext } from "@lervo/repository-context";
import { openProjectStorage } from "@lervo/project-storage";
import { loadRepositoryKnowledgePolicy } from "@lervo/repository-knowledge";

import { TERMINAL_AGENTS_POINTER } from "./terminal-compact-format.js";
import { capContextBytes } from "./terminal-context-budget.js";
import { TERMINAL_HOOK_BUDGET_MS, withinTerminalDeadline } from "./terminal-hook-budget.js";
import { terminalPublicationInstruction } from "./terminal-publication-instruction.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";

/** Independent local reads; no snapshot, freshness check, quality recording, or provider call. */
export async function prepareTerminalBaseContext(
  root: string,
  remainingBudgetDeadline = performance.now() + TERMINAL_HOOK_BUDGET_MS,
): Promise<string[]> {
  return (await prepareTerminalBaseParts(root, remainingBudgetDeadline, 2048)).lines;
}

/** The base lines and the owner-rule sections packed into them, within `ruleBytes`. */
export async function prepareTerminalBaseParts(
  root: string,
  remainingBudgetDeadline: number,
  ruleBytes: number,
): Promise<{ lines: string[]; rules: PackedInstructionSection[] }> {
  const deadline = Math.min(
    remainingBudgetDeadline,
    performance.now() + TERMINAL_HOOK_BUDGET_MS / 6,
  );
  const [publication, instructions, workstream] = await Promise.allSettled([
    withinTerminalDeadline(deadline, async () =>
      terminalPublicationInstruction(
        (await loadRepositoryKnowledgePolicy(root)).publication.language,
      ),
    ),
    withinTerminalDeadline(deadline, () =>
      prepareAppliedInstructionContext({
        repositoryRoot: root,
        expectedPaths: null,
        maximumBytes: ruleBytes,
      }),
    ),
    withinTerminalDeadline(deadline, async () => {
      const storage = await openProjectStorage(root);
      try {
        return await verifiedCurrentWorkstream(storage);
      } finally {
        await storage.close();
      }
    }),
  ]);
  const lines = [TERMINAL_AGENTS_POINTER];
  let rules: PackedInstructionSection[] = [];
  if (publication.status === "fulfilled") lines.push(publication.value);
  if (instructions.status === "fulfilled") {
    const { report, context, sections } = instructions.value;
    rules = sections;
    lines.push(
      `Applied owner rules: ${report.status}; ${report.preparedCount} complete clauses prepared; provider delivery unobserved.`,
    );
    if (context) lines.push(context);
  }
  if (workstream.status === "fulfilled" && workstream.value !== null) {
    const snapshot = workstream.value;
    lines.push(
      `Lervo workstream: ${capContextBytes(snapshot.title, 200)} (revision ${snapshot.revision}).`,
      "Workstream freshness was not inspected; next actions, blockers, decisions, and approvals are not presented as current.",
      "If this turn changes repository-authored bytes, record the next bounded revision with `lervo workstream update --actor agent --provider <current-provider> --patch <json> --apply-now`; never ask the user to run bookkeeping.",
    );
  }
  return { lines, rules };
}

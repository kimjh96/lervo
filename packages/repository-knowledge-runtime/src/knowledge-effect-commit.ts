import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { CONVERGENCE_HOST_TRAILER, knowledgeOutputCommitGrant } from "./convergence-owner-fence.js";
import {
  KNOWLEDGE_OUTPUT_COMMIT_IDENTITY,
  knowledgeOutputCommitSafe,
} from "./knowledge-output-commit.js";

const execute = promisify(execFile);

/** The repository effects Lervo applies after an independent cross-check (ADR-0561). */
export const KNOWLEDGE_EFFECT_KINDS = [
  "repository_layout",
  "instruction_bootstrap",
  "instruction_bridge",
  "document_normalization",
  "document_structure",
  "continuation_workstream",
] as const;
export type KnowledgeEffectKind = (typeof KNOWLEDGE_EFFECT_KINDS)[number];

/**
 * The notice fields an effect commit carries as trailers, so the ADR-0549 notice reports it from
 * Git alone. The undo command names the commit itself, so it is derived from the commit hash.
 */
export const KNOWLEDGE_EFFECT_TRAILERS = {
  effect: "Lervo-Effect",
  plan: "Lervo-Effect-Plan",
  reason: "Lervo-Effect-Reason",
  crossCheck: "Lervo-Effect-Cross-Check",
} as const;

export interface KnowledgeEffectNotice {
  effect: KnowledgeEffectKind;
  planId: string;
  /** One line naming why Lervo made the change. */
  reason: string;
  /** One line naming who agreed: the reviewer and its verdict. */
  crossCheck: string;
}

/** The commit subject of each effect; the notice classifies commits by their trailers. */
export function knowledgeEffectCommitSubject(effect: KnowledgeEffectKind): string {
  switch (effect) {
    case "repository_layout":
      return "docs: apply the cross-checked repository layout";
    case "instruction_bootstrap":
      return "docs: adopt the cross-checked canonical instructions";
    case "instruction_bridge":
      return "docs: apply the cross-checked instruction bridge";
    case "document_normalization":
      return "docs: apply cross-checked document normalization";
    case "document_structure":
      return "docs: apply a cross-checked document structure change";
    case "continuation_workstream":
      return "docs: migrate the cross-checked continuation workstream";
  }
}

function singleLine(value: string): string {
  return value.replace(/[\r\n\u0000-\u001f\u007f]+/gu, " ").slice(0, 400);
}

export type KnowledgeCommitResult =
  | { status: "committed"; before: string; after: string }
  | { status: "not_committed"; reason: string };

/**
 * Commits exactly the given paths, including deletions, as `Lervo Knowledge` with the given
 * trailers. Untracked deleted and ignored paths carry nothing to commit and are skipped. Any other
 * staged or unstaged work stays as it was. Returns why nothing was committed when committing is
 * unsafe, ownership ended, or a concurrent Git operation won; the written bytes then stay.
 */
export async function commitKnowledgePaths(input: {
  repositoryRoot: string;
  paths: readonly string[];
  subject: string;
  trailers: readonly string[];
}): Promise<KnowledgeCommitResult> {
  const root = input.repositoryRoot;
  if (!(await knowledgeOutputCommitSafe(root)))
    return { status: "not_committed", reason: "git_unavailable_or_busy" };
  // ADR-0466: a host that does not own convergence never commits knowledge outputs.
  const grant = await knowledgeOutputCommitGrant(root);
  if (!grant.allowed) return { status: "not_committed", reason: grant.reason };
  const git = async (args: string[], env?: NodeJS.ProcessEnv) =>
    (
      await execute("git", ["-C", root, ...args], {
        maxBuffer: 16 * 1024 * 1024,
        ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
      })
    ).stdout;
  const trailers = [
    ...input.trailers,
    ...(grant.hostHash === null ? [] : [`${CONVERGENCE_HOST_TRAILER}: ${grant.hostHash}`]),
  ].join("\n");
  try {
    const before = (await git(["rev-parse", "HEAD"])).trim();
    const paths: string[] = [];
    for (const path of [...new Set(input.paths)])
      if (
        (await git(["ls-files", "--", path])).trim() !== "" ||
        (await git(["status", "--porcelain", "--", path])).trim() !== ""
      )
        paths.push(path);
    // Tracked paths whose bytes did not change leave Git nothing to commit either.
    if (paths.length === 0 || (await git(["status", "--porcelain", "--", ...paths])).trim() === "")
      return { status: "not_committed", reason: "nothing_to_commit" };
    await git(["add", "-A", "--", ...paths]);
    await git(
      ["commit", "--only", "--quiet", "-m", input.subject, "-m", trailers, "--", ...paths],
      KNOWLEDGE_OUTPUT_COMMIT_IDENTITY,
    );
    const after = (await git(["rev-parse", "HEAD"])).trim();
    return (await git(["rev-parse", `${after}^`])).trim() === before
      ? { status: "committed", before, after }
      : { status: "not_committed", reason: "concurrent_commit" };
  } catch {
    return { status: "not_committed", reason: "commit_failed" };
  }
}

/**
 * ADR-0561 step two: an applied effect lands as its own `Lervo Knowledge` commit, the one-command
 * undo point, with the notice fields as trailers.
 */
export function commitKnowledgeEffect(input: {
  repositoryRoot: string;
  paths: readonly string[];
  notice: KnowledgeEffectNotice;
}): Promise<KnowledgeCommitResult> {
  return commitKnowledgePaths({
    repositoryRoot: input.repositoryRoot,
    paths: input.paths,
    subject: knowledgeEffectCommitSubject(input.notice.effect),
    trailers: [
      `${KNOWLEDGE_EFFECT_TRAILERS.effect}: ${input.notice.effect}`,
      `${KNOWLEDGE_EFFECT_TRAILERS.plan}: ${singleLine(input.notice.planId)}`,
      `${KNOWLEDGE_EFFECT_TRAILERS.reason}: ${singleLine(input.notice.reason)}`,
      `${KNOWLEDGE_EFFECT_TRAILERS.crossCheck}: ${singleLine(input.notice.crossCheck)}`,
    ],
  });
}

/** The one command that undoes an effect commit. */
export function knowledgeEffectUndoCommand(commit: string): string {
  return `lervo knowledge revert ${commit}`;
}

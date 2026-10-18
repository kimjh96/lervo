import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";

import { CONVERGENCE_HOST_TRAILER, knowledgeOutputCommitGrant } from "./convergence-owner-fence.js";
import {
  KNOWLEDGE_OUTPUT_COMMIT_IDENTITY,
  knowledgeOutputCommitSafe,
} from "./knowledge-output-commit.js";
import { git, inventoryKnowledgePublication } from "./knowledge-publication-git.js";
import {
  planKnowledgePublicationRepair,
  type KnowledgePublicationRepairPlan,
  type KnowledgePublicationRepairTarget,
} from "./knowledge-publication-repair-plan.js";
import { recordKnowledgePublicationRepair } from "./knowledge-publication-repair-event.js";
import {
  KNOWLEDGE_PUBLICATION_REPAIR_TRAILER,
  type KnowledgePublicationScope,
  type KnowledgePublicationViolation,
} from "./knowledge-publication-scope.js";
import type { KnowledgePublicationSettings } from "./knowledge-publication-settings.js";

const KNOWLEDGE_PUBLICATION_REPAIR_SUBJECT =
  "docs: restore paths the knowledge lifecycle must not change";
const MAXIMUM_LISTED_PATHS = 40;
const MAXIMUM_TRAILERS = 64;

export type KnowledgePublicationRepairEvents = Pick<
  ProjectStorage,
  "events" | "manifest" | "writableEventSchemaVersion"
>;

export interface KnowledgePublicationRepairOutcome {
  /** The corrective commit, or null when nothing was restored. */
  repairCommit: string | null;
  restoredPathCount: number;
  blocked: KnowledgePublicationRepairPlan["blocked"];
}

const REASON_LABEL: Record<KnowledgePublicationRepairTarget["reason"], string> = {
  tool_generated: "a repository tool owns it",
  outside_scope: "outside the knowledge write scope",
  normalization_record: "normalization record of a restored tool-owned document",
  normalization_output: "normalization output of a restored tool-owned document",
};

function message(targets: readonly KnowledgePublicationRepairTarget[]): string {
  const listed = targets.slice(0, MAXIMUM_LISTED_PATHS);
  return [
    // Commit lint limits body lines to 100 characters, so the summary wraps.
    `Lervo restored ${targets.length} path${targets.length === 1 ? "" : "s"} that knowledge commits changed although the`,
    "knowledge lifecycle must not change them. Each path returns to its content before Lervo's own",
    "run of changes; no commit by a person or a tool is undone.",
    "",
    ...listed.map((target) => `- ${target.path}: ${REASON_LABEL[target.reason]}`),
    ...(targets.length > listed.length ? [`- ${targets.length - listed.length} more paths`] : []),
  ].join("\n");
}

/**
 * Path-free `knowledge_publication_scope_violation` detail: the remaining violations by reason,
 * and the blockers that kept the repair from restoring them.
 */
export function knowledgePublicationViolationDetail(
  violations: readonly KnowledgePublicationViolation[],
  repair: KnowledgePublicationRepairOutcome | null,
): string {
  const toolGenerated = violations.filter((item) => item.reason === "tool_generated").length;
  const blockers = new Map<string, number>();
  for (const item of repair?.blocked ?? [])
    blockers.set(item.blocker, (blockers.get(item.blocker) ?? 0) + 1);
  const outcome =
    repair === null
      ? "automatic repair failed"
      : blockers.size === 0
        ? "automatic repair made no change"
        : `automatic repair blocked: ${[...blockers]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([blocker, count]) => `${count} ${blocker}`)
            .join(", ")}`;
  return `${violations.length - toolGenerated} path(s) outside the knowledge write scope, ${toolGenerated} tool-owned path(s); ${outcome}`;
}

async function existsAt(root: string, commit: string, path: string): Promise<boolean> {
  return git(root, ["cat-file", "-e", `${commit}:${path}`], "repair").then(
    () => true,
    () => false,
  );
}

async function restore(root: string, target: KnowledgePublicationRepairTarget): Promise<void> {
  if (await existsAt(root, target.restoreFrom, target.path))
    await git(root, ["checkout", "--quiet", target.restoreFrom, "--", target.path], "repair");
  else await rm(resolve(root, target.path), { force: true });
}

/** Puts the paths back to `HEAD` after a failed repair, so no half-restored bytes remain. */
async function rollback(root: string, paths: readonly string[]): Promise<void> {
  for (const path of paths)
    if (await existsAt(root, "HEAD", path))
      await git(root, ["checkout", "--quiet", "HEAD", "--", path], "repair").catch(() => "");
    else await rm(resolve(root, path), { force: true }).catch(() => undefined);
}

/**
 * ADR-0473: restores tool-owned and out-of-scope paths that `Lervo Knowledge` commits changed, in
 * one corrective `Lervo Knowledge` commit carrying a `Lervo-Publication-Repair` trailer per undone
 * commit, then records `knowledge.publication.repaired`. Only the convergence owner commits; a
 * path with uncommitted edits, a developer commit in Lervo's run, or unreadable history is left
 * as it is and reported as blocked.
 */
export async function repairKnowledgePublication(input: {
  repositoryRoot: string;
  settings: KnowledgePublicationSettings;
  scope: KnowledgePublicationScope;
  superseded: ReadonlySet<string>;
  now: () => Date;
  events?: KnowledgePublicationRepairEvents;
}): Promise<KnowledgePublicationRepairOutcome> {
  const root = input.repositoryRoot;
  const inventory = await inventoryKnowledgePublication(
    root,
    input.settings,
    input.superseded,
  ).catch(() => null);
  const plan = await planKnowledgePublicationRepair({
    repositoryRoot: root,
    base: inventory?.base ?? null,
    unpublished: inventory?.knowledge ?? [],
    scope: input.scope,
  });
  const idle = { repairCommit: null, restoredPathCount: 0, blocked: plan.blocked };
  if (plan.targets.length === 0 || !(await knowledgeOutputCommitSafe(root))) return idle;
  const grant = await knowledgeOutputCommitGrant(root, input.now().getTime());
  if (!grant.allowed) return idle;
  const paths = plan.targets.map((target) => target.path);
  const undone = [...new Set(plan.targets.flatMap((target) => target.undoes))];
  const trailers = [
    ...undone
      .slice(0, MAXIMUM_TRAILERS)
      .map((sha) => `${KNOWLEDGE_PUBLICATION_REPAIR_TRAILER}: ${sha}`),
    ...(grant.hostHash === null ? [] : [`${CONVERGENCE_HOST_TRAILER}: ${grant.hostHash}`]),
  ].join("\n");
  const before = (await git(root, ["rev-parse", "HEAD"], "repair")).trim();
  let commit: string;
  try {
    for (const target of plan.targets) await restore(root, target);
    await git(root, ["add", "-A", "--", ...paths], "repair");
    await git(
      root,
      [
        "commit",
        "--only",
        "--quiet",
        "-m",
        KNOWLEDGE_PUBLICATION_REPAIR_SUBJECT,
        "-m",
        message(plan.targets),
        "-m",
        trailers,
        "--",
        ...paths,
      ],
      "repair",
      KNOWLEDGE_OUTPUT_COMMIT_IDENTITY,
    );
    commit = (await git(root, ["rev-parse", "HEAD"], "repair")).trim();
  } catch (error) {
    if ((await git(root, ["rev-parse", "HEAD"], "repair").catch(() => before)).trim() === before)
      await rollback(root, paths);
    throw error;
  }
  if (input.events !== undefined)
    recordKnowledgePublicationRepair(input.events, {
      repairCommit: commit,
      repairedCommits: undone.slice(0, MAXIMUM_TRAILERS),
      toolGeneratedPathCount: plan.targets.filter((target) => target.reason === "tool_generated")
        .length,
      outsideScopePathCount: plan.targets.filter((target) => target.reason === "outside_scope")
        .length,
      normalizationPathCount: plan.targets.filter((target) =>
        ["normalization_record", "normalization_output"].includes(target.reason),
      ).length,
      pathSetHash: sha256(canonicalJson([...paths].sort())),
      hostHash: grant.hostHash,
      occurredAt: input.now().toISOString(),
    });
  return { repairCommit: commit, restoredPathCount: paths.length, blocked: plan.blocked };
}

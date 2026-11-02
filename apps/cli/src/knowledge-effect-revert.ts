import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import {
  LERVO_KNOWLEDGE_COMMIT_EMAIL,
  recordRevertedRepositoryLayoutMoves,
  sha256,
} from "@lervo/repository-knowledge";
import {
  commitKnowledgePaths,
  KNOWLEDGE_EFFECT_KINDS,
  KNOWLEDGE_EFFECT_TRAILERS,
  type KnowledgeEffectKind,
} from "@lervo/repository-knowledge-runtime";

import { CommandFailure } from "./command-error-output.js";

const execute = promisify(execFile);
const COMMIT = /^[a-f0-9]{7,64}$/u;

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, "-c", "core.quotePath=false", ...args], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

async function blob(root: string, revision: string, path: string): Promise<Buffer> {
  const { stdout } = await execute("git", ["-C", root, "cat-file", "blob", `${revision}:${path}`], {
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

export interface KnowledgeEffectRevertResult {
  effect: KnowledgeEffectKind;
  revertedCommit: string;
  paths: string[];
  /** Layout moves Lervo now keeps in place until the document's bytes change. */
  heldMoves: number;
  commit: string | null;
}

/**
 * ADR-0561 undo of one effect commit. It restores every path the commit changed, when each still
 * holds the bytes the commit wrote, and commits the restore as `Lervo Knowledge`. A reverted
 * layout move is recorded so no host moves the same document bytes again. A later edit to any
 * path fails with `revert_conflict` and changes nothing.
 */
export async function revertKnowledgeEffect(input: {
  repositoryRoot: string;
  commit: string;
  now: Date;
}): Promise<KnowledgeEffectRevertResult> {
  const root = input.repositoryRoot;
  if (!COMMIT.test(input.commit))
    throw new CommandFailure("revert_invalid", "Name the effect commit by its hexadecimal hash.");
  let header: string;
  try {
    header = await git(root, [
      "log",
      "-1",
      `--format=%H%x1f%ae%x1f%(trailers:key=${KNOWLEDGE_EFFECT_TRAILERS.effect},valueonly,separator=%x1d)`,
      input.commit,
    ]);
  } catch {
    throw new CommandFailure("revert_invalid", `Commit ${input.commit} does not exist here.`);
  }
  const [commit = "", author = "", effectValue = ""] = header.trim().split("\x1f");
  const effect = effectValue.trim() as KnowledgeEffectKind;
  if (author !== LERVO_KNOWLEDGE_COMMIT_EMAIL || !KNOWLEDGE_EFFECT_KINDS.includes(effect))
    throw new CommandFailure(
      "revert_invalid",
      `Commit ${input.commit} is not a cross-checked Lervo effect commit.`,
    );
  const changes = (await git(root, ["show", "--format=", "--name-status", "--no-renames", commit]))
    .split("\n")
    .map((line) => /^([ADM])\t(.+)$/u.exec(line))
    .filter((match) => match !== null)
    .map((match) => ({ status: match[1] as "A" | "D" | "M", path: match[2]! }));
  const paths = changes.map((change) => change.path);
  if (paths.length === 0)
    throw new CommandFailure("revert_invalid", `Commit ${commit} changed no paths.`);
  // Every path must still hold exactly what the effect wrote; anything later is the owner's.
  if ((await git(root, ["status", "--porcelain", "--", ...paths])).trim() !== "")
    throw new CommandFailure(
      "revert_conflict",
      `Reconcile by hand: a path changed by ${commit} has uncommitted edits. Nothing was reverted.`,
    );
  try {
    await git(root, ["diff", "--quiet", commit, "HEAD", "--", ...paths]);
  } catch {
    throw new CommandFailure(
      "revert_conflict",
      `Reconcile by hand: a path changed by ${commit} changed again afterwards. Nothing was reverted.`,
    );
  }
  const moves =
    effect === "repository_layout"
      ? (await git(root, ["show", "--format=", "--name-status", "-M", commit]))
          .split("\n")
          .map((line) => /^R\d*\t(.+)\t(.+)$/u.exec(line))
          .filter((match) => match !== null)
          .map((match) => ({ fromPath: match[1]!, toPath: match[2]! }))
      : [];
  const added = changes.filter((change) => change.status === "A").map((change) => change.path);
  const restored = changes.filter((change) => change.status !== "A").map((change) => change.path);
  // Working-tree writes only; the commit below stages exactly these paths.
  for (const path of added) await rm(resolve(root, path), { force: true });
  for (const path of restored) {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await writeFile(resolve(root, path), await blob(root, `${commit}^`, path));
  }
  const held =
    moves.length === 0
      ? null
      : await recordRevertedRepositoryLayoutMoves({
          repositoryRoot: root,
          moves: await Promise.all(
            moves.map(async (move) => ({
              ...move,
              contentHash: sha256(await blob(root, `${commit}^`, move.fromPath)),
              commit,
            })),
          ),
          now: input.now,
        });
  const result = await commitKnowledgePaths({
    repositoryRoot: root,
    paths: held === null ? paths : [...paths, held],
    subject: `docs: revert the ${effect.replaceAll("_", " ")} effect`,
    trailers: [`Lervo-Effect-Revert: ${commit}`],
  });
  return {
    effect,
    revertedCommit: commit,
    paths,
    heldMoves: moves.length,
    commit: result.status === "committed" ? result.after : null,
  };
}

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  documentNormalizationRecordSource,
  inspectConfiguredDocumentNormalization,
  isDocumentFormatOwnershipSource,
  LERVO_KNOWLEDGE_COMMIT_EMAIL,
} from "@lervo/repository-knowledge";
import type { ArtifactStore, OutboxStore } from "@lervo/storage-contract";

import { canonicalDraftKey, integratedCanonicalDrafts } from "./canonical-disposition-ledger.js";
import { CONVERGENCE_HOST_TRAILER, knowledgeOutputCommitGrant } from "./convergence-owner-fence.js";
import type { ConvergenceApprovedEffect } from "./effect-source-fence.js";
import {
  knowledgeOutputFormatTargets,
  readRevisionFiles,
  revisionFormatOwnershipSources,
} from "./knowledge-output-format-scope.js";
import {
  formatKnowledgeOutputFiles,
  loadRepositoryKnowledgeOutputFormatter,
  restoreKnowledgeOutputFiles,
  type KnowledgeOutputFormatter,
} from "./knowledge-output-formatter.js";

const execute = promisify(execFile);
const RECORD_ROOT = ".lervo/knowledge/document-normalizations/";
export const KNOWLEDGE_OUTPUT_COMMIT_AUTHOR = {
  name: "Lervo Knowledge",
  email: LERVO_KNOWLEDGE_COMMIT_EMAIL,
};
// Lervo both authors and commits its own outputs, so the commit never depends on a developer or
// runner identity; without one, `git commit` fails before writing anything.
export const KNOWLEDGE_OUTPUT_COMMIT_IDENTITY = {
  GIT_AUTHOR_NAME: KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.name,
  GIT_AUTHOR_EMAIL: KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.email,
  GIT_COMMITTER_NAME: KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.name,
  GIT_COMMITTER_EMAIL: KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.email,
};

const sha256 = (bytes: Buffer | string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function git(root: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...args], {
    maxBuffer: 64 * 1024 * 1024,
    ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
  });
  return stdout;
}

async function headBlob(root: string, path: string): Promise<Buffer | null> {
  try {
    const { stdout } = await execute("git", ["-C", root, "cat-file", "blob", `HEAD:${path}`], {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

/** Commit only on a normal branch with no Git operation or concurrent index writer. */
export async function knowledgeOutputCommitSafe(root: string): Promise<boolean> {
  try {
    await git(root, ["symbolic-ref", "-q", "HEAD"]);
  } catch {
    return false;
  }
  for (const marker of [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "REBASE_HEAD",
    "rebase-merge",
    "rebase-apply",
    "BISECT_LOG",
    "index.lock",
  ]) {
    const path = (await git(root, ["rev-parse", "--git-path", marker])).trim();
    if (existsSync(resolve(root, path))) return false;
  }
  return true;
}

function dirtyPaths(status: string): Map<string, "deleted" | "present"> {
  const paths = new Map<string, "deleted" | "present">();
  const entries = status.split("\0");
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    paths.set(entry.slice(3), code.includes("D") ? "deleted" : "present");
    // Renames carry their original path in the next entry; both sides must stay eligible.
    if (code.includes("R") || code.includes("C")) index++;
  }
  return paths;
}

export interface KnowledgeOutputSelectionInput {
  dirty: ReadonlyMap<string, "deleted" | "present">;
  /** Committed `HEAD` content hash, or null when absent. */
  head: (path: string) => Promise<string | null>;
  current: (path: string) => string;
  /** Integrated draft `(path, hash)` keys mapped to the preimage hash they replaced. */
  drafts: ReadonlyMap<string, string | null>;
  /** Current reviewed normalization records with their exact source binding. */
  records: readonly {
    path: string;
    reviewedRewritePaths: readonly string[];
    source: { sourcePath: string; sourceContentHash: string };
  }[];
  /** Source binding of a deleted record as committed in `HEAD`. */
  deletedRecordSource: (path: string) => Promise<{ sourcePath: string } | null>;
}

/**
 * Select dirty paths whose exact bytes are reviewed Lervo output over committed preimages:
 * integrated drafts, normalization of committed or drafted sources, and their records.
 * Content the developer has not committed is never selected.
 */
export async function selectSettledKnowledgeOutputs(
  input: KnowledgeOutputSelectionInput,
): Promise<string[]> {
  const selected = new Set<string>();
  for (const [path, state] of input.dirty) {
    if (state !== "present") continue;
    const key = canonicalDraftKey(path, input.current(path));
    if (input.drafts.has(key) && input.drafts.get(key) === (await input.head(path)))
      selected.add(path);
  }
  // Accept committed bytes, or an integrated draft whose own preimage is committed.
  const committedSource = async (path: string, contentHash: string) => {
    const head = await input.head(path);
    const draft = canonicalDraftKey(path, contentHash);
    return head === contentHash || (input.drafts.has(draft) && input.drafts.get(draft) === head);
  };
  const committedSources = new Set<string>();
  for (const record of input.records) {
    if (!(await committedSource(record.source.sourcePath, record.source.sourceContentHash)))
      continue;
    committedSources.add(record.source.sourcePath);
    for (const path of [record.path, ...record.reviewedRewritePaths])
      if (input.dirty.get(path) === "present") selected.add(path);
    if (input.dirty.get(record.source.sourcePath) === "deleted")
      selected.add(record.source.sourcePath);
  }
  // A superseded record of the same committed source is retired with its replacement.
  for (const [path, state] of input.dirty) {
    if (state !== "deleted" || !path.startsWith(RECORD_ROOT)) continue;
    const source = await input.deletedRecordSource(path);
    if (source && committedSources.has(source.sourcePath)) selected.add(path);
  }
  return [...selected].sort();
}

/**
 * Formats the selected outputs that the repository formatter owns after the commit, plus clean
 * paths a retired normalization record released from lifecycle ownership, so the commit never
 * hands the formatter unformatted bytes. Lifecycle-owned outputs stay byte-exact, and a released
 * path with uncommitted edits is left to its developer. Returns the paths to commit and the
 * replaced content of every formatted path.
 */
export async function formatSettledKnowledgeOutputs(input: {
  repositoryRoot: string;
  formatter: KnowledgeOutputFormatter;
  selected: readonly string[];
  dirty: ReadonlyMap<string, "deleted" | "present">;
}): Promise<{ paths: string[]; replaced: Map<string, string> }> {
  const root = input.repositoryRoot;
  const after = await revisionFormatOwnershipSources(root, "HEAD");
  const changedSources = input.selected.filter(isDocumentFormatOwnershipSource);
  const before = await readRevisionFiles(root, "HEAD", changedSources);
  for (const path of changedSources)
    if (input.dirty.get(path) === "deleted") after.delete(path);
    else after.set(path, readFileSync(resolve(root, path), "utf8"));
  const selected = new Set(input.selected);
  const targets = knowledgeOutputFormatTargets({
    changedPresentPaths: input.selected.filter((path) => input.dirty.get(path) === "present"),
    changedSourcesBefore: before,
    sourcesAfter: after,
  }).filter((path) => selected.has(path) || !input.dirty.has(path));
  const replaced = await formatKnowledgeOutputFiles({
    formatter: input.formatter,
    directory: root,
    paths: targets,
  });
  return { paths: [...new Set([...input.selected, ...replaced.keys()])].sort(), replaced };
}

async function observeDirtyPaths(root: string) {
  return dirtyPaths(await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
}

/** Observe the repository and select its settled reviewed knowledge outputs. */
export async function settledKnowledgeOutputPaths(input: {
  repositoryRoot: string;
  events: OutboxStore;
  artifacts: ArtifactStore;
  dirty?: ReadonlyMap<string, "deleted" | "present">;
}): Promise<string[]> {
  const root = input.repositoryRoot;
  const dirty = input.dirty ?? (await observeDirtyPaths(root));
  if (!dirty.size) return [];
  const current = (path: string) => sha256(readFileSync(resolve(root, path)));
  const drafts = await integratedCanonicalDrafts(input.events, input.artifacts);
  // Every reviewed output is either an integrated draft or travels with a dirty normalization
  // record, so a tree with neither skips the full normalization inspection at stage boundaries.
  if (
    ![...dirty].some(
      ([path, state]) =>
        path.startsWith(RECORD_ROOT) ||
        (state === "present" && drafts.has(canonicalDraftKey(path, current(path)))),
    )
  )
    return [];
  const normalization = await inspectConfiguredDocumentNormalization({ repositoryRoot: root });
  return selectSettledKnowledgeOutputs({
    dirty,
    head: async (path) => {
      const committed = await headBlob(root, path);
      return committed === null ? null : sha256(committed);
    },
    current,
    drafts,
    records: normalization.records.flatMap((record) => {
      if (record.status !== "current") return [];
      const source = documentNormalizationRecordSource(
        readFileSync(resolve(root, record.path), "utf8"),
      );
      return source ? [{ ...record, source }] : [];
    }),
    deletedRecordSource: async (path) => {
      const committed = await headBlob(root, path);
      return committed && documentNormalizationRecordSource(committed.toString("utf8"));
    },
  });
}

/**
 * Settled background knowledge lands as its own commit, so developers never inherit unexplained
 * working-tree edits. Only the selected paths are committed; any other staged work stays staged.
 */
export async function commitSettledKnowledgeOutputs(input: {
  repositoryRoot: string;
  events: OutboxStore;
  artifacts: ArtifactStore;
  obligationId: string;
  /** The repository formatter; omitted loads the repository's own, null skips formatting. */
  formatter?: KnowledgeOutputFormatter | null;
}): Promise<{
  committed: string[];
  head: { before: string; after: string } | null;
  /** Byte changes formatting made to committed paths, approved effects of the stage receipt. */
  formatEffects?: ConvergenceApprovedEffect[];
}> {
  const root = input.repositoryRoot;
  if (!(await knowledgeOutputCommitSafe(root))) return { committed: [], head: null };
  // ADR-0466: only the convergence owner commits; a non-owner leaves the bytes for the owner.
  const grant = await knowledgeOutputCommitGrant(root);
  if (!grant.allowed) return { committed: [], head: null };
  const dirty = await observeDirtyPaths(root);
  const selected = await settledKnowledgeOutputPaths({ ...input, dirty });
  if (!selected.length) return { committed: [], head: null };
  const formatter =
    input.formatter === undefined
      ? await loadRepositoryKnowledgeOutputFormatter(root)
      : input.formatter;
  const { paths, replaced } =
    formatter === null
      ? { paths: selected, replaced: new Map<string, string>() }
      : await formatSettledKnowledgeOutputs({ repositoryRoot: root, formatter, selected, dirty });
  const before = (await git(root, ["rev-parse", "HEAD"])).trim();
  try {
    await git(root, ["add", "-A", "--", ...paths]);
    await git(
      root,
      [
        "commit",
        "--only",
        "--quiet",
        "-m",
        "docs: apply reviewed background knowledge",
        "-m",
        `Lervo convergence ${input.obligationId} settled these reviewed outputs.`,
        ...(grant.hostHash === null
          ? []
          : ["-m", `${CONVERGENCE_HOST_TRAILER}: ${grant.hostHash}`]),
        "--",
        ...paths,
      ],
      KNOWLEDGE_OUTPUT_COMMIT_IDENTITY,
    );
  } catch {
    // A concurrent developer Git operation wins; the next idle cycle retries from the reviewed
    // bytes, which settled selection recognizes only before formatting.
    await restoreKnowledgeOutputFiles(root, replaced).catch(() => undefined);
    return { committed: [], head: null };
  }
  const after = (await git(root, ["rev-parse", "HEAD"])).trim();
  const parent = (await git(root, ["rev-parse", `${after}^`])).trim();
  if (parent !== before) return { committed: [], head: null };
  const formatEffects = [...replaced].map(([path, content]) => ({
    path,
    beforeHash: sha256(content),
    afterHash: sha256(readFileSync(resolve(root, path))),
  }));
  return { committed: paths, head: { before, after }, formatEffects };
}

import { execFile, spawn } from "node:child_process";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { sha256 } from "@lervo/repository-knowledge";

const execute = promisify(execFile);

/** A Git tree entry mode for a regular file, or the kind of entry the fence refused to commit. */
export type FencedFileMode = "100644" | "100755" | "unsupported";

/**
 * Each path's file type and executable bit, read synchronously right after the exact fence, so the
 * commit records the mode the fence saw. Absent paths are left out.
 */
export function fencedFileModes(
  root: string,
  paths: Iterable<string>,
): Map<string, FencedFileMode> {
  const modes = new Map<string, FencedFileMode>();
  for (const path of paths) {
    let stat;
    try {
      stat = lstatSync(resolve(root, path));
    } catch {
      continue;
    }
    modes.set(path, !stat.isFile() ? "unsupported" : stat.mode & 0o111 ? "100755" : "100644");
  }
  return modes;
}

/**
 * A regular file's bytes and mode, read without following links, if both are what the fence saw;
 * undefined otherwise.
 */
function readFencedFile(
  root: string,
  path: string,
  fenced: FencedFileMode | undefined,
): { bytes: Buffer; mode: FencedFileMode } | undefined {
  if (fenced === undefined || fenced === "unsupported") return undefined;
  let descriptor: number;
  try {
    descriptor = openSync(resolve(root, path), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return undefined;
  }
  try {
    const bytes = readFileSync(descriptor);
    const stat = lstatSync(resolve(root, path));
    const mode = !stat.isFile() ? "unsupported" : stat.mode & 0o111 ? "100755" : "100644";
    return mode === fenced ? { bytes, mode } : undefined;
  } finally {
    closeSync(descriptor);
  }
}

/**
 * What the commit records for one path, only if it is what the fence saw: a deleted path absent
 * from the snapshot; formatted content of replaced bytes that hash to the snapshot; or a regular
 * file whose bytes hash to the snapshot and whose mode the fence recorded. Undefined otherwise.
 */
export function reviewedEntry(input: {
  root: string;
  path: string;
  reviewed: string | null;
  mode: FencedFileMode | undefined;
  replaced: string | undefined;
  formatted: string | undefined;
  deleted: boolean;
}): { bytes: Buffer | null; mode: FencedFileMode | null } | undefined {
  if (input.formatted !== undefined)
    return sha256(input.replaced!) === input.reviewed &&
      input.mode !== undefined &&
      input.mode !== "unsupported"
      ? { bytes: Buffer.from(input.formatted, "utf8"), mode: input.mode }
      : undefined;
  if (input.deleted) return input.reviewed === null ? { bytes: null, mode: null } : undefined;
  if (input.reviewed === null) return undefined;
  const file = readFencedFile(input.root, input.path, input.mode);
  return file !== undefined && sha256(file.bytes) === input.reviewed ? file : undefined;
}

async function git(root: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...args], {
    maxBuffer: 16 * 1024 * 1024,
    ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
  });
  return stdout.trim();
}

/** A boolean config value; unset is `fallback`, an invalid value throws as Git itself would. */
async function configBoolean(root: string, key: string, fallback: boolean): Promise<boolean> {
  try {
    return (await git(root, ["config", "--type=bool", "--get", key])) === "true";
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return fallback;
    throw error;
  }
}

/** Writes `bytes` as a blob exactly as given: no clean filter or line-ending conversion runs. */
function writeBlob(root: string, bytes: Buffer): Promise<string> {
  return new Promise((resolveBlob, reject) => {
    const child = spawn("git", ["-C", root, "hash-object", "-w", "--no-filters", "--stdin"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolveBlob(stdout.trim()) : reject(new Error(`git hash-object exited ${code}`)),
    );
    child.stdin.end(bytes);
  });
}

/** The same markers the commit-safety check refuses, plus the sequencer. */
const OPERATION_MARKERS = [
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "REBASE_HEAD",
  "rebase-merge",
  "rebase-apply",
  "sequencer",
  "BISECT_LOG",
];

/** `mode oid` of a path's stage-0 entry in an index or tree listing, or null when absent. */
function entryOf(listing: string): string | null {
  const record = listing.split("\0").find((line) => line.length > 0);
  if (record === undefined) return null;
  const [meta] = record.split("\t");
  const fields = meta!.split(" ");
  // `ls-files -s` prints `mode oid stage`, `ls-tree` prints `mode type oid`.
  return fields.length === 3 && /^[0-3]$/u.test(fields[2]!)
    ? fields[2] === "0"
      ? `${fields[0]} ${fields[1]}`
      : "conflict"
    : `${fields[0]} ${fields[2]}`;
}

/**
 * Commits exactly the given bytes on top of `parent`. Blobs come from memory, never from the
 * working tree, so a file edited after its bytes were checked never enters the commit; the edit
 * stays in the working tree. A null `bytes` removes the path. Returns the new commit, or null when
 * nothing changes or the commit had to give way.
 *
 * It holds the developer's `index.lock` from its last Git operation check through the HEAD move
 * and the index update, as `git commit` does. An existing lock, or any merge, cherry-pick, revert,
 * rebase, sequencer or bisect in progress, gives way before HEAD moves. The developer's index
 * takes the committed entry only where its entry still equals the parent's, so staged work on a
 * committed path stays staged. No hook runs; `commit.gpgsign` is honoured and a signing failure
 * gives way.
 */
export async function commitExactKnowledgeBytes(input: {
  repositoryRoot: string;
  parent: string;
  entries: readonly { path: string; bytes: Buffer | null; mode: FencedFileMode | null }[];
  messages: readonly string[];
  identity: NodeJS.ProcessEnv;
}): Promise<string | null> {
  const root = input.repositoryRoot;
  const directory = await mkdtemp(join(tmpdir(), "lervo-knowledge-commit-index-"));
  try {
    const fileMode = await configBoolean(root, "core.filemode", true);
    const sign = await configBoolean(root, "commit.gpgsign", false);
    const tree = { GIT_INDEX_FILE: join(directory, "tree-index") };
    await git(root, ["read-tree", input.parent], tree);
    const entries: { path: string; entry: string | null }[] = [];
    for (const item of input.entries) {
      const committed = entryOf(await git(root, ["ls-tree", "-z", input.parent, "--", item.path]));
      if (item.bytes === null) {
        await git(root, ["update-index", "--force-remove", "--", item.path], tree);
        entries.push({ path: item.path, entry: null });
        continue;
      }
      if (item.mode === null || item.mode === "unsupported") return null;
      // Without `core.fileMode`, Git keeps the recorded mode, as `git add` would.
      const mode = fileMode ? item.mode : (committed?.split(" ")[0] ?? "100644");
      const blob = await writeBlob(root, item.bytes);
      await git(
        root,
        ["update-index", "--add", "--cacheinfo", `${mode},${blob},${item.path}`],
        tree,
      );
      entries.push({ path: item.path, entry: `${mode} ${blob}` });
    }
    const written = await git(root, ["write-tree"], tree);
    if (written === (await git(root, ["rev-parse", `${input.parent}^{tree}`]))) return null;
    const commit = await git(
      root,
      [
        "commit-tree",
        written,
        "-p",
        input.parent,
        ...(sign ? ["-S"] : []),
        ...input.messages.flatMap((message) => ["-m", message]),
      ],
      input.identity,
    ).catch(() => null);
    if (commit === null) return null;
    const indexPath = resolve(root, await git(root, ["rev-parse", "--git-path", "index"]));
    const lockPath = `${indexPath}.lock`;
    let lock: number;
    try {
      lock = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
    } catch {
      return null;
    }
    let held = true;
    const release = () => {
      if (!held) return;
      held = false;
      try {
        closeSync(lock);
      } catch {
        /* Already closed after writing. */
      }
      unlinkSync(lockPath);
    };
    try {
      const markers = (
        await git(root, [
          "rev-parse",
          ...OPERATION_MARKERS.flatMap((marker) => ["--git-path", marker]),
        ])
      ).split("\n");
      if (markers.length !== OPERATION_MARKERS.length) return null;
      if (markers.some((marker) => existsSync(resolve(root, marker)))) return null;
      // A split index keeps entries in a shared file this copy would not carry.
      if (readdirSync(dirname(indexPath)).some((name) => name.startsWith("sharedindex.")))
        return null;
      // The developer's index, copied under the lock, takes each committed entry only where it
      // still equals the parent's entry for that path.
      const developer = { GIT_INDEX_FILE: join(directory, "developer-index") };
      if (existsSync(indexPath)) await copyFile(indexPath, developer.GIT_INDEX_FILE);
      for (const item of entries) {
        const parentEntry = entryOf(
          await git(root, ["ls-tree", "-z", input.parent, "--", item.path]),
        );
        const staged = entryOf(
          await git(root, ["ls-files", "-s", "-z", "--", item.path], developer),
        );
        if (staged !== parentEntry) continue;
        if (item.entry === null)
          await git(root, ["update-index", "--force-remove", "--", item.path], developer);
        else {
          const [mode, blob] = item.entry.split(" ");
          await git(
            root,
            ["update-index", "--add", "--cacheinfo", `${mode},${blob},${item.path}`],
            developer,
          );
        }
      }
      const next = await readFile(developer.GIT_INDEX_FILE).catch(() => null);
      if (next !== null) writeSync(lock, next);
      fsyncSync(lock);
      closeSync(lock);
      try {
        await git(
          root,
          ["update-ref", "-m", `commit: ${input.messages[0]}`, "HEAD", commit, input.parent],
          input.identity,
        );
      } catch {
        return null;
      }
      if (next === null) return commit;
      try {
        renameSync(lockPath, indexPath);
        held = false;
      } catch (error) {
        // The index cannot follow; put HEAD back so the developer's cached diff stays truthful.
        await git(root, ["update-ref", "HEAD", input.parent, commit], input.identity).catch(
          () => undefined,
        );
        throw error;
      }
      return commit;
    } finally {
      release();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

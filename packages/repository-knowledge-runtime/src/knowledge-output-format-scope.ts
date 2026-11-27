import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  DOCUMENT_FORMAT_OWNERSHIP_ROOTS,
  documentFormatOwnedPaths,
  isDocumentFormatOwnershipSource,
  observeToolGeneratedDocuments,
} from "@lervo/repository-knowledge";

const execute = promisify(execFile);
const MAXIMUM_BUFFER = 256 * 1024 * 1024;

/** Reads `paths` at `revision` through one `git cat-file --batch`; absent paths are omitted. */
export async function readRevisionFiles(
  root: string,
  revision: string,
  paths: readonly string[],
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const requested = paths.filter((path) => !path.includes("\n"));
  if (requested.length === 0) return files;
  const output = await new Promise<Buffer>((resolveRead, reject) => {
    // Git that exits before reading every lookup leaves the batch output short, so a failed write
    // fails the read. Git's own failure, such as a timeout, still reports as itself.
    let inputError: Error | null = null;
    const child = execFile(
      "git",
      ["-C", root, "cat-file", "--batch"],
      { encoding: "buffer", maxBuffer: MAXIMUM_BUFFER, timeout: 120_000 },
      (error, stdout) => {
        if (error !== null) reject(error);
        else if (inputError !== null) reject(inputError);
        else resolveRead(stdout);
      },
    );
    child.stdin?.on("error", (error) => {
      inputError = error;
    });
    child.stdin?.end(requested.map((path) => `${revision}:${path}\n`).join(""));
  });
  let offset = 0;
  for (const path of requested) {
    const end = output.indexOf(0x0a, offset);
    if (end < 0) break;
    const header = output.subarray(offset, end).toString("utf8").split(" ");
    offset = end + 1;
    if (header.length !== 3) continue;
    const size = Number(header[2]);
    if (header[1] === "blob") files.set(path, output.subarray(offset, offset + size).toString());
    offset += size + 1;
  }
  return files;
}

/** Every document format ownership source in `revision`, with its content. */
export async function revisionFormatOwnershipSources(
  root: string,
  revision: string,
): Promise<Map<string, string>> {
  const listed = (
    await execute(
      "git",
      [
        "-C",
        root,
        "ls-tree",
        "-r",
        "-z",
        "--name-only",
        revision,
        "--",
        ...DOCUMENT_FORMAT_OWNERSHIP_ROOTS,
      ],
      { maxBuffer: MAXIMUM_BUFFER },
    )
  ).stdout
    .split("\0")
    .filter((path) => path !== "" && isDocumentFormatOwnershipSource(path));
  return readRevisionFiles(root, revision, listed);
}

const sources = (files: ReadonlyMap<string, string>) =>
  [...files].map(([path, content]) => ({ path, content }));

/**
 * The paths a knowledge change must hand over formatted: every changed path that still exists,
 * plus every path a changed ownership source stopped assigning to a lifecycle, minus whatever a
 * lifecycle owns after the change and the ownership sources themselves. Lifecycle-owned bytes are
 * reviewed exactly and never reformatted; a released path becomes the formatter's, so it must
 * leave the change already formatted.
 */
export function knowledgeOutputFormatTargets(input: {
  changedPresentPaths: Iterable<string>;
  /** Changed ownership sources as they were before the change; added sources are absent. */
  changedSourcesBefore: ReadonlyMap<string, string>;
  sourcesAfter: ReadonlyMap<string, string>;
}): string[] {
  const ownedAfter = documentFormatOwnedPaths(sources(input.sourcesAfter));
  const candidates = new Set(input.changedPresentPaths);
  for (const path of documentFormatOwnedPaths(sources(input.changedSourcesBefore)))
    candidates.add(path);
  return [...candidates]
    .filter((path) => !ownedAfter.has(path) && !isDocumentFormatOwnershipSource(path))
    .sort();
}

/**
 * Format targets of the commits in `base..tip`: the paths they touch that exist at `tip`, plus the
 * paths they released from lifecycle ownership.
 */
export async function revisionRangeFormatTargets(input: {
  root: string;
  base: string;
  tip: string;
  touchedPaths: readonly string[];
}): Promise<string[]> {
  const touched = [...new Set(input.touchedPaths)].sort();
  const changedSources = touched.filter(isDocumentFormatOwnershipSource);
  const [after, before, present] = await Promise.all([
    revisionFormatOwnershipSources(input.root, input.tip),
    readRevisionFiles(input.root, input.base, changedSources),
    readRevisionFiles(input.root, input.tip, touched),
  ]);
  const targets = knowledgeOutputFormatTargets({
    changedPresentPaths: present.keys(),
    changedSourcesBefore: before,
    sourcesAfter: after,
  });
  // ADR-0473: a repair restores a tool-generated document to its tool's exact bytes, so the
  // publication formatter must not touch it either.
  const toolGenerated = await observeToolGeneratedDocuments({
    repositoryRoot: input.root,
    paths: targets,
  });
  return targets.filter((path) => !toolGenerated.has(path));
}

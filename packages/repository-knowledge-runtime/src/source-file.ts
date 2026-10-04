import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  type BigIntStats,
} from "node:fs";
import { resolve } from "node:path";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

export const MAXIMUM_ORDINARY_SOURCE_BYTES = 64 * 1024 * 1024;

/** Resolve a repository-relative source through no-follow checks of every path component. */
export function ordinaryConvergenceSourcePath(root: string, path: string): string {
  if (
    path.length === 0 ||
    path.includes("\\") ||
    path.includes(":") ||
    path.includes("\0") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
  let target = resolve(root);
  for (const part of path.split("/")) {
    target = resolve(target, part);
    if (lstatSync(target).isSymbolicLink())
      throw new KnowledgeConvergenceRuntimeError("knowledge_source_kind_unsupported");
  }
  return target;
}

/** Read ordinary source bytes with the descriptor metadata observed before the read. */
export function readOrdinaryConvergenceSource(
  root: string,
  path: string,
  maximumBytes = MAXIMUM_ORDINARY_SOURCE_BYTES,
): { bytes: Buffer; stat: BigIntStats } {
  const target = ordinaryConvergenceSourcePath(root, path);
  const descriptor = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor, { bigint: true });
    if (!stat.isFile() || stat.size > BigInt(maximumBytes))
      throw new KnowledgeConvergenceRuntimeError("knowledge_source_kind_unsupported");
    return { bytes: readFileSync(descriptor), stat };
  } finally {
    closeSync(descriptor);
  }
}

/** Read ordinary source bytes through no-follow path and descriptor checks. */
export function ordinaryConvergenceSourceBytes(
  root: string,
  path: string,
  maximumBytes = MAXIMUM_ORDINARY_SOURCE_BYTES,
): Buffer {
  return readOrdinaryConvergenceSource(root, path, maximumBytes).bytes;
}

import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

/** Read ordinary source bytes through no-follow path and descriptor checks. */
export function ordinaryConvergenceSourceBytes(
  root: string,
  path: string,
  maximumBytes = 64 * 1024 * 1024,
): Buffer {
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
  const descriptor = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maximumBytes)
      throw new KnowledgeConvergenceRuntimeError("knowledge_source_kind_unsupported");
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

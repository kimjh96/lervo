import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { commitKnowledgePaths } from "@lervo/repository-knowledge-runtime";

import { CommandFailure } from "./command-error-output.js";

const execute = promisify(execFile);

async function headBlob(root: string, path: string): Promise<Buffer | null> {
  try {
    const { stdout } = await execute("git", ["-C", root, "cat-file", "blob", `HEAD:${path}`], {
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * ADR-0561 commit-then-delete: before Lervo deletes a user document, Git must hold its exact
 * bytes, so reverting the deletion commit restores it. Bytes `HEAD` already holds need nothing;
 * other bytes are committed first as `Lervo Knowledge`. When Git cannot hold them, nothing is
 * deleted.
 */
export async function preserveDocumentBeforeDeletion(input: {
  repositoryRoot: string;
  path: string;
}): Promise<{ preservedBy: "head" } | { preservedBy: "commit"; commit: string }> {
  const current = await readFile(resolve(input.repositoryRoot, input.path));
  const committed = await headBlob(input.repositoryRoot, input.path);
  if (committed !== null && committed.equals(current)) return { preservedBy: "head" };
  const result = await commitKnowledgePaths({
    repositoryRoot: input.repositoryRoot,
    paths: [input.path],
    subject: `docs: preserve ${input.path} before deletion`,
    trailers: ["Lervo-Effect-Preimage: document_structure"],
  });
  if (result.status !== "committed")
    throw new CommandFailure(
      "knowledge_effect_not_reversible",
      `Lervo deletes a document only when Git holds its bytes, and ${input.path} could not be committed first (${result.reason}). Nothing was deleted.`,
      { path: input.path, reason: result.reason },
    );
  return { preservedBy: "commit", commit: result.after };
}

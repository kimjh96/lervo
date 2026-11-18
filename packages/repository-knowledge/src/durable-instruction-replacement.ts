import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { sha256 } from "./integrity.js";
import type { KnowledgeFileOperation } from "./types.js";

const GENERATED_RULE_PATH = /^docs\/instructions\/generated\/rule_[a-f0-9]{24}\.md$/u;

/** The `paths:` frontmatter list of one generated rule; an empty list means repository scope. */
export function generatedRuleScopePaths(content: string): string[] | null {
  const lines = content.split("\n");
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end < 0) return null;
  const paths: string[] = [];
  let inPaths = false;
  for (const line of lines.slice(1, end)) {
    if (line === "paths:") {
      inPaths = true;
      continue;
    }
    if (!inPaths) continue;
    const item = /^ {2}- (".*")$/u.exec(line);
    if (item === null) break;
    try {
      paths.push(JSON.parse(item[1]!) as string);
    } catch {
      return null;
    }
  }
  return paths.sort();
}

async function existing(root: string, path: string): Promise<string | null> {
  try {
    return await readFile(resolve(root, path), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * ADR-0561: a new owner rule replaces the older Lervo-generated rule it conflicts with when both
 * govern the same scope. User-owned instruction files are never deleted; a named rule that is not
 * generated, absent, or scoped differently is skipped and reported by reason.
 */
export async function planDurableInstructionReplacements(input: {
  repositoryRoot: string;
  replaces: readonly string[];
  scopePaths: readonly string[];
  targetPath: string;
}): Promise<{ operations: KnowledgeFileOperation[]; skippedReasonIds: string[] }> {
  const operations: KnowledgeFileOperation[] = [];
  const skipped = new Set<string>();
  const scope = JSON.stringify([...input.scopePaths].sort());
  for (const path of [...new Set(input.replaces)].sort()) {
    if (path === input.targetPath) continue;
    if (!GENERATED_RULE_PATH.test(path)) {
      skipped.add("replacement_not_generated_rule");
      continue;
    }
    const content = await existing(input.repositoryRoot, path);
    if (content === null) {
      skipped.add("replacement_absent");
      continue;
    }
    if (JSON.stringify(generatedRuleScopePaths(content)) !== scope) {
      skipped.add("replacement_scope_differs");
      continue;
    }
    operations.push({
      path,
      action: "delete",
      ownership: "lervo_generated",
      mediaType: "text/markdown",
      expectedCurrentHash: sha256(content),
      desiredHash: sha256("lervo:absent\n"),
      reason: "owner_rule_replaced",
    });
  }
  return { operations, skippedReasonIds: [...skipped] };
}

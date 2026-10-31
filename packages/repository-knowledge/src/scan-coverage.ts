import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { RepositoryKnowledgeScan } from "./types.js";
import { requireCompleteRepositoryKnowledgeCoverage } from "./scan-completeness.js";

/** One replaceable private diagnostic, with counts and classes only; no source paths or content. */
function recordRepositoryScanBudgetStop(
  repositoryRoot: string,
  skippedForBudget: RepositoryKnowledgeScan["skippedForBudget"],
): void {
  let temporary: string | undefined;
  try {
    let directory = resolve(repositoryRoot);
    for (const part of [".lervo", "state", "knowledge"]) {
      directory = resolve(directory, part);
      try {
        mkdirSync(directory, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe evidence path.");
    }
    for (const entry of readdirSync(directory, { withFileTypes: true }))
      if (entry.isFile() && /^\.scan-budget-[a-f0-9-]{36}\.tmp$/u.test(entry.name))
        rmSync(resolve(directory, entry.name), { force: true });
    temporary = resolve(directory, `.scan-budget-${randomUUID()}.tmp`);
    writeFileSync(
      temporary,
      `${JSON.stringify({ schemaVersion: 1, code: "knowledge_source_limit_exceeded", skippedForBudget })}\n`,
      { mode: 0o600, flag: "wx" },
    );
    renameSync(temporary, resolve(directory, "scan-budget-stop.json"));
  } finally {
    if (temporary !== undefined) rmSync(temporary, { force: true });
  }
}

/** Currency claims require complete admission, including caller-prepared and virtual scans. */
export function assertCompleteRepositoryKnowledgeScan(
  repositoryRoot: string,
  scan: RepositoryKnowledgeScan,
): void {
  try {
    requireCompleteRepositoryKnowledgeCoverage(scan);
  } catch (error) {
    try {
      recordRepositoryScanBudgetStop(repositoryRoot, scan.skippedForBudget);
    } catch (evidenceFailure) {
      Object.assign(error as Error, { evidenceFailure });
    }
    throw error;
  }
}

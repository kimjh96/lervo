import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "./integrity.js";
import type { DocumentFreshnessAssessmentV1 } from "./document-freshness-assessment.js";

const execute = promisify(execFile);

/** Read-set checks affect reuse, never the retained canonical receipt or the owner's working tree. */
export async function currentWorkingFreshnessAssessments<
  T extends { assessment: DocumentFreshnessAssessmentV1 },
>(root: string, records: T[]): Promise<T[]> {
  if (records.length === 0) return [];
  try {
    const result = await execute(
      "git",
      [
        "--no-optional-locks",
        "-C",
        root,
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ],
      {
        maxBuffer: 4 * 1024 * 1024,
        timeout: 60_000,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
      },
    );
    const changed = new Set<string>();
    const entries = result.stdout.split("\0");
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      if (entry.length < 4) continue;
      changed.add(entry.slice(3));
      if (/^[RC]|^.[RC]/u.test(entry)) changed.add(entries[++i] ?? "");
    }
    const valid: T[] = [];
    for (const record of records) {
      if (
        record.assessment.dependency.objects.some((object) =>
          [...changed].some((path) => path === object.path || path.startsWith(`${object.path}/`)),
        )
      )
        continue;
      let current = true;
      for (const evidence of record.assessment.dependency.evidence) {
        const bytes = await readFile(resolve(root, evidence.path)).catch(() => null);
        if (
          bytes === null
            ? !record.assessment.dependency.objects.some(
                (object) => object.path === evidence.path && object.objectName === null,
              )
            : sha256(bytes) !== evidence.hash
        ) {
          current = false;
          break;
        }
      }
      if (current) valid.push(record);
    }
    return valid;
  } catch {
    return [];
  }
}

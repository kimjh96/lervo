import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { KNOWLEDGE_RESIDENT_REQUEST_NAME } from "./repository-change-classification.js";

/**
 * ADR-0606: asks this repository's resident to look at its knowledge inputs now. A foreground
 * command that writes an input the resident reads but no event records (an owner turn queued for
 * capture, a stored owner-rule candidate, a freshness acknowledgement, a dismissed capture) calls
 * this after its write, and a foreground knowledge publication calls it to hand the resident a
 * retry, which only the resident's own publish arms. The resident's repository watch wakes on the
 * file, a direct child of `.lervo/state`; the resident's own writes never call it, so it never
 * wakes itself. A failure to write it never fails the command: the next signal still finds the
 * input.
 */
export async function requestKnowledgeResidentCycle(repositoryRoot: string): Promise<void> {
  const state = resolve(repositoryRoot, ".lervo/state");
  const temporary = resolve(state, `.${KNOWLEDGE_RESIDENT_REQUEST_NAME}.${randomUUID()}.tmp`);
  try {
    await mkdir(state, { recursive: true, mode: 0o700 });
    await writeFile(
      temporary,
      `${JSON.stringify({ schemaVersion: 1, requestedAt: new Date().toISOString() })}\n`,
      { mode: 0o600, flag: "wx" },
    );
    await rename(temporary, resolve(state, KNOWLEDGE_RESIDENT_REQUEST_NAME));
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

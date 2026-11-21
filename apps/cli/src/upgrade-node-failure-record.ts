import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { errorCode } from "./command-error-output.js";
import {
  repositoryUpgradeFailureDetail,
  type RepositoryUpgradeFailureDetail,
} from "./host-follow-failure-detail.js";

/**
 * ADR-0575: the repository's own record of its last failed Node upgrade stage, written by the CLI
 * that failed. The follower runs the CLI it started with until a release proves itself, so a
 * detail only the follower kept would come from the old version; this record is the new
 * version's own. One file, replaced by the next failure and removed by the next success.
 */
export const UPGRADE_NODE_FAILURE_PATH = ".lervo/state/upgrade/node-failure.json";

export interface UpgradeNodeFailureRecord {
  schemaVersion: 1;
  failedAt: string;
  cliVersion: string;
  code: string;
  failure?: RepositoryUpgradeFailureDetail;
}

/** Records why the Node stage failed; a record that cannot be written never masks the failure. */
export async function recordUpgradeNodeFailure(
  root: string,
  cliVersion: string,
  error: unknown,
  now: Date = new Date(),
): Promise<void> {
  const failure = repositoryUpgradeFailureDetail(
    error !== null && typeof error === "object" && "details" in error
      ? (error as { details: unknown }).details
      : undefined,
  );
  const record: UpgradeNodeFailureRecord = {
    schemaVersion: 1,
    failedAt: now.toISOString(),
    cliVersion,
    code: errorCode(error),
    ...(failure === undefined ? {} : { failure }),
  };
  let temporary: string | null = null;
  try {
    const path = resolve(root, UPGRADE_NODE_FAILURE_PATH);
    temporary = `${path}.${randomUUID()}`;
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  } catch {
    if (temporary !== null) await rm(temporary, { force: true }).catch(() => undefined);
  }
}

/** A successful Node stage leaves no record of an earlier failure. */
export async function clearUpgradeNodeFailure(root: string): Promise<void> {
  try {
    await rm(resolve(root, UPGRADE_NODE_FAILURE_PATH), { force: true });
  } catch {
    // An unremovable record is stale diagnostics, never a failed upgrade.
  }
}

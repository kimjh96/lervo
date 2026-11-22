import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

import type { HostedConversationMode, HostedLaunch } from "@lervo/adapter-contract";
import { readPrivateJsonFile, writePrivateJsonFile } from "@lervo/repository-knowledge-runtime";
import { defaultRepositoryRegistryPath } from "@lervo/repository-registry";

/** Records kept per host. The oldest records leave first. */
export const HOSTED_LAUNCH_RECORD_LIMIT = 256;
const MAX_FILE_BYTES = 1024 * 1024;

/**
 * What Lervo prepared for one hosted launch (Lervo ADE sessions, "Launch descriptor record").
 * It holds identifiers and digests only: no instruction text, environment values, credentials, or
 * absolute paths. The project and branch locate the workspace's worktree again.
 */
export interface HostedLaunchRecord {
  schemaVersion: 1;
  workspaceId: string;
  sessionId: string;
  provider: string;
  projectId: string;
  branch: string;
  conversationMode: HostedConversationMode;
  argumentDigest: string;
  settingsDigest: string | null;
  mcpConfigDigest: string | null;
  preparedAt: string;
}

/** The host's record file, next to the repository registry in the user state directory. */
export function hostedLaunchRecordsPath(environment: NodeJS.ProcessEnv = process.env): string {
  return resolve(dirname(defaultRepositoryRegistryPath(environment)), "hosted-launches.json");
}

/** A digest of the launch's program and arguments; the arguments may hold the instruction. */
export function launchArgumentDigest(launch: HostedLaunch): string {
  const hash = createHash("sha256").update(JSON.stringify([launch.program, ...launch.arguments]));
  return `sha256:${hash.digest("hex")}`;
}

function isRecord(value: unknown): value is HostedLaunchRecord {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === 1 &&
    ["workspaceId", "sessionId", "provider", "projectId", "branch", "preparedAt"].every(
      (key) => typeof record[key] === "string",
    ) &&
    (record.conversationMode === "native" || record.conversationMode === "cli")
  );
}

async function readRecords(path: string): Promise<HostedLaunchRecord[]> {
  const file = await readPrivateJsonFile(path, MAX_FILE_BYTES);
  if (file.status !== "read") return [];
  const records = (file.value as { records?: unknown }).records;
  return Array.isArray(records) ? records.filter(isRecord) : [];
}

/** Adds `record` and keeps the newest `HOSTED_LAUNCH_RECORD_LIMIT` records. */
export async function recordHostedLaunch(path: string, record: HostedLaunchRecord): Promise<void> {
  const records = [...(await readRecords(path)), record].slice(-HOSTED_LAUNCH_RECORD_LIMIT);
  await writePrivateJsonFile(path, { schemaVersion: 1, records });
}

/** The newest record of `workspaceId`, or null. */
export async function latestHostedLaunch(
  path: string,
  workspaceId: string,
): Promise<HostedLaunchRecord | null> {
  const records = await readRecords(path);
  return records.findLast((record) => record.workspaceId === workspaceId) ?? null;
}

import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

import type { HostedConversationMode, HostedLaunch } from "@lervo/adapter-contract";
import { readPrivateJsonFile, writePrivateJsonFile } from "@lervo/repository-knowledge-runtime";
import { defaultRepositoryRegistryPath } from "@lervo/repository-registry";

import type { WorkspaceBaseNotice } from "./workspace-base.js";

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
  /** Where the workspace started; records from before Lervo 0.47.7 have none. */
  base?: HostedWorkspaceBase;
  /**
   * The Lervo terminal hooks the launch added for events the worktree's project settings lack,
   * and whether they run the host launcher or, on an older install, the CLI (ADR-0632, S2a).
   * Absent when the project hooks every event.
   */
  terminalHooks?: { events: string[]; via: "launcher" | "cli" };
  /**
   * The agent whose session this is, and every agent the conversation started with (Lervo ADE
   * agents, "Participants and sessions"). Absent for a conversation started without agents.
   */
  agentId?: string;
  participants?: string[];
  /** The team agent that started the conversation and leads it (Lervo ADE rooms, slice 2). */
  startedBy?: string;
  /**
   * `read` for an agent that joined the conversation (Lervo ADE rooms, "Participants and their
   * sessions"). Absent for the lead, whose session writes.
   */
  access?: "read";
  /**
   * Whether the conversation's session host answers the agents' questions with choices (Lervo ADE
   * sessions, "Questions"), so its native sessions ask through the provider's stream.
   */
  questions?: true;
}

/**
 * The commit a workspace branched from and why (Lervo ADE sessions, "The workspace's base"):
 * identifiers and ref names only.
 */
export interface HostedWorkspaceBase {
  commit: string;
  source: "upstream" | "local";
  upstream: string | null;
  /**
   * Unpublished knowledge commits replayed on the branch, those whose change the branch already
   * held, and, when the replay was dropped, all of them as skipped.
   */
  replayed: string[];
  skipped: string[];
  carried: string[];
  /** Why the workspace started without something; `replay_incomplete` dropped the replay. */
  notice: WorkspaceBaseNotice | "replay_incomplete" | null;
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
    (record.conversationMode === "native" || record.conversationMode === "cli") &&
    (record.access === undefined || record.access === "read") &&
    (record.questions === undefined || record.questions === true)
  );
}

async function readRecords(path: string): Promise<HostedLaunchRecord[]> {
  const file = await readPrivateJsonFile(path, MAX_FILE_BYTES);
  if (file.status !== "read") return [];
  const records = (file.value as { records?: unknown }).records;
  return Array.isArray(records) ? records.filter(isRecord) : [];
}

/** The kept records of conversations `agentId` started (Lervo ADE rooms, slice 2). */
export async function conversationsStartedBy(
  path: string,
  agentId: string,
): Promise<HostedLaunchRecord[]> {
  return (await readRecords(path)).filter((record) => record.startedBy === agentId);
}

/** Adds `record` and keeps the newest `HOSTED_LAUNCH_RECORD_LIMIT` records. */
export async function recordHostedLaunch(path: string, record: HostedLaunchRecord): Promise<void> {
  const records = [...(await readRecords(path)), record].slice(-HOSTED_LAUNCH_RECORD_LIMIT);
  await writePrivateJsonFile(path, { schemaVersion: 1, records });
}

/** The newest record of a provider's session, or null when Lervo did not prepare it. */
export async function hostedLaunchOfSession(
  path: string,
  provider: string,
  sessionId: string,
): Promise<HostedLaunchRecord | null> {
  const records = await readRecords(path);
  return (
    records.findLast((record) => record.provider === provider && record.sessionId === sessionId) ??
    null
  );
}

/** The newest record of a session, whatever its provider, or null. */
export async function latestHostedLaunchOfSession(
  path: string,
  sessionId: string,
): Promise<HostedLaunchRecord | null> {
  return (await readRecords(path)).findLast((record) => record.sessionId === sessionId) ?? null;
}

/** The sessions of every kept record. */
export async function hostedLaunchSessions(path: string): Promise<Set<string>> {
  return new Set((await readRecords(path)).map((record) => record.sessionId));
}

/** The newest record of `workspaceId`'s lead session, or null. Joined agents' records never lead. */
export async function latestHostedLaunch(
  path: string,
  workspaceId: string,
): Promise<HostedLaunchRecord | null> {
  const records = await readRecords(path);
  return (
    records.findLast((record) => record.workspaceId === workspaceId && record.access !== "read") ??
    null
  );
}

/**
 * The newest record of each agent's session in `workspaceId`, the lead's first and then in the
 * order the agents joined. A conversation started without agents has none.
 */
export async function roomSessionRecords(
  path: string,
  workspaceId: string,
): Promise<HostedLaunchRecord[]> {
  const newest = new Map<string, HostedLaunchRecord>();
  for (const record of await readRecords(path))
    if (record.workspaceId === workspaceId && record.agentId !== undefined) {
      // A re-inserted key keeps its first place, so an agent stays where it joined.
      newest.set(record.agentId, record);
    }
  return [...newest.values()].sort(
    (a, b) => Number(a.access === "read") - Number(b.access === "read"),
  );
}

/** Every session the kept records name for `workspaceId`, oldest first. */
export async function hostedSessionsOfWorkspace(
  path: string,
  workspaceId: string,
): Promise<string[]> {
  return [
    ...new Set(
      (await readRecords(path))
        .filter((record) => record.workspaceId === workspaceId)
        .map((record) => record.sessionId),
    ),
  ];
}

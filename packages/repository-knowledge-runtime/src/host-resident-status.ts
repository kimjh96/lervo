import { dirname, isAbsolute, resolve } from "node:path";

import { probeProcessPresence } from "@lervo/project-storage";
import { defaultRepositoryRegistryPath } from "@lervo/repository-registry";

import { readPrivateJsonFile, writePrivateJsonFile } from "./private-state-file.js";

export const HOST_KNOWLEDGE_RESIDENT_STATUS_FILE = "knowledge-host-resident.json";
const MAXIMUM_STATUS_BYTES = 128 * 1024;
const MAXIMUM_REPOSITORIES = 256;
/**
 * ADR-0602: a host resident proves it runs through its process presence, probed when read; it
 * rewrites its status only on change. A record without a presence (an earlier release, which
 * still heartbeats) is judged by this heartbeat age and its process.
 */
export const HOST_KNOWLEDGE_RESIDENT_STALE_MILLISECONDS = 3 * 60_000;
/** A repository scan running longer than this is stalled; a healthy scan takes seconds. */
export const HOST_KNOWLEDGE_RESIDENT_SCAN_STALL_MILLISECONDS = 10 * 60_000;

/**
 * - `serving`: an ordinary resident runs for the checkout.
 * - `held`: the checkout needs a resident that cannot start yet; `reason` says why.
 * - `node_served`: a registered Node runs this checkout's resident instead.
 * - `not_enrolled`: no delegation and no active policy, so continuity owns nothing here.
 */
export type HostResidentRepositoryState = "serving" | "held" | "node_served" | "not_enrolled";

export interface HostResidentRepository {
  repositoryRoot: string;
  state: HostResidentRepositoryState;
  /** A closed code such as `event_schema_outdated`; null unless held. */
  reason: string | null;
  /** The closed blocker code that kept automatic activation from clearing the hold. */
  detail: string | null;
}

/** ADR-0470 private host projection: which checkouts the host resident serves and why not. */
export interface HostKnowledgeResidentStatus {
  schemaVersion: 1;
  pid: number;
  startedAt: string;
  /** When the record was last written; liveness is the presence, never this age. */
  heartbeatAt: string;
  /** ADR-0602: the writer's process presence token; absent from earlier releases. */
  presence?: string;
  /** `service` when started by the Lervo-managed service definition; `manual` otherwise. */
  launch: "service" | "manual";
  /** `standby` while another host resident holds the host lock; it serves nothing. */
  role: "active" | "standby";
  repositories: HostResidentRepository[];
  /**
   * Scan progress, so a heartbeat that keeps beating while a scan never finishes is visible:
   * the last scan start and completion, and the checkout the running scan is admitting.
   */
  scan: {
    startedAt: string | null;
    completedAt: string | null;
    repositoryRoot: string | null;
  };
}

export type HostKnowledgeResidentReading =
  | { status: "absent" | "invalid" }
  | { status: "running" | "stale"; record: HostKnowledgeResidentStatus };

export function hostKnowledgeResidentStatusPath(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  try {
    return resolve(
      dirname(defaultRepositoryRegistryPath(environment)),
      HOST_KNOWLEDGE_RESIDENT_STATUS_FILE,
    );
  } catch {
    return null;
  }
}

function closedCode(value: unknown): string | null {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,127}$/u.test(value) ? value : null;
}

function parseRepository(value: unknown): HostResidentRepository | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.repositoryRoot !== "string" || !isAbsolute(entry.repositoryRoot)) return null;
  if (!["serving", "held", "node_served", "not_enrolled"].includes(String(entry.state)))
    return null;
  return {
    repositoryRoot: entry.repositoryRoot,
    state: entry.state as HostResidentRepositoryState,
    reason: closedCode(entry.reason),
    detail: closedCode(entry.detail),
  };
}

/** Pure: a validated record, or null when any field fails its contract. */
export function parseHostKnowledgeResidentStatus(
  value: unknown,
): HostKnowledgeResidentStatus | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    !Number.isSafeInteger(record.pid) ||
    (record.pid as number) < 1 ||
    typeof record.startedAt !== "string" ||
    Number.isNaN(Date.parse(record.startedAt)) ||
    typeof record.heartbeatAt !== "string" ||
    Number.isNaN(Date.parse(record.heartbeatAt)) ||
    (record.launch !== "service" && record.launch !== "manual") ||
    (record.role !== "active" && record.role !== "standby") ||
    (record.presence !== undefined &&
      (typeof record.presence !== "string" || !/^[0-9a-z-]{1,96}$/u.test(record.presence))) ||
    !Array.isArray(record.repositories) ||
    record.repositories.length > MAXIMUM_REPOSITORIES
  )
    return null;
  const repositories = record.repositories.map(parseRepository);
  if (repositories.some((entry) => entry === null)) return null;
  const scan = (record.scan ?? {}) as Record<string, unknown>;
  const instant = (value: unknown) =>
    typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
  return {
    schemaVersion: 1,
    pid: record.pid as number,
    startedAt: record.startedAt,
    heartbeatAt: record.heartbeatAt,
    ...(record.presence === undefined ? {} : { presence: record.presence as string }),
    launch: record.launch,
    role: record.role,
    repositories: repositories as HostResidentRepository[],
    scan: {
      startedAt: instant(scan.startedAt),
      completedAt: instant(scan.completedAt),
      repositoryRoot:
        typeof scan.repositoryRoot === "string" && isAbsolute(scan.repositoryRoot)
          ? scan.repositoryRoot
          : null,
    },
  };
}

/** Pure: a scan that started but has not completed within the stall bound. */
export function hostResidentScanStalled(status: HostKnowledgeResidentStatus, now: Date): boolean {
  const { startedAt, completedAt } = status.scan;
  return (
    startedAt !== null &&
    (completedAt === null || Date.parse(completedAt) < Date.parse(startedAt)) &&
    now.getTime() - Date.parse(startedAt) > HOST_KNOWLEDGE_RESIDENT_SCAN_STALL_MILLISECONDS
  );
}

export async function writeHostKnowledgeResidentStatus(
  path: string,
  status: HostKnowledgeResidentStatus,
): Promise<void> {
  await writePrivateJsonFile(path, {
    ...status,
    repositories: status.repositories.slice(0, MAXIMUM_REPOSITORIES),
  });
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function readHostKnowledgeResidentStatus(
  path: string,
  now: Date = new Date(),
  alive: (pid: number) => boolean = processAlive,
): Promise<HostKnowledgeResidentReading> {
  const file = await readPrivateJsonFile(path, MAXIMUM_STATUS_BYTES);
  if (file.status !== "read") return file;
  const record = parseHostKnowledgeResidentStatus(file.value);
  if (record === null) return { status: "invalid" };
  if (record.presence !== undefined) {
    const probe = await probeProcessPresence(record.presence);
    const running = probe === "alive" || (probe === "unknown" && alive(record.pid));
    return { status: running ? "running" : "stale", record };
  }
  const fresh =
    now.getTime() - Date.parse(record.heartbeatAt) <= HOST_KNOWLEDGE_RESIDENT_STALE_MILLISECONDS;
  return { status: fresh && alive(record.pid) ? "running" : "stale", record };
}

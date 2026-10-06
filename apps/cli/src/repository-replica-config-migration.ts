import { createHash, randomUUID } from "node:crypto";
import { chmod, copyFile, constants, link, lstat, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * ADR-0483: hosts configured before the managed replica service kept the coordinator
 * configuration at `~/.lervo/repository-replica-coordinator.json` and pinned the peer runtime to
 * one content-addressed payload. `lervo upgrade` moves it into the user state directory once,
 * converts the pin to the peer's runtimes directory, keeps a backup, and stops reading it.
 */
export const LEGACY_REPLICA_CONFIG = [".lervo", "repository-replica-coordinator.json"] as const;
export const LEGACY_REPLICA_CONFIG_BACKUP_SUFFIX = ".pre-adr-0483";
const PINNED_RUNTIME = /^(\/.+)\/[a-f0-9]{16}\/node-runtime\.js$/u;
const MAXIMUM_CONFIG_BYTES = 1024 * 1024;

/** How the migrated peer reaches its runtime; `explicit_override` is reported to the operator. */
export type MigratedPeerRuntime = "pointer" | "explicit_override";

export interface ReplicaConfigMigration {
  legacyPath: string;
  backupPath: string;
  legacyHash: string;
  content: string;
  contentHash: string;
  peerRuntime: MigratedPeerRuntime;
}

export type ReplicaConfigMigrationPlan =
  | { status: "none" }
  | { status: "invalid" }
  | { status: "migrate"; migration: ReplicaConfigMigration };

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Pure: the migrated configuration. A peer pinned to `<dir>/<hash16>/node-runtime.js` follows
 * `<dir>/current` instead; any other explicit runtime stays an override. Null when the value is
 * not a coordinator configuration at all; the coordinator validates the rest when it starts.
 */
export function migrateReplicaConfig(
  value: unknown,
): { config: Record<string, unknown>; peerRuntime: MigratedPeerRuntime } | null {
  if (!record(value) || !record(value.peer)) return null;
  const peer = { ...value.peer };
  const pinned =
    typeof peer.remoteRuntimeExecutable === "string" && peer.remoteRuntimesDirectory === undefined
      ? PINNED_RUNTIME.exec(peer.remoteRuntimeExecutable)
      : null;
  if (pinned !== null) {
    delete peer.remoteRuntimeExecutable;
    peer.remoteRuntimesDirectory = pinned[1]!;
  }
  return {
    config: { ...value, peer },
    peerRuntime: peer.remoteRuntimeExecutable === undefined ? "pointer" : "explicit_override",
  };
}

/**
 * The legacy location, or null when an explicit user state directory is set: such an
 * installation (or a test) never inherits the home directory's legacy file.
 */
export function legacyReplicaConfigPath(
  homeDirectory: string,
  environment: NodeJS.ProcessEnv,
): string | null {
  return environment.LERVO_USER_STATE_DIRECTORY === undefined
    ? resolve(homeDirectory, ...LEGACY_REPLICA_CONFIG)
    : null;
}

/** Read-only: whether a legacy configuration exists and what migrating it would write. */
export async function planReplicaConfigMigration(input: {
  legacyPath: string | null;
}): Promise<ReplicaConfigMigrationPlan> {
  if (input.legacyPath === null) return { status: "none" };
  let bytes: Buffer;
  try {
    const stat = await lstat(input.legacyPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAXIMUM_CONFIG_BYTES)
      return { status: "invalid" };
    bytes = await readFile(input.legacyPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "none" };
    throw error;
  }
  let migrated: ReturnType<typeof migrateReplicaConfig>;
  try {
    migrated = migrateReplicaConfig(JSON.parse(bytes.toString("utf8")));
  } catch {
    return { status: "invalid" };
  }
  if (migrated === null) return { status: "invalid" };
  const content = `${JSON.stringify(migrated.config, null, 2)}\n`;
  return {
    status: "migrate",
    migration: {
      legacyPath: input.legacyPath,
      backupPath: `${input.legacyPath}${LEGACY_REPLICA_CONFIG_BACKUP_SUFFIX}`,
      legacyHash: sha256(bytes),
      content,
      contentHash: sha256(content),
      peerRuntime: migrated.peerRuntime,
    },
  };
}

/**
 * Writes the backup and the migrated configuration, both owner-only. The target is published by
 * a hard link from a private temporary file, so it is created whole and never replaces a file.
 * The legacy file stays until the service runs from the migrated one.
 */
export async function writeMigratedReplicaConfig(
  migration: ReplicaConfigMigration,
  targetPath: string,
): Promise<void> {
  if (sha256(await readFile(migration.legacyPath)) !== migration.legacyHash)
    throw Object.assign(new Error("The legacy replica configuration changed after planning."), {
      code: "replica_service_plan_stale",
    });
  await copyFile(migration.legacyPath, migration.backupPath, constants.COPYFILE_EXCL);
  await chmod(migration.backupPath, 0o600);
  const temporary = `${targetPath}.${randomUUID()}.next`;
  try {
    await writeFile(temporary, migration.content, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await link(temporary, targetPath);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Stops reading the legacy file once the service runs from the migrated configuration. */
export async function retireLegacyReplicaConfig(migration: ReplicaConfigMigration): Promise<void> {
  if (sha256(await readFile(migration.legacyPath)) === migration.legacyHash)
    await rm(migration.legacyPath);
}

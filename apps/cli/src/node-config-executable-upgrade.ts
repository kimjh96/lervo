import { createHash } from "node:crypto";
import { lstat, mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  currentCliInstallRoot,
  pointCurrentCliInstall,
  readCurrentCliInstall,
  runningCliInstallRoot,
} from "./cli-install-pointer.js";
import { failNodeFleetApply } from "./node-fleet-apply-contract.js";
import {
  planNodeConfigExecutableMigration,
  type NodeConfigExecutableMigrationPlan,
} from "./node-config-executable-migration.js";
import { nodeRuntimesDirectory, readCurrentNodeRuntime } from "./node-runtime-pointer.js";

/**
 * ADR-0488 part of the repository Node upgrade stage. The plan carries hashes and field names,
 * never paths: whether the host CLI pointer must move to the running install, and whether the
 * Node configuration still pins a version-specific CLI or runtime path.
 */
export interface NodeConfigExecutablesStage {
  cliPointer: "current" | "create" | "update" | "not_installed";
  cliInstallDigest: string | null;
  config: "current" | "migrate" | "unreadable";
  sourceHash: string | null;
  migratedHash: string | null;
  rewrittenFields: string[];
  overrideFields: string[];
  retainedFields: string[];
}

export interface NodeConfigExecutablesInspection {
  stage: NodeConfigExecutablesStage;
  installRoot: string | null;
  migration: NodeConfigExecutableMigrationPlan | null;
}

export interface NodeConfigExecutablesOptions {
  homeDirectory?: string;
  /** The running CLI's `dist/bin.js`; tests substitute an installed fixture. */
  cliBin?: URL;
}

const MAXIMUM_CONFIG_BYTES = 1_048_576;
export const NODE_CONFIG_BACKUP_SUFFIX = ".pre-adr-0488";

const sha256 = (value: string | Uint8Array): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function readConfig(path: string): Promise<string | null> {
  const metadata = await lstat(path).catch(() => null);
  if (
    metadata === null ||
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size > MAXIMUM_CONFIG_BYTES
  )
    return null;
  return readFile(path, "utf8").catch(() => null);
}

export function nodeConfigExecutablesPending(stage: NodeConfigExecutablesStage): boolean {
  return (
    stage.cliPointer === "create" || stage.cliPointer === "update" || stage.config === "migrate"
  );
}

/** Read-only: observes the CLI pointer and plans the configuration rewrite. */
export async function inspectNodeConfigExecutables(
  configPath: string,
  options: NodeConfigExecutablesOptions = {},
): Promise<NodeConfigExecutablesInspection> {
  const installRoot = await runningCliInstallRoot(options.cliBin);
  const pointed = await readCurrentCliInstall(options.homeDirectory);
  const cliPointer: NodeConfigExecutablesStage["cliPointer"] =
    installRoot === null
      ? "not_installed"
      : pointed === installRoot
        ? "current"
        : pointed === null
          ? "create"
          : "update";
  const content = await readConfig(configPath);
  const migration =
    content === null
      ? null
      : planNodeConfigExecutableMigration({
          content,
          cliPointerRoot: currentCliInstallRoot(options.homeDirectory),
          runningInstallRoot: installRoot,
          nodeRuntimesDirectory: nodeRuntimesDirectory(options.homeDirectory),
          nodeRuntimePointerPresent: (await readCurrentNodeRuntime(options.homeDirectory)) !== null,
        });
  // Without an installed CLI there is no install to point at, so no rewrite is planned.
  const migrate = migration?.status === "migrate" && installRoot !== null;
  return {
    installRoot,
    migration,
    stage: {
      cliPointer,
      cliInstallDigest: installRoot === null ? null : sha256(installRoot),
      config:
        migration === null || migration.status === "invalid"
          ? "unreadable"
          : migrate
            ? "migrate"
            : "current",
      sourceHash: migration?.sourceHash ?? null,
      migratedHash: migrate ? migration.migratedHash : null,
      rewrittenFields: migrate ? migration.rewrites.map((item) => item.field) : [],
      overrideFields: migration?.overrideFields ?? [],
      retainedFields: migration?.retainedFields ?? [],
    },
  };
}

async function writeExclusive(path: string, bytes: string, mode: number): Promise<void> {
  const handle = await open(path, "wx", mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Keeps the first bytes for one source hash; an existing identical backup is reused. */
async function backUp(configPath: string, original: string): Promise<string> {
  const backup = `${configPath}${NODE_CONFIG_BACKUP_SUFFIX}-${sha256(original).slice(7, 19)}`;
  try {
    await writeExclusive(backup, original, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await readFile(backup, "utf8")) !== original)
      failNodeFleetApply(
        "node_config_backup_conflict",
        "A Node configuration backup with the same name holds different bytes.",
      );
  }
  return backup;
}

/** A prepared configuration migration that the guarded Node service transition applies. */
export interface PreparedNodeConfigExecutables {
  backupPath: string | null;
  /** An owner-only file holding the migrated bytes, or null when the configuration is current. */
  configurationSource: string | null;
  cleanup(): Promise<void>;
}

/**
 * Prepares an approved inspection: re-observes it, moves the CLI pointer, checks that every
 * rewritten path resolves, and backs up the configuration owner-only. ADR-0489: it never writes
 * the configuration itself. A running Node binds its work admission to the configuration digest,
 * so only the guarded service transition may replace the file, while the Node is stopped.
 */
export async function prepareNodeConfigExecutables(
  configPath: string,
  approved: NodeConfigExecutablesStage,
  options: NodeConfigExecutablesOptions = {},
): Promise<PreparedNodeConfigExecutables> {
  const current = await inspectNodeConfigExecutables(configPath, options);
  if (JSON.stringify(current.stage) !== JSON.stringify(approved))
    failNodeFleetApply(
      "node_config_executables_plan_stale",
      "The Node configuration executables changed after the upgrade plan was approved.",
    );
  if (current.installRoot !== null && current.stage.cliPointer !== "current")
    await pointCurrentCliInstall({
      installRoot: current.installRoot,
      ...(options.homeDirectory === undefined ? {} : { homeDirectory: options.homeDirectory }),
    });
  const migration = current.migration;
  if (current.stage.config !== "migrate" || migration?.migratedContent == null)
    return { backupPath: null, configurationSource: null, cleanup: async () => undefined };
  for (const rewrite of migration.rewrites) {
    if ((await stat(rewrite.to).catch(() => null)) === null)
      failNodeFleetApply(
        "node_config_executable_unresolved",
        `The stable path for ${rewrite.field} does not resolve to an installed path.`,
      );
  }
  const original = await readConfig(configPath);
  if (original === null || sha256(original) !== migration.sourceHash)
    failNodeFleetApply(
      "node_config_executables_plan_stale",
      "The Node configuration changed before its executables were migrated.",
    );
  const backupPath = await backUp(configPath, original);
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-node-config-"));
  const configurationSource = resolve(directory, "node-config-candidate.json");
  try {
    await writeExclusive(configurationSource, migration.migratedContent, 0o600);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    backupPath,
    configurationSource,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

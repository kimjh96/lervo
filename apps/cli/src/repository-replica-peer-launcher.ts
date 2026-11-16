import { readOwnerOnlyText } from "@lervo/runtime-security";
import { repositoryReplicaPeerLauncher } from "@lervo/sync";

import type { ReplicaConfigMigration } from "./repository-replica-config-migration.js";

const MAXIMUM_CONFIG_BYTES = 1024 * 1024;

/**
 * ADR-0570: the per-call launcher, such as `wsl.exe`, that every peer step of this host's
 * coordinator runs through, read from the configuration a pending migration would write when one
 * exists. An unreadable configuration reports none, and nothing is ever rewritten.
 */
export async function configuredReplicaPeerLauncher(
  configPath: string,
  migration: ReplicaConfigMigration | null,
): Promise<string | null> {
  try {
    const content =
      migration?.content ?? (await readOwnerOnlyText(configPath, MAXIMUM_CONFIG_BYTES));
    return repositoryReplicaPeerLauncher((JSON.parse(content) as { peer?: unknown }).peer);
  } catch {
    return null;
  }
}

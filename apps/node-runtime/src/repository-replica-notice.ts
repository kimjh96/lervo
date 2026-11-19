import { recordEffectNotice } from "@lervo/project";

import type { RepositoryReplicaBackup } from "./repository-replica-divergence-resolution.js";

/**
 * Quotes one POSIX shell word only when it needs it, so the printed undo command can be pasted as
 * is: the macOS coordinator config sits under `Application Support`.
 */
function shellWord(value: string): string {
  return /^[\w@%+=:,./-]+$/u.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The one command that restores the saved losing side and holds the repository (ADR-0561). */
export function repositoryReplicaRestoreCommand(input: {
  replicaId: string;
  backup: Pick<RepositoryReplicaBackup, "branch" | "side">;
  configPath?: string;
}): string {
  const config =
    input.configPath === undefined ? "<coordinator-config>" : shellWord(input.configPath);
  return `lervo-node repository-replica restore --config ${config} --replica ${shellWord(input.replicaId)} --side ${input.backup.side} --branch ${shellWord(input.backup.branch)}`;
}

/**
 * ADR-0561 step three for a replica conflict: the learned notice reports which side was saved to
 * which backup branch, on which host, and the command that restores it. It is recorded before
 * either side changes; a notice that cannot be recorded stops the resolution, which stays held.
 */
export async function noticeReplicaBackup(input: {
  repositoryRoot: string;
  replicaId: string;
  backup: RepositoryReplicaBackup;
  configPath?: string;
  now?: Date;
}): Promise<void> {
  const { backup } = input;
  await recordEffectNotice(input.repositoryRoot, {
    noticeId: `replica_backup:${backup.branch}`,
    occurredAt: (input.now ?? new Date()).toISOString(),
    effect: "replica_backup",
    targets: [input.replicaId, backup.branch, backup.snapshotHash],
    reason: `saved the ${backup.side} side of replica ${input.replicaId} on the ${backup.side} host before preferring the other side`,
    crossCheck: {
      reviewers: ["backup branch snapshot check", "unchanged sides check"],
      verdict: "agree",
    },
    undo: repositoryReplicaRestoreCommand({
      replicaId: input.replicaId,
      backup,
      ...(input.configPath === undefined ? {} : { configPath: input.configPath }),
    }),
  });
}

import { recordEffectNotice } from "@lervo/project";

import type { RepositoryReplicaBackup } from "./repository-replica-divergence-resolution.js";

/**
 * ADR-0561 step three for a settled replica conflict: the learned notice reports which side was
 * saved to which backup branch and how to restore it. A notice that cannot be recorded is lost;
 * the journal line stays and the settled replica is not undone.
 */
export async function noticeReplicaBackup(
  repositoryRoot: string,
  replicaId: string,
  backup: RepositoryReplicaBackup,
  now: Date = new Date(),
): Promise<void> {
  await recordEffectNotice(repositoryRoot, {
    noticeId: `replica_backup:${backup.branch}`,
    occurredAt: now.toISOString(),
    effect: "replica_backup",
    targets: [replicaId, backup.branch, backup.snapshotHash],
    reason: `saved the ${backup.side} side of replica ${replicaId} before preferring the other side`,
    crossCheck: {
      reviewers: ["backup branch snapshot check", "unchanged sides check"],
      verdict: "agree",
    },
    undo: `git checkout ${backup.branch}`,
  }).catch(() => undefined);
}

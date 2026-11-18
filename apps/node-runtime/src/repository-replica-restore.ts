import { holdRepository } from "@lervo/repository-knowledge-runtime";

import type { RepositoryReplicaPeerPort } from "./repository-replica-coordinator.js";

/**
 * ADR-0561 undo for a settled replica conflict, run on the coordinator host. It first holds the
 * replica's local repository, so the coordinator does not settle the restored divergence again,
 * then puts the saved losing side back on the host it came from: this host for `local`, the peer
 * over SSH for `peer`. `lervo repository release --root <local-root>` ends the hold.
 */
export async function restoreRepositoryReplicaSide(input: {
  repository: { replicaId: string; localRoot: string; peerRoot: string };
  restore: { side: "local" | "peer"; branch: string };
  local: RepositoryReplicaPeerPort;
  peer: RepositoryReplicaPeerPort;
  ports: { stdout(message: string): void; stderr(message: string): void };
  now: () => Date;
}): Promise<number> {
  const { repository, restore } = input;
  const port = restore.side === "local" ? input.local : input.peer;
  if (port.restoreBackup === undefined) {
    input.ports.stderr("This side cannot restore a replica backup.\n");
    return 1;
  }
  await holdRepository({
    repositoryRoot: repository.localRoot,
    reason: `replica ${repository.replicaId} backup ${restore.branch} restored`.slice(0, 200),
    now: input.now(),
  });
  const snapshot = await port.restoreBackup({
    repositoryRoot: restore.side === "local" ? repository.localRoot : repository.peerRoot,
    branch: restore.branch,
  });
  input.ports.stdout(
    `${JSON.stringify({
      schemaVersion: 1,
      operation: "repository_replica_backup_restored",
      replicaId: repository.replicaId,
      side: restore.side,
      branch: restore.branch,
      snapshotHash: snapshot.snapshotHash,
      heldRepository: repository.localRoot,
    })}\n`,
  );
  return 0;
}

import { randomUUID } from "node:crypto";

import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  applyReplicatedWorkstreamImportPlan,
  createReplicatedWorkstreamImportPlan,
} from "@lervo/repository-knowledge/workstream";
import type { ArtifactStore } from "@lervo/storage-contract";
import type { LocalWorkstreamRevision, WorkstreamReplicationLocalPort } from "@lervo/sync";

import { WorkstreamRevisionReader } from "./workstream-revision-reader.js";

export function createNodeWorkstreamLocalPort(storage: ProjectStorage) {
  if (!(storage.events instanceof SQLiteEventStore))
    throw new Error("Workstream replication requires the verified SQLite event adapter.");
  return new NodeWorkstreamReplicationLocalPort(
    storage.paths.repositoryRoot,
    storage.manifest.projectId,
    storage.events,
    storage.artifacts,
  );
}

export class NodeWorkstreamReplicationLocalPort implements WorkstreamReplicationLocalPort {
  private readonly reader: WorkstreamRevisionReader;

  constructor(
    private readonly repositoryRoot: string,
    private readonly projectId: string,
    private readonly events: SQLiteEventStore,
    private readonly artifacts: ArtifactStore,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.reader = new WorkstreamRevisionReader(repositoryRoot, events, artifacts, () =>
      now().getTime(),
    );
  }

  async readRevisionChain(): Promise<LocalWorkstreamRevision[]> {
    return this.reader.read();
  }

  async importCurrent(input: LocalWorkstreamRevision): Promise<void> {
    const plan = await createReplicatedWorkstreamImportPlan({
      repositoryRoot: this.repositoryRoot,
      projectId: this.projectId,
      snapshot: input.snapshot,
      snapshotContentHash: input.snapshotContentHash,
      previousSnapshotContentHash: input.previousSnapshotContentHash,
    });
    if (plan.status === "current") return;
    if (plan.status !== "ready") throw new Error("The replicated workstream import is blocked.");
    const identity = randomUUID().replaceAll("-", "");
    await applyReplicatedWorkstreamImportPlan({
      plan,
      now: this.now(),
      recordApplied: async (receipt, content) => {
        const artifact = await this.artifacts.put(content);
        if (artifact.contentHash !== receipt.snapshotContentHash) {
          throw new Error("The imported workstream artifact differs from the Hub binding.");
        }
        this.events.append({
          eventId: `evt_${identity}`,
          projectId: receipt.projectId,
          runId: `run_${identity}`,
          sessionId: `ses_${identity}`,
          type: "workstream.snapshot.recorded",
          occurredAt: receipt.appliedAt,
          actor: { kind: "system" },
          schemaVersion: 1,
          policyVersion: receipt.snapshotContentHash,
          payload: {
            workstreamId: receipt.workstreamId,
            revision: receipt.revision,
            status: receipt.status,
            changeKind: receipt.operation,
            snapshotArtifactId: `art_${receipt.snapshotContentHash.slice("sha256:".length)}`,
            snapshotContentHash: receipt.snapshotContentHash,
            previousSnapshotContentHash: receipt.previousSnapshotContentHash,
            sourceArtifactId: null,
            sourceContentHash: null,
            recordedAt: receipt.appliedAt,
          },
        });
      },
    });
  }
}

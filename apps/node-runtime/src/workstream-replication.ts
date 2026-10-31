import { randomUUID } from "node:crypto";

import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  applyReplicatedWorkstreamImportPlan,
  createReplicatedWorkstreamImportPlan,
  readCurrentWorkstreamState,
  readWorkstreamBranchBindings,
  writeWorkstreamBranchBindings,
  type ReplicatedWorkstreamLocalHead,
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

  /** The replicated lineage's local head when branches carry their own workstreams. */
  private async localHead(): Promise<ReplicatedWorkstreamLocalHead | undefined> {
    if ((await readWorkstreamBranchBindings(this.repositoryRoot)) === null) return undefined;
    const head = (await this.reader.read()).at(-1) ?? null;
    const projected = await readCurrentWorkstreamState(this.repositoryRoot);
    return {
      state:
        head === null ? null : { snapshot: head.snapshot, contentHash: head.snapshotContentHash },
      projectionSelected:
        head !== null && projected?.snapshot.workstreamId === head.snapshot.workstreamId,
    };
  }

  async importCurrent(input: LocalWorkstreamRevision): Promise<void> {
    const localHead = await this.localHead();
    const plan = await createReplicatedWorkstreamImportPlan({
      repositoryRoot: this.repositoryRoot,
      projectId: this.projectId,
      snapshot: input.snapshot,
      snapshotContentHash: input.snapshotContentHash,
      previousSnapshotContentHash: input.previousSnapshotContentHash,
      ...(localHead === undefined ? {} : { localHead }),
    });
    if (plan.status === "current") return;
    if (plan.status !== "ready") throw new Error("The replicated workstream import is blocked.");
    const identity = randomUUID().replaceAll("-", "");
    await applyReplicatedWorkstreamImportPlan({
      plan,
      now: this.now(),
      ...(localHead === undefined ? {} : { localHead }),
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
    const bindings = await readWorkstreamBranchBindings(this.repositoryRoot);
    if (
      bindings !== null &&
      bindings.bindings[bindings.defaultBranch] !== input.snapshot.workstreamId
    )
      // The plan admits a different workstream only as the bound lineage's successor.
      await writeWorkstreamBranchBindings(this.repositoryRoot, {
        ...bindings,
        bindings: { ...bindings.bindings, [bindings.defaultBranch]: input.snapshot.workstreamId },
      });
  }
}

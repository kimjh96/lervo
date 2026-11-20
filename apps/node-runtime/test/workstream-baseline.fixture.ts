// Frozen pre-optimization implementation at 77e52a3a7edc0ca2f074841364fa6f269f046568.
import { randomUUID } from "node:crypto";

import type { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { canonicalJson } from "@lervo/event-contract";
import {
  applyReplicatedWorkstreamImportPlan,
  createReplicatedWorkstreamImportPlan,
  readCurrentWorkstreamState,
} from "@lervo/repository-knowledge/workstream";
import { validateSchema, type WorkstreamSnapshotRecordedEventPayload } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import type { LocalWorkstreamRevision, WorkstreamReplicationLocalPort } from "@lervo/sync";

function artifactUri(contentHash: string): string {
  return `lervo-cas://sha256/${contentHash.slice("sha256:".length)}`;
}

function allEvents(store: SQLiteEventStore) {
  const events = [] as ReturnType<SQLiteEventStore["list"]>;
  let afterSeq = 0;
  while (true) {
    const page = store.list({ afterSeq, limit: 1_000 });
    if (page.length === 0) break;
    events.push(...page);
    afterSeq = page.at(-1)!.seq;
    if (page.length < 1_000) break;
  }
  return events;
}

export class NodeWorkstreamReplicationLocalPort implements WorkstreamReplicationLocalPort {
  constructor(
    private readonly repositoryRoot: string,
    private readonly projectId: string,
    private readonly events: SQLiteEventStore,
    private readonly artifacts: ArtifactStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async verifyForPublish(): Promise<void> {}

  async readRevisionChain(): Promise<LocalWorkstreamRevision[]> {
    const current = await readCurrentWorkstreamState(this.repositoryRoot);
    const recorded = allEvents(this.events).filter(
      (event) => event.type === "workstream.snapshot.recorded",
    );
    if (current === null) {
      if (recorded.length !== 0)
        throw new Error("The recorded current workstream projection is missing.");
      return [];
    }
    const byHash = new Map<string, WorkstreamSnapshotRecordedEventPayload>();
    for (const event of recorded) {
      const payload = event.payload as WorkstreamSnapshotRecordedEventPayload;
      byHash.set(payload.snapshotContentHash, payload);
    }
    const latest = recorded.at(-1)?.payload as WorkstreamSnapshotRecordedEventPayload | undefined;
    if (
      latest === undefined ||
      latest.snapshotContentHash !== current.contentHash ||
      latest.workstreamId !== current.snapshot.workstreamId ||
      latest.revision !== current.snapshot.revision
    )
      throw new Error("The current workstream differs from its latest event.");

    const reverse: LocalWorkstreamRevision[] = [];
    let nextHash: string | null = current.contentHash;
    const visited = new Set<string>();
    while (nextHash !== null) {
      if (visited.has(nextHash)) throw new Error("The local workstream ancestry contains a cycle.");
      visited.add(nextHash);
      const payload = byHash.get(nextHash);
      if (payload === undefined) break;
      const uri = artifactUri(nextHash);
      if (!(await this.artifacts.has(uri)))
        throw new Error("A local workstream snapshot artifact is missing.");
      const bytes = await this.artifacts.get(uri);
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      let snapshot: unknown;
      try {
        snapshot = JSON.parse(content);
      } catch {
        throw new Error("A local workstream snapshot artifact is not JSON.");
      }
      if (
        !validateSchema("workstreamSnapshot", snapshot).valid ||
        `${canonicalJson(snapshot)}\n` !== content ||
        (snapshot as { workstreamId: string }).workstreamId !== payload.workstreamId ||
        (snapshot as { revision: number }).revision !== payload.revision
      )
        throw new Error("A local workstream snapshot artifact does not match its event.");
      reverse.push({
        snapshot: snapshot as LocalWorkstreamRevision["snapshot"],
        snapshotContentHash: payload.snapshotContentHash,
        previousSnapshotContentHash: payload.previousSnapshotContentHash,
      });
      nextHash = payload.previousSnapshotContentHash;
    }
    return reverse.reverse();
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

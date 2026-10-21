import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { canonicalJson } from "@lervo/event-contract";
import type { SQLiteEventStore } from "@lervo/event-store-sqlite";
import {
  readCurrentWorkstreamState,
  readWorkstreamBranchBindings,
} from "@lervo/repository-knowledge/workstream";
import {
  isWorkstreamSuccessorRoot,
  validateSchema,
  type EventEnvelope,
  type WorkstreamSnapshotRecordedEventPayload,
} from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import type { LocalWorkstreamRevision } from "@lervo/sync";

const maximumCachedRevisions = 4_096;
const maximumCachedBytes = 32 * 1024 * 1024;

type Recorded = WorkstreamSnapshotRecordedEventPayload;

/** A rebuildable, process-local projection; persisted events and CAS remain authoritative. */
export class WorkstreamRevisionReader {
  private cursor: EventEnvelope | null = null;
  private recorded = new Map<string, Recorded>();
  private validated = new Map<string, LocalWorkstreamRevision>();
  private latestByWorkstream = new Map<string, Recorded>();
  private auditedAt: number | null = null;
  private cachedBytes = 0;
  private chain: { head: string; revisions: LocalWorkstreamRevision[] } | null = null;
  private databaseIdentity: string | null = null;
  private readonly auditIntervalMs: number;

  constructor(
    private readonly repositoryRoot: string,
    private readonly events: SQLiteEventStore,
    private readonly artifacts: ArtifactStore,
    private readonly now: () => number = Date.now,
  ) {
    const phase = createHash("sha256").update(repositoryRoot).digest().readUInt32BE(0);
    this.auditIntervalMs = 45_000 + (phase % 15_001);
  }

  private reset(): void {
    this.cursor = null;
    this.recorded.clear();
    this.validated.clear();
    this.latestByWorkstream.clear();
    this.auditedAt = null;
    this.cachedBytes = 0;
    this.chain = null;
  }

  async read(): Promise<LocalWorkstreamRevision[]> {
    try {
      return await this.readVerified();
    } catch (error) {
      this.reset();
      throw error;
    }
  }

  private async readVerified(): Promise<LocalWorkstreamRevision[]> {
    const metadata = await lstat(this.events.path, { bigint: true });
    const identity = `${metadata.dev}:${metadata.ino}`;
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      (this.databaseIdentity !== null && this.databaseIdentity !== identity)
    ) {
      throw new Error("The local event database was replaced; reopen the runtime.");
    }
    this.databaseIdentity = identity;
    const at = this.now();
    if (!Number.isFinite(at)) throw new Error("The workstream audit clock is invalid.");
    if (
      this.auditedAt === null ||
      at < this.auditedAt ||
      at - this.auditedAt >= this.auditIntervalMs
    ) {
      this.reset();
    } else if (this.cursor !== null) {
      const anchor = this.events.get(this.cursor.eventId);
      const tail = this.events.latest();
      if (
        anchor === null ||
        tail === null ||
        tail.seq < this.cursor.seq ||
        anchor.seq !== this.cursor.seq ||
        anchor.eventHash !== this.cursor.eventHash
      )
        this.reset();
    }
    const head = await this.replicatedHeadHash();
    if (head === null) {
      this.auditedAt ??= at;
      return [];
    }

    if (this.chain?.head === head) return structuredClone(this.chain.revisions);

    const reverse: LocalWorkstreamRevision[] = [];
    const visited = new Set<string>();
    let nextHash: string | null = head;
    while (nextHash !== null) {
      if (visited.has(nextHash)) throw new Error("The local workstream ancestry contains a cycle.");
      visited.add(nextHash);
      const payload = this.recorded.get(nextHash);
      // Imported histories may begin at a locally recorded non-root snapshot.
      if (payload === undefined) break;
      let revision = this.validated.get(nextHash);
      if (revision === undefined) {
        revision = await this.readArtifact(payload);
        this.validated.set(nextHash, revision);
      }
      reverse.push(revision);
      nextHash = payload.previousSnapshotContentHash;
    }
    this.auditedAt ??= at;
    const revisions = reverse.reverse();
    for (let index = 1; index < revisions.length; index += 1) {
      const parent = revisions[index - 1]!;
      const child = revisions[index]!;
      const sameWorkstream =
        child.snapshot.workstreamId === parent.snapshot.workstreamId &&
        child.snapshot.revision === parent.snapshot.revision + 1 &&
        canonicalJson(child.snapshot.origin) === canonicalJson(parent.snapshot.origin);
      const successor = isWorkstreamSuccessorRoot(child.snapshot, {
        ...parent.snapshot,
        snapshotContentHash: parent.snapshotContentHash,
      });
      if (!sameWorkstream && !successor)
        throw new Error("The local workstream revision ancestry is invalid.");
    }
    this.chain = { head, revisions };
    const result = structuredClone(this.chain.revisions);
    if (this.recorded.size > maximumCachedRevisions || this.cachedBytes > maximumCachedBytes)
      this.reset();
    return result;
  }

  /**
   * The replicated lineage is the workstream bound to the default branch. Branch-bound workstreams
   * stay in this checkout's history; without bindings, the selected projection is the lineage.
   */
  private async replicatedHeadHash(): Promise<string | null> {
    const [bindings, current] = await Promise.all([
      readWorkstreamBranchBindings(this.repositoryRoot),
      readCurrentWorkstreamState(this.repositoryRoot),
    ]);
    this.readNewEvents();
    if (bindings !== null) {
      const workstreamId = bindings.bindings[bindings.defaultBranch];
      const latest =
        workstreamId === undefined ? undefined : this.latestByWorkstream.get(workstreamId);
      if (latest === undefined) return null;
      if (
        current !== null &&
        current.snapshot.workstreamId === workstreamId &&
        current.contentHash !== latest.snapshotContentHash
      )
        throw new Error("The current workstream differs from its latest event.");
      return latest.snapshotContentHash;
    }
    if (current === null) {
      if (this.latestByWorkstream.size > 0)
        throw new Error("The recorded current workstream projection is missing.");
      return null;
    }
    const selected = this.latestByWorkstream.get(current.snapshot.workstreamId);
    if (
      selected?.snapshotContentHash !== current.contentHash ||
      selected.revision !== current.snapshot.revision
    )
      throw new Error("The current workstream differs from its latest event.");
    return current.contentHash;
  }

  private readNewEvents(): void {
    while (true) {
      const page = this.events.list({ afterSeq: this.cursor?.seq ?? 0, limit: 1_000 });
      for (const event of page) {
        if (
          event.seq !== (this.cursor?.seq ?? 0) + 1 ||
          event.previousHash !== (this.cursor?.eventHash ?? null)
        )
          throw new Error("The local workstream event chain is invalid.");
        if (event.type === "workstream.snapshot.recorded") {
          const payload = event.payload as Recorded;
          const previous = this.recorded.get(payload.snapshotContentHash);
          if (
            previous !== undefined &&
            (previous.previousSnapshotContentHash !== payload.previousSnapshotContentHash ||
              previous.workstreamId !== payload.workstreamId ||
              previous.revision !== payload.revision)
          ) {
            throw new Error("A local workstream hash has conflicting event bindings.");
          }
          this.recorded.set(payload.snapshotContentHash, payload);
          const previousHead = this.latestByWorkstream.get(payload.workstreamId);
          if (
            previousHead !== undefined &&
            (payload.revision < previousHead.revision ||
              (payload.revision === previousHead.revision &&
                payload.snapshotContentHash !== previousHead.snapshotContentHash))
          )
            throw new Error("A workstream has a forked or regressing local revision.");
          this.latestByWorkstream.set(payload.workstreamId, payload);
        }
        this.cursor = event;
      }
      if (page.length < 1_000) break;
    }
  }

  private async readArtifact(payload: Recorded): Promise<LocalWorkstreamRevision> {
    const uri = `lervo-cas://sha256/${payload.snapshotContentHash.slice("sha256:".length)}`;
    // get verifies both existence and hash. has would read and verify the same bytes again.
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
    this.cachedBytes += bytes.byteLength;
    return {
      snapshot: snapshot as LocalWorkstreamRevision["snapshot"],
      snapshotContentHash: payload.snapshotContentHash,
      previousSnapshotContentHash: payload.previousSnapshotContentHash,
    };
  }
}

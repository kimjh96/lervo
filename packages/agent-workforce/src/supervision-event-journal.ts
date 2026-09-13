import { createHash } from "node:crypto";
import { canonicalJson, type EventDraftV3 } from "@lervo/event-contract";
import {
  collectRunEventsBounded,
  type ArtifactStore,
  type EventStore,
} from "@lervo/storage-contract";
import { operatingContractHash } from "@lervo/work-controller";
import type {
  SQLiteSupervisionOwnerLeaseStore,
  SupervisionOwnerLease,
} from "./supervision-owner-lease.js";

export interface SupervisionJournalCoordinates {
  projectId: string;
  workstreamId: string;
  workstreamRevision: number;
  supervisionId: string;
  ownerAgentId: string;
  mandateHash: string;
  sessionId: string;
  policyVersion: string;
}

export class SupervisionEventJournal {
  private readonly runId: string;

  constructor(
    private readonly events: EventStore,
    private readonly artifacts: ArtifactStore,
    private readonly coordinates: SupervisionJournalCoordinates,
    private readonly now: () => string,
    private readonly fence: {
      store: SQLiteSupervisionOwnerLeaseStore;
      lease: SupervisionOwnerLease;
    } | null,
  ) {
    this.coordinates = structuredClone(coordinates);
    this.fence =
      fence === null ? null : { store: fence.store, lease: structuredClone(fence.lease) };
    if (
      fence !== null &&
      (fence.lease.supervisionId !== coordinates.supervisionId ||
        fence.lease.ownerAgentId !== coordinates.ownerAgentId)
    )
      throw new Error("The supervision journal differs from its owner lease.");
    this.runId = `run_${operatingContractHash({ supervisionId: coordinates.supervisionId }).slice(7, 39)}`;
  }

  async read(hash: string): Promise<unknown> {
    if (!/^sha256:[a-f0-9]{64}$/u.test(hash))
      throw new Error("The supervision artifact hash is invalid.");
    const bytes = await this.artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
    if (bytes.byteLength > 256 * 1024)
      throw new Error("The supervision artifact exceeds its bound.");
    if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== hash)
      throw new Error("The supervision artifact is corrupt.");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  async put(value: unknown): Promise<string> {
    const content = canonicalJson(value);
    if (Buffer.byteLength(content) > 256 * 1024)
      throw new Error("The supervision artifact exceeds its bound.");
    const artifact = await this.artifacts.put(content);
    if (artifact.contentHash !== `sha256:${createHash("sha256").update(content).digest("hex")}`)
      throw new Error("The supervision artifact hash differs from its contract hash.");
    return artifact.contentHash;
  }

  assertEventBinding(event: ReturnType<EventStore["list"]>[number]): void {
    if (
      event.schemaVersion !== 3 ||
      event.projectId !== this.coordinates.projectId ||
      event.runId !== this.runId ||
      event.payload.supervisionId !== this.coordinates.supervisionId ||
      event.payload.workstreamId !== this.coordinates.workstreamId
    )
      throw new Error("The supervision journal binding is invalid.");
  }

  history() {
    return collectRunEventsBounded({ events: this.events, runId: this.runId, maximumEvents: 4096 });
  }

  eventId(type: string, identity: string): string {
    return `evt_${operatingContractHash({ runId: this.runId, type, identity }).slice(7, 39)}`;
  }

  draft(
    type: EventDraftV3["type"],
    payload: Record<string, unknown>,
    identity: string,
  ): EventDraftV3 {
    return {
      eventId: this.eventId(type, identity),
      projectId: this.coordinates.projectId,
      runId: this.runId,
      sessionId: this.coordinates.sessionId,
      type,
      schemaVersion: 3,
      policyVersion: this.coordinates.policyVersion,
      occurredAt: this.now(),
      actor: { kind: "system" },
      payload,
    };
  }

  append(
    type: EventDraftV3["type"],
    payload: Record<string, unknown>,
    identity: string,
    validateCurrent?: () => void,
  ): void {
    if (this.fence === null) throw new Error("The supervision journal is read-only.");
    this.fence.store.commit(this.fence.lease, Date.parse(this.now()), () => {
      this.events.transact((transaction) => {
        validateCurrent?.();
        this.appendFenced(type, payload, identity, transaction);
      });
    });
  }

  private appendFenced(
    type: EventDraftV3["type"],
    payload: Record<string, unknown>,
    identity: string,
    transaction: Parameters<Parameters<EventStore["transact"]>[0]>[0],
  ): void {
    const eventId = this.eventId(type, identity);
    const existing = this.events.get(eventId);
    if (existing !== null) {
      this.assertEventBinding(existing);
      if (existing.type !== type || canonicalJson(existing.payload) !== canonicalJson(payload))
        throw new Error("The supervision event identity conflicts with existing evidence.");
      return;
    }
    if (this.history().length >= 4096)
      throw new Error("The supervision journal requires retained-history compaction.");
    const result = transaction.append(this.draft(type, payload, identity));
    if (result.redactions.length > 0)
      throw new Error("The supervision event payload was redacted.");
  }
}

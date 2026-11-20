import { canonicalJson } from "@lervo/event-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import { collectRunEventsBounded } from "@lervo/storage-contract";
import { operatingContractHash } from "@lervo/work-controller";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import type { NodeSupervisionSession } from "./supervision-session.js";
import {
  SupervisionPeerSource,
  type NodeSupervisionPeerConfiguration,
} from "./supervision-peer-source.js";
import {
  observeSupervisionPeerCatalog,
  type SupervisionPeerCatalogObservation,
} from "./supervision-peer-catalog-observation.js";
import { watchLocalEventChanges } from "./local-event-wakeup.js";

/** Change hints wake one owner; unchanged peer heads reuse a bounded view until the authority audit. */
export class SupervisionPeerCatalog {
  private readonly entries: {
    configuration: NodeSupervisionPeerConfiguration;
    routeHash: string;
    peer: SupervisionPeerSource | null;
    head: string | null;
    auditAt: number;
    stop: (() => void) | null;
  }[];
  private readonly published = new Map<string, string>();
  private initialized = false;
  private notify: (() => void) | undefined;
  constructor(
    private readonly storage: ProjectStorage,
    private readonly binding: NodeSupervisionBinding,
    peers: readonly NodeSupervisionPeerConfiguration[],
    private readonly now: () => string,
  ) {
    if (
      peers.length > 8 ||
      new Set(peers.map((peer) => peer.projectId)).size !== peers.length ||
      peers.some((peer) => peer.projectId === storage.manifest.projectId)
    )
      throw new Error("Peer observation requires at most eight distinct foreign projects.");
    this.entries = structuredClone([...peers]).map((configuration) => ({
      configuration,
      routeHash: operatingContractHash(configuration),
      peer: null,
      head: null,
      auditAt: 0,
      stop: null,
    }));
  }
  subscribe(notify: () => void) {
    this.notify = notify;
    for (const entry of this.entries) this.watch(entry);
    return () => {
      this.notify = undefined;
      for (const entry of this.entries) {
        entry.stop?.();
        entry.stop = null;
      }
    };
  }
  /** ADR-0602: the next retry of a peer that could not be opened; live peers wake by event. */
  nextAuditAt() {
    const retries = this.entries.map((entry) => entry.auditAt).filter((at) => Number.isFinite(at));
    return retries.length === 0 ? null : Math.min(...retries);
  }
  async refresh(owner: Pick<NodeSupervisionSession, "readAuthority" | "commit">) {
    const runId = `run_${operatingContractHash({ supervisionId: this.binding.supervisionId }).slice(7, 39)}`;
    if (!this.initialized) {
      for (const event of collectRunEventsBounded({
        events: this.storage.events,
        runId,
        maximumEvents: 4096,
      }))
        if (event.type === "work.supervision.peer.observed")
          this.published.set(
            String(event.payload.peerProjectId),
            String(event.payload.peerObservationHash),
          );
      this.initialized = true;
    }
    for (const entry of this.entries) {
      const now = Date.parse(this.now());
      if (entry.peer === null && now < entry.auditAt) continue;
      if (
        entry.peer !== null &&
        now < entry.auditAt &&
        (entry.peer.storage.events.latest()?.eventHash ?? null) === entry.head
      )
        continue;
      const unavailable: SupervisionPeerCatalogObservation = {
        schemaVersion: 1,
        kind: "work.peer_observation",
        projectId: entry.configuration.projectId,
        routeHash: entry.routeHash,
        status: "unavailable",
        authority: null,
        incoming: [],
        acceptances: [],
      };
      let observation: SupervisionPeerCatalogObservation;
      try {
        entry.peer ??= await SupervisionPeerSource.open(entry.configuration, this.now);
        this.watch(entry);
        observation = await observeSupervisionPeerCatalog({
          peer: entry.peer,
          supervisionId: entry.configuration.binding.supervisionId,
          projectId: this.storage.manifest.projectId,
          workstreamId: this.binding.workstreamId,
          routeHash: entry.routeHash,
        });
        entry.head = entry.peer.storage.events.latest()?.eventHash ?? null;
      } catch {
        entry.stop?.();
        entry.stop = null;
        await entry.peer?.close();
        entry.peer = null;
        entry.head = null;
        observation = unavailable;
      }
      // A live peer's event store wakes this catalog through its channel, so it is observed again
      // only on a change; one that could not be opened is retried after a minute.
      entry.auditAt = entry.peer === null ? now + 60_000 : Number.POSITIVE_INFINITY;
      await this.publish(observation, owner, runId);
    }
    for (const projectId of this.published.keys()) {
      if (this.entries.some((entry) => entry.configuration.projectId === projectId)) continue;
      await this.publish(
        {
          schemaVersion: 1,
          kind: "work.peer_observation",
          projectId,
          routeHash: operatingContractHash(null),
          status: "unavailable",
          authority: null,
          incoming: [],
          acceptances: [],
        },
        owner,
        runId,
      );
    }
  }
  private async publish(
    observation: SupervisionPeerCatalogObservation,
    owner: Pick<NodeSupervisionSession, "readAuthority" | "commit">,
    runId: string,
  ) {
    const hash = operatingContractHash(observation);
    if (this.published.get(observation.projectId) === hash) return;
    const authority = await owner.readAuthority();
    if (!authority.source.eligible || authority.installation.revoked)
      throw new Error("Peer observation lost its local owner authority.");
    const artifact = await this.storage.artifacts.put(canonicalJson(observation));
    if (artifact.contentHash !== hash) throw new Error("The peer view CAS hash changed.");
    const head = this.storage.events.latest();
    const payload = {
      schemaVersion: 1,
      projectId: this.storage.manifest.projectId,
      ...this.binding,
      workstreamRevision: authority.source.workstreamRevision,
      causationEventIds: authority.source.causationEventIds,
      peerProjectId: observation.projectId,
      routeHash: observation.routeHash,
      peerObservationHash: hash,
    };
    owner.commit(() =>
      this.storage.events.transact((transaction) => {
        if (this.storage.events.latest()?.eventHash !== head?.eventHash)
          throw new Error("The local source changed before recording peer observation.");
        if (
          collectRunEventsBounded({ events: this.storage.events, runId, maximumEvents: 4096 })
            .length >= 4096
        )
          throw new Error("The peer observation journal requires retained-history compaction.");
        const result = transaction.append({
          eventId: `evt_${operatingContractHash({ runId, hash, predecessor: head?.eventHash ?? null }).slice(7, 39)}`,
          projectId: this.storage.manifest.projectId,
          runId,
          sessionId: `ses_${operatingContractHash(this.binding).slice(7, 39)}`,
          schemaVersion: 3,
          type: "work.supervision.peer.observed",
          occurredAt: this.now(),
          policyVersion: this.binding.mandateHash,
          actor: { kind: "system" },
          payload,
        });
        if (result.redactions.length > 0) throw new Error("The peer observation was redacted.");
      }),
    );
    this.published.set(observation.projectId, hash);
  }
  private watch(entry: (typeof this.entries)[number]) {
    if (this.notify === undefined || entry.peer === null || entry.stop !== null) return;
    entry.stop = watchLocalEventChanges(
      {
        path: entry.peer.storage.paths.eventDatabase,
        latest: () => entry.peer!.storage.events.latest(),
      },
      this.notify,
    );
  }
  async close() {
    for (const entry of this.entries) {
      entry.stop?.();
      await entry.peer?.close();
    }
  }
}

import { randomUUID } from "node:crypto";
import {
  HubRuntimeChangeError,
  type HubKnowledgeChangeKind,
  type HubRuntimeChangeAnswer,
  type HubRuntimeChangeScope,
  type HubRuntimeChangeSource,
} from "@lervo/hub-sync";

/** The bounded hold older clients expect. */
const BOUNDED_HOLD_MILLISECONDS = 25_000;
/**
 * ADR-0602, the owner's decided end-to-end liveness bound: an `open` hold is answered `timeout`
 * after ten minutes, so a connection a proxy hop dropped silently, and its waiter here, never
 * outlive it, and the client waits again at once.
 */
export const HUB_OPEN_HOLD_MILLISECONDS = 10 * 60_000;
/**
 * ADR-0602: a host that stops waiting is reported absent only after this grace, so the gap between
 * one answered wait and the next never reads as a disconnection.
 */
export const HUB_PRESENCE_GRACE_MILLISECONDS = 5_000;
const MAXIMUM_WAITERS = 1_024;
const MAXIMUM_ENTRIES = 1_024;
const MAXIMUM_PRESENCE = 4_096;
/**
 * ADR-0602: hosts with a cursor in one scope. Past it, the host that waited least recently and is
 * not waiting now is forgotten; it is told no kinds when it returns, so it runs a full cycle.
 */
export const MAXIMUM_HOSTS_PER_SCOPE = 256;
const NO_HOST = "";

/**
 * One scope's cursors. ADR-0602: each waiting host has its own cursor, so a change a host made
 * itself never wakes it; hosts that wait without naming themselves share the empty key.
 */
/**
 * ADR-0602: per host, the kinds changed since each cursor it was recently handed, null once a
 * change of unknown kind joined them. Every change adds to each, and an answer starts one at the
 * cursor it hands out, so an answer lost on the way never loses a kind: the host asks again with
 * its earlier cursor and is told everything since. A cursor with no record is told no kinds, which
 * means anything may have changed.
 */
type KindsSince = Map<string, Set<HubKnowledgeChangeKind> | null>;
const MAXIMUM_KIND_RECORDS = 4;
type Entry = {
  cursors: Map<string, string>;
  listeners: Map<string, Set<() => void>>;
  kinds: Map<string, KindsSince>;
};

/** Makes room for one more host, forgetting the one that waited least recently and waits not. */
function evictLeastRecentlyWaited(entry: Entry): void {
  if (entry.cursors.size < MAXIMUM_HOSTS_PER_SCOPE) return;
  for (const host of entry.cursors.keys())
    if ((entry.listeners.get(host)?.size ?? 0) === 0) {
      entry.cursors.delete(host);
      entry.kinds.delete(host);
      entry.listeners.delete(host);
      return;
    }
  throw new HubRuntimeChangeError("capacity_exceeded");
}

/** Starts recording kinds from `cursor`, keeping only the most recent few starting points. */
function recordFrom(since: KindsSince, cursor: string): void {
  if (since.has(cursor)) return;
  since.set(cursor, new Set());
  while (since.size > MAXIMUM_KIND_RECORDS) since.delete(since.keys().next().value!);
}
type Presence = {
  waiting: number;
  connected: boolean;
  since: number;
  absent: NodeJS.Timeout | null;
};

export interface HubHostPresence {
  connected: boolean;
  since: string;
}

export class RuntimeChangeNotifications implements HubRuntimeChangeSource {
  private readonly entries = new Map<string, Entry>();
  private readonly presence = new Map<string, Presence>();
  private waiting = 0;
  private closed = false;

  constructor(
    private readonly now: () => number = Date.now,
    /**
     * ADR-0602: runs on a host's connection or departure, before its peers are woken, so state
     * that follows presence (the owner lease) is current when they read it.
     */
    private readonly onPresence?: (
      scope: HubRuntimeChangeScope,
      hostHash: string,
      connected: boolean,
    ) => readonly HubKnowledgeChangeKind[],
  ) {}

  private key(scope: HubRuntimeChangeScope): string {
    return JSON.stringify([
      scope.topic,
      scope.projectId,
      scope.repositoryIdentityHash,
      scope.topic === "workstream" ? null : scope.destinationId,
    ]);
  }

  private presenceKey(scope: HubRuntimeChangeScope, hostHash: string): string {
    return JSON.stringify([
      scope.destinationId,
      scope.projectId,
      scope.repositoryIdentityHash,
      hostHash,
    ]);
  }

  /** Every waiter of the scope wakes, except the host that made the change. */
  notify(
    scope: HubRuntimeChangeScope,
    sourceHostHash?: string,
    kinds?: readonly HubKnowledgeChangeKind[],
  ): void {
    const entry = this.entries.get(this.key(scope));
    if (entry === undefined) return;
    for (const [host, previous] of entry.cursors) {
      if (sourceHostHash !== undefined && host === sourceHostHash) continue;
      entry.cursors.set(host, randomUUID());
      const since = entry.kinds.get(host) ?? new Map();
      entry.kinds.set(host, since);
      recordFrom(since, previous);
      for (const [from, recorded] of since)
        if (recorded !== null)
          if (kinds === undefined) since.set(from, null);
          else for (const kind of kinds) recorded.add(kind);
      for (const listener of [...(entry.listeners.get(host) ?? [])]) listener();
    }
  }

  /**
   * ADR-0602: whether a host holds a `knowledge` wait for this scope, by the Hub's clock. Null for
   * a host never seen waiting since the Hub started, such as one of an earlier release that names
   * no host: unknown, never absent.
   */
  hostPresence(
    scope: Omit<HubRuntimeChangeScope, "topic">,
    hostHash: string,
  ): HubHostPresence | null {
    const state = this.presence.get(this.presenceKey({ ...scope, topic: "knowledge" }, hostHash));
    return state === undefined
      ? null
      : { connected: state.connected, since: new Date(state.since).toISOString() };
  }

  private entry(key: string): Entry {
    let entry = this.entries.get(key);
    if (entry === undefined) {
      if (this.entries.size >= MAXIMUM_ENTRIES) {
        const unused = [...this.entries].find(([, value]) =>
          [...value.listeners.values()].every((set) => set.size === 0),
        );
        if (unused === undefined) throw new HubRuntimeChangeError("capacity_exceeded");
        this.entries.delete(unused[0]);
      }
      entry = { cursors: new Map(), listeners: new Map(), kinds: new Map() };
      this.entries.set(key, entry);
    }
    return entry;
  }

  /** A connection after the grace is a change peers should see; a re-wait within it is not. */
  private arrive(scope: HubRuntimeChangeScope, hostHash: string): () => void {
    const key = this.presenceKey(scope, hostHash);
    let state = this.presence.get(key);
    if (state === undefined) {
      if (this.presence.size >= MAXIMUM_PRESENCE) {
        const stale = [...this.presence].find(([, value]) => !value.connected);
        if (stale === undefined) throw new HubRuntimeChangeError("capacity_exceeded");
        this.presence.delete(stale[0]);
      }
      state = { waiting: 0, connected: false, since: this.now(), absent: null };
      this.presence.set(key, state);
    }
    const tracked = state;
    if (tracked.absent !== null) clearTimeout(tracked.absent);
    tracked.absent = null;
    tracked.waiting += 1;
    if (!tracked.connected) {
      tracked.connected = true;
      tracked.since = this.now();
      const also = this.onPresence?.(scope, hostHash, true) ?? [];
      this.notify(scope, hostHash, ["presence", ...also]);
    }
    return () => {
      tracked.waiting -= 1;
      if (tracked.waiting > 0 || this.closed) return;
      // One-shot, armed only by a departure; a returning wait cancels it.
      tracked.absent = setTimeout(() => {
        tracked.absent = null;
        if (tracked.waiting > 0) return;
        tracked.connected = false;
        tracked.since = this.now();
        const also = this.onPresence?.(scope, hostHash, false) ?? [];
        this.notify(scope, hostHash, ["presence", ...also]);
      }, HUB_PRESENCE_GRACE_MILLISECONDS);
      tracked.absent.unref();
    };
  }

  async waitForRuntimeChange(
    input: Parameters<HubRuntimeChangeSource["waitForRuntimeChange"]>[0],
  ): Promise<HubRuntimeChangeAnswer> {
    if (this.closed) throw new HubRuntimeChangeError("source_closed");
    if (this.waiting >= MAXIMUM_WAITERS) throw new HubRuntimeChangeError("capacity_exceeded");
    const selected = this.entry(this.key(input));
    const host = input.topic === "knowledge" ? (input.hostHash ?? NO_HOST) : NO_HOST;
    let cursor = selected.cursors.get(host);
    if (cursor === undefined) {
      evictLeastRecentlyWaited(selected);
      cursor = randomUUID();
    }
    // Insertion order is the order hosts last waited in.
    selected.cursors.delete(host);
    selected.cursors.set(host, cursor);
    const since: KindsSince = selected.kinds.get(host) ?? new Map();
    selected.kinds.set(host, since);
    // Caught up: what came before this cursor was told, so only its own record stays.
    if (input.cursor === cursor) {
      for (const from of [...since.keys()]) if (from !== cursor) since.delete(from);
      recordFrom(since, cursor);
    }
    const changed = (at: string): HubRuntimeChangeAnswer => {
      const kinds = input.cursor === null ? null : (since.get(input.cursor) ?? null);
      recordFrom(since, at);
      return input.topic === "knowledge" && kinds !== null && kinds.size > 0
        ? { cursor: at, status: "changed", kinds: [...kinds].sort() }
        : { cursor: at, status: "changed" };
    };
    if (input.cursor !== cursor) return changed(cursor);
    const leave =
      input.topic === "knowledge" && input.hostHash !== undefined
        ? this.arrive(input, input.hostHash)
        : () => undefined;
    // `arrive` may have changed this host's cursor only if it were the source, which it is not.
    const listeners = selected.listeners.get(host) ?? new Set<() => void>();
    selected.listeners.set(host, listeners);
    this.waiting += 1;
    try {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(
          finish,
          input.hold === "open" ? HUB_OPEN_HOLD_MILLISECONDS : BOUNDED_HOLD_MILLISECONDS,
        );
        listeners.add(finish);
        input.signal.addEventListener("abort", finish, { once: true });
        if (input.signal.aborted || this.closed) finish();
        function finish(): void {
          clearTimeout(timer);
          listeners.delete(finish);
          input.signal.removeEventListener("abort", finish);
          resolve();
        }
      });
    } finally {
      this.waiting -= 1;
      leave();
    }
    const current = selected.cursors.get(host) ?? cursor;
    return input.cursor === current ? { cursor: current, status: "timeout" } : changed(current);
  }

  close(): void {
    this.closed = true;
    for (const entry of this.entries.values())
      for (const set of entry.listeners.values()) for (const listener of [...set]) listener();
    this.entries.clear();
    for (const state of this.presence.values())
      if (state.absent !== null) clearTimeout(state.absent);
    this.presence.clear();
  }
}

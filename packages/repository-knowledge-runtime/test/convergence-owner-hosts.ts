import { execFile } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { FileSystemCas } from "@lervo/cas";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { loadProjectManifest, resolveProjectPaths } from "@lervo/project";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  decideKnowledgeConvergenceOwnerMutation,
  readKnowledgeConvergenceOwnerLease,
  type KnowledgeConvergenceOwnerLease,
} from "@lervo/sync-contract";

import type { ConvergenceOwnerLeasePort } from "../src/convergence-owner.js";
import type { KnowledgeHubChangeTransport } from "../src/hub-knowledge-changes.js";
import { CONVERGENCE_OWNER_HOST_PATH } from "../src/convergence-owner-host.js";

const execute = promisify(execFile);

/** An in-memory Hub lease service with the production decision, a settable clock and outages. */
export class FakeConvergenceOwnerHub {
  lease: KnowledgeConvergenceOwnerLease | null = null;
  available = true;
  /** The cause a failing request carries, as the Hub client attaches it. */
  failure: { failureCode: string; httpStatus: number | null } | null = null;
  requests = 0;

  /** ADR-0602 `knowledge` change waits: one cursor per waiting host, as the Hub keeps them. */
  private readonly cursors = new Map<string, number>();
  private readonly waiters = new Set<() => void>();
  waits = 0;
  /**
   * ADR-0602, opt-in: presence as the Hub keeps it. A host holding a change wait is present; while
   * the holder is, decisions report it and its lease stays live; its departure is pushed at once
   * (the Hub's grace aside) as `presence` and `lease`, with the stored expiry kept.
   */
  private readonly present = new Map<string, number>();
  private readonly kinds = new Map<string, Set<string>>();

  constructor(
    private readonly clock: () => number,
    private readonly options: { presence?: boolean } = {},
  ) {}

  private notify(sourceHostHash: string, kinds: string[] = ["lease"]): void {
    for (const host of this.cursors.keys())
      if (host !== sourceHostHash) {
        this.cursors.set(host, this.cursors.get(host)! + 1);
        const pending = this.kinds.get(host) ?? new Set<string>();
        for (const kind of kinds) pending.add(kind);
        this.kinds.set(host, pending);
      }
    for (const wake of [...this.waiters]) wake();
  }

  private holderPresent(): boolean {
    return (this.present.get(this.lease?.holderHostHash ?? "") ?? 0) > 0;
  }

  private arrive(host: string): () => void {
    if (this.options.presence !== true || host === "") return () => undefined;
    this.present.set(host, (this.present.get(host) ?? 0) + 1);
    return () => {
      const left = this.present.get(host)! - 1;
      this.present.set(host, left);
      if (left > 0) return;
      const holder = this.lease?.holderHostHash === host && this.lease.releasedAt === null;
      this.notify(host, holder ? ["lease", "presence"] : ["presence"]);
    };
  }

  changes(): KnowledgeHubChangeTransport {
    return async () => ({
      wait: ({ cursor, hostHash, signal }) => {
        this.waits++;
        const host = hostHash ?? "";
        if (!this.cursors.has(host)) this.cursors.set(host, 1);
        const current = () =>
          `00000000-0000-4000-8000-${String(this.cursors.get(host)).padStart(12, "0")}`;
        const answer = () => {
          const kinds = this.kinds.get(host);
          this.kinds.delete(host);
          return kinds === undefined || this.options.presence !== true
            ? { cursor: current() }
            : { cursor: current(), kinds: [...kinds].sort() };
        };
        if (cursor !== current()) return Promise.resolve(answer());
        const leave = this.arrive(host);
        return new Promise((resolveWait, rejectWait) => {
          const wake = () => {
            if (cursor === current()) return;
            this.waiters.delete(wake);
            leave();
            resolveWait(answer());
          };
          this.waiters.add(wake);
          signal.addEventListener(
            "abort",
            () => {
              this.waiters.delete(wake);
              leave();
              rejectWait(signal.reason);
            },
            { once: true },
          );
        });
      },
    });
  }

  port(): ConvergenceOwnerLeasePort {
    return {
      mutate: async (mutation) => {
        this.requests++;
        if (this.failure !== null) throw Object.assign(new Error("hub refused"), this.failure);
        if (!this.available) throw new Error("hub unavailable");
        // A present holder's lease is live whatever its recorded expiry, as on the Hub.
        const present = this.holderPresent();
        if (present && this.lease !== null && this.lease.releasedAt === null)
          this.lease = {
            ...this.lease,
            expiresAt: new Date(
              Math.max(Date.parse(this.lease.expiresAt), this.clock() + 5_000),
            ).toISOString(),
          };
        const { next, decision } = decideKnowledgeConvergenceOwnerMutation({
          current: this.lease,
          mutation,
          acceptedAt: new Date(this.clock()).toISOString(),
        });
        this.lease = next;
        // ADR-0602: a new holder or a release wakes every other host's change wait.
        if (decision.status === "granted" || decision.status === "released")
          this.notify(mutation.request.hostHash);
        return structuredClone(
          this.options.presence === true ? { ...decision, holderPresent: present } : decision,
        );
      },
      read: async () => {
        if (!this.available) throw new Error("hub unavailable");
        return readKnowledgeConvergenceOwnerLease({
          current: this.lease,
          acceptedAt: new Date(this.clock()).toISOString(),
        });
      },
    };
  }
}

export async function writeHostConfig(
  root: string,
  input: { hostId: string; label: string; mode: "hub" | "standalone" },
): Promise<void> {
  await mkdir(resolve(root, ".lervo/state/knowledge"), { recursive: true, mode: 0o700 });
  await writeFile(
    resolve(root, CONVERGENCE_OWNER_HOST_PATH),
    JSON.stringify({
      schemaVersion: 1,
      hostId: input.hostId,
      hostLabel: input.label,
      coordination:
        input.mode === "standalone"
          ? { mode: "standalone" }
          : {
              mode: "hub",
              hub: {
                baseUrl: "https://hub.invalid",
                bearerTokenFile: "/nonexistent/hub-token",
                destinationId: "hub-fixture",
                hubIdentityHash: `sha256:${"a".repeat(64)}`,
              },
            },
    }),
    { mode: 0o600 },
  );
}

/**
 * A second host: a Git clone of the first checkout with its own event store and its own copy of
 * the host-local delegation, as on a peer that applied the same reviewed grant.
 */
export async function peerHost(input: {
  sourceRoot: string;
  directory: string;
}): Promise<{ root: string; storage: ProjectStorage }> {
  const root = resolve(input.directory, "peer");
  await execute("git", ["clone", "--quiet", input.sourceRoot, root]);
  await copyFile(
    resolve(input.sourceRoot, ".lervo/knowledge/convergence-delegation.json"),
    resolve(root, ".lervo/knowledge/convergence-delegation.json"),
  );
  const paths = resolveProjectPaths(root);
  await mkdir(paths.data, { recursive: true });
  const manifest = await loadProjectManifest(root);
  const events = await SQLiteEventStore.open({
    path: paths.eventDatabase,
    projectId: manifest.projectId,
    writableEventSchemaVersion: 4,
  });
  const artifacts = await FileSystemCas.open(paths.cas);
  return {
    root,
    storage: {
      manifest,
      paths,
      events,
      artifacts,
      writableEventSchemaVersion: 4,
      close: async () => events.close(),
    },
  };
}

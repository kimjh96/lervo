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
import { CONVERGENCE_OWNER_HOST_PATH } from "../src/convergence-owner-host.js";

const execute = promisify(execFile);

/** An in-memory Hub lease service with the production decision, a settable clock and outages. */
export class FakeConvergenceOwnerHub {
  lease: KnowledgeConvergenceOwnerLease | null = null;
  available = true;
  requests = 0;

  constructor(private readonly clock: () => number) {}

  port(): ConvergenceOwnerLeasePort {
    return {
      mutate: async (mutation) => {
        this.requests++;
        if (!this.available) throw new Error("hub unavailable");
        const { next, decision } = decideKnowledgeConvergenceOwnerMutation({
          current: this.lease,
          mutation,
          acceptedAt: new Date(this.clock()).toISOString(),
        });
        this.lease = next;
        return structuredClone(decision);
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

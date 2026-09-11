import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  assertRepositoryReplicaSnapshot,
  reconcileRepositoryReplicas,
  type RepositoryReplicaSnapshot,
} from "@lervo/sync";

import {
  applyRepositoryReplicaBundle,
  captureRepositoryReplicaSnapshot,
  createRepositoryReplicaBundle,
} from "./repository-replica-git.js";

const REPLICA_ID = /^[a-z][a-z0-9_-]{1,63}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;

export interface RepositoryReplicaPeerPort {
  snapshot(repositoryRoot: string): Promise<RepositoryReplicaSnapshot>;
  bundle(repositoryRoot: string): Promise<Uint8Array>;
  apply(input: {
    repositoryRoot: string;
    bundle: Uint8Array;
    expectedCurrentSnapshotHash: string;
    allowHistoryReplacement?: boolean;
  }): Promise<RepositoryReplicaSnapshot>;
  recordReceipt(input: RepositoryReplicaReceipt): Promise<void>;
}

export interface RepositoryReplicaReceipt {
  schemaVersion: 1;
  replicaId: string;
  repositoryRoot: string;
  commonSnapshotHash: string;
  localSnapshotHash: string;
  peerSnapshotHash: string;
  reconciledAt: string;
  status: "current" | "pushed" | "pulled";
}

interface RepositoryReplicaCoordinatorState {
  schemaVersion: 1;
  replicas: Record<string, { commonSnapshotHash: string; reconciledAt: string }>;
}

export type RepositoryReplicaCycleResult =
  | { replicaId: string; status: "current" | "pushed" | "pulled"; snapshotHash: string }
  | {
      replicaId: string;
      status: "divergent";
      localHash: string;
      peerHash: string;
      commonHash: string | null;
    };

export class RepositoryReplicaCoordinatorError extends Error {
  constructor(
    readonly code:
      | "repository_replica_config_invalid"
      | "repository_replica_state_invalid"
      | "repository_replica_divergent"
      | "repository_replica_verification_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RepositoryReplicaCoordinatorError";
  }
}

function emptyState(): RepositoryReplicaCoordinatorState {
  return { schemaVersion: 1, replicas: {} };
}

async function readState(path: string): Promise<RepositoryReplicaCoordinatorState> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw new RepositoryReplicaCoordinatorError(
      "repository_replica_state_invalid",
      "The repository replica coordinator state could not be read.",
      { cause: error },
    );
  }
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    typeof (value as { replicas?: unknown }).replicas !== "object" ||
    (value as { replicas?: unknown }).replicas === null
  ) {
    throw new RepositoryReplicaCoordinatorError(
      "repository_replica_state_invalid",
      "The repository replica coordinator state is invalid.",
    );
  }
  const state = value as RepositoryReplicaCoordinatorState;
  if (
    Object.entries(state.replicas).some(
      ([replicaId, item]) =>
        !REPLICA_ID.test(replicaId) ||
        !HASH.test(item.commonSnapshotHash) ||
        !Number.isFinite(Date.parse(item.reconciledAt)),
    )
  ) {
    throw new RepositoryReplicaCoordinatorError(
      "repository_replica_state_invalid",
      "A repository replica coordinator state entry is invalid.",
    );
  }
  return state;
}

async function writeState(path: string, state: RepositoryReplicaCoordinatorState): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.next`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export class LocalRepositoryReplicaPeer implements RepositoryReplicaPeerPort {
  snapshot(repositoryRoot: string) {
    return captureRepositoryReplicaSnapshot(repositoryRoot);
  }

  bundle(repositoryRoot: string) {
    return createRepositoryReplicaBundle(repositoryRoot);
  }

  apply(input: {
    repositoryRoot: string;
    bundle: Uint8Array;
    expectedCurrentSnapshotHash: string;
  }) {
    return applyRepositoryReplicaBundle(input);
  }

  async recordReceipt(input: RepositoryReplicaReceipt): Promise<void> {
    const path = resolve(input.repositoryRoot, ".lervo/state/repository-replica.json");
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.next`;
    await writeFile(temporary, `${JSON.stringify(input, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  }
}

export class RepositoryReplicaCoordinator {
  constructor(
    private readonly options: {
      stateFile: string;
      local: RepositoryReplicaPeerPort;
      peer: RepositoryReplicaPeerPort;
      now?: () => Date;
    },
  ) {}

  async reconcile(input: {
    replicaId: string;
    localRoot: string;
    peerRoot: string;
  }): Promise<RepositoryReplicaCycleResult> {
    if (!REPLICA_ID.test(input.replicaId)) {
      throw new RepositoryReplicaCoordinatorError(
        "repository_replica_config_invalid",
        "The repository replica ID is invalid.",
      );
    }
    const state = await readState(this.options.stateFile);
    const [local, peer] = await Promise.all([
      this.options.local.snapshot(input.localRoot),
      this.options.peer.snapshot(input.peerRoot),
    ]);
    assertRepositoryReplicaSnapshot(local);
    assertRepositoryReplicaSnapshot(peer);
    const common = state.replicas[input.replicaId]?.commonSnapshotHash ?? null;
    const decision = reconcileRepositoryReplicas({ local, peer, commonSnapshotHash: common });
    if (decision.status === "divergent") {
      return { replicaId: input.replicaId, ...decision };
    }
    let status: "current" | "pushed" | "pulled" = "current";
    if (decision.status === "push") {
      const bundle = await this.options.local.bundle(input.localRoot);
      await this.options.peer.apply({
        repositoryRoot: input.peerRoot,
        bundle,
        expectedCurrentSnapshotHash: decision.expectedPeerHash,
        allowHistoryReplacement: true,
      });
      status = "pushed";
    } else if (decision.status === "pull") {
      const bundle = await this.options.peer.bundle(input.peerRoot);
      await this.options.local.apply({
        repositoryRoot: input.localRoot,
        bundle,
        expectedCurrentSnapshotHash: decision.expectedLocalHash,
        allowHistoryReplacement: true,
      });
      status = "pulled";
    }
    const [verifiedLocal, verifiedPeer] = await Promise.all([
      this.options.local.snapshot(input.localRoot),
      this.options.peer.snapshot(input.peerRoot),
    ]);
    if (verifiedLocal.snapshotHash !== verifiedPeer.snapshotHash) {
      throw new RepositoryReplicaCoordinatorError(
        "repository_replica_verification_failed",
        "Repository replicas differ after reconciliation.",
      );
    }
    const reconciledAt = (this.options.now ?? (() => new Date()))().toISOString();
    state.replicas[input.replicaId] = {
      commonSnapshotHash: verifiedLocal.snapshotHash,
      reconciledAt,
    };
    await writeState(this.options.stateFile, state);
    const receipt = (repositoryRoot: string): RepositoryReplicaReceipt => ({
      schemaVersion: 1,
      replicaId: input.replicaId,
      repositoryRoot,
      commonSnapshotHash: verifiedLocal.snapshotHash,
      localSnapshotHash: verifiedLocal.snapshotHash,
      peerSnapshotHash: verifiedPeer.snapshotHash,
      reconciledAt,
      status,
    });
    await Promise.all([
      this.options.local.recordReceipt(receipt(input.localRoot)),
      this.options.peer.recordReceipt(receipt(input.peerRoot)),
    ]);
    return { replicaId: input.replicaId, status, snapshotHash: verifiedLocal.snapshotHash };
  }
}

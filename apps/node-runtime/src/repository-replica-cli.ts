import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  parseKnowledgeSupersessionEntries,
  reconcileKnowledgeSupersession,
} from "@lervo/repository-knowledge-runtime";

import { readRepositoryReplicaCoordinatorConfig } from "./repository-replica-config.js";
import { type RepositoryReplicaReceipt } from "./repository-replica-coordinator.js";
import { LocalRepositoryReplicaPeer } from "./repository-replica-local-peer.js";
import { runRepositoryReplicaCoordinator } from "./repository-replica-coordinator-run.js";
import {
  describeRepositoryReplicaFailure,
  encodeRepositoryReplicaPeerFailure,
  type RepositoryReplicaStage,
} from "./repository-replica-failure.js";
import { REPOSITORY_REPLICA_CAPTURE_VERSION } from "./repository-replica-capture-version.js";
import {
  applyRepositoryReplicaBundle,
  createRepositoryReplicaBundle,
} from "./repository-replica-git.js";
import { observeRepositoryReplicaSnapshot } from "./repository-replica-snapshot-cache.js";
import { publishRepositoryChangeHints } from "./repository-replica-watch.js";

export interface RepositoryReplicaCliPorts {
  cwd: string;
  stdinBytes(): Promise<Uint8Array>;
  stdout(message: string): void;
  stdoutBytes(bytes: Uint8Array): void;
  stderr(message: string): void;
  signal?: AbortSignal;
}

const MAXIMUM_REPOSITORY_REPLICA_BUNDLE_BYTES = 512 * 1024 * 1024;
const PEER_ACTION_STAGES: Record<string, RepositoryReplicaStage> = {
  snapshot: "snapshot",
  bundle: "bundle",
  apply: "apply",
  adopt: "apply",
  receipt: "verify",
  "knowledge-supersession": "supersession",
};

function oneOption(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  if (
    index < 0 ||
    args[index + 1] === undefined ||
    args.filter((item) => item === name).length !== 1
  ) {
    throw new Error(`Repository replica ${name} is required exactly once.`);
  }
  return args[index + 1]!;
}

async function readBundleInput(
  args: readonly string[],
  ports: RepositoryReplicaCliPorts,
): Promise<Uint8Array> {
  const optionIndex = args.indexOf("--bundle-file");
  if (optionIndex < 0) return ports.stdinBytes();
  const path = args[optionIndex + 1];
  if (path === undefined || args.filter((item) => item === "--bundle-file").length !== 1) {
    throw new Error("Repository replica --bundle-file is required exactly once when present.");
  }
  const resolved = resolve(ports.cwd, path);
  const metadata = await stat(resolved);
  if (!metadata.isFile() || metadata.size > MAXIMUM_REPOSITORY_REPLICA_BUNDLE_BYTES) {
    throw new Error("The repository replica bundle file is invalid or exceeds its bound.");
  }
  return new Uint8Array(await readFile(resolved));
}

/** One peer-side step, invoked by the coordinator over SSH. */
async function runPeerAction(
  action: string,
  args: readonly string[],
  ports: RepositoryReplicaCliPorts,
): Promise<void> {
  const root = resolve(ports.cwd, oneOption(args, "--root"));
  if (action === "snapshot") {
    ports.stdout(`${JSON.stringify(await observeRepositoryReplicaSnapshot(root))}\n`);
    return;
  }
  if (action === "bundle") {
    const expected = args.includes("--expected") ? oneOption(args, "--expected") : undefined;
    ports.stdoutBytes(await createRepositoryReplicaBundle(root, expected));
    return;
  }
  if (action === "apply" || action === "adopt") {
    const applied = await applyRepositoryReplicaBundle({
      repositoryRoot: root,
      bundle: await readBundleInput(args, ports),
      expectedCurrentSnapshotHash: oneOption(args, "--expected"),
      ...(action === "adopt" ? { allowHistoryReplacement: true } : {}),
    });
    ports.stdout(`${JSON.stringify(applied)}\n`);
    return;
  }
  if (action === "knowledge-supersession") {
    const request = JSON.parse(Buffer.from(await ports.stdinBytes()).toString("utf8")) as {
      entries?: unknown;
    };
    const entries = parseKnowledgeSupersessionEntries(request?.entries);
    if (entries === null) throw new Error("The knowledge supersession entries are invalid.");
    const result = await reconcileKnowledgeSupersession({
      repositoryRoot: root,
      incoming: entries,
    });
    ports.stdout(`${JSON.stringify(result)}\n`);
    return;
  }
  const receipt = JSON.parse(
    Buffer.from(await ports.stdinBytes()).toString("utf8"),
  ) as RepositoryReplicaReceipt;
  if (receipt.repositoryRoot !== root) throw new Error("The replica receipt root differs.");
  await new LocalRepositoryReplicaPeer().recordReceipt(receipt);
}

/** ADR-0561 removed the owner's side choice; the coordinator resolves conflicts itself. */
const REMOVED_PREFER =
  "--prefer was removed: the coordinator saves the losing side to a lervo/replica-backup/<replica>/<divergence> branch on this host and applies the configured side itself; restore the saved side from that branch with git.";

function reconcileOptions(args: readonly string[]) {
  const { config, watch, replica, prefer } = parseArgs({
    args: args.slice(1),
    strict: true,
    allowPositionals: false,
    options: {
      config: { type: "string" },
      watch: { type: "boolean" },
      replica: { type: "string" },
      prefer: { type: "string" },
    },
  }).values;
  if (prefer !== undefined) throw new Error(REMOVED_PREFER);
  if (config === undefined) throw new Error("Repository replica config is required.");
  if (replica !== undefined && watch === true)
    throw new Error("Repository replica --replica requires a one-shot run.");
  return {
    config,
    watch: watch === true,
    ...(replica === undefined ? {} : { only: { replicaId: replica } }),
  };
}

export async function runRepositoryReplicaCli(
  args: readonly string[],
  ports: RepositoryReplicaCliPorts,
): Promise<number> {
  const action = args[0];
  if (action === "capture-version") {
    // ADR-0483: lets a coordinator refuse to compare snapshots across capture semantics.
    ports.stdout(
      `${JSON.stringify({ schemaVersion: 1, captureVersion: REPOSITORY_REPLICA_CAPTURE_VERSION })}\n`,
    );
    return 0;
  }
  if (action === "watch") {
    const root = resolve(ports.cwd, oneOption(args, "--root"));
    await publishRepositoryChangeHints({
      root,
      write: ports.stdout,
      ...(ports.signal === undefined ? {} : { signal: ports.signal }),
    });
    return 0;
  }
  if (action !== undefined && Object.hasOwn(PEER_ACTION_STAGES, action)) {
    try {
      await runPeerAction(action, args, ports);
      return 0;
    } catch (error) {
      // The coordinator parses this line to keep the failure's code, stage, and Git details.
      ports.stderr(
        encodeRepositoryReplicaPeerFailure(
          describeRepositoryReplicaFailure(error, PEER_ACTION_STAGES[action]!),
        ),
      );
      return 1;
    }
  }
  if (action === "reconcile") {
    const options = reconcileOptions(args);
    return runRepositoryReplicaCoordinator(
      await readRepositoryReplicaCoordinatorConfig(resolve(ports.cwd, options.config)),
      ports,
      options,
    );
  }
  throw new Error(
    "Usage: lervo-node repository-replica <capture-version|snapshot|bundle|apply|adopt|receipt|knowledge-supersession|reconcile|watch> ...",
  );
}
